import { PdfLogoError, renderStyledPdf } from "@leasing/adapters";
import {
  type Actor,
  type Addendum,
  companyClauseIdOf,
  Emirate,
  EMIRATE_LABELS,
  isCompanyClauseRef,
  type ContractFields,
  newId,
  type PropertyCategory,
  type PropertySubtype,
} from "@leasing/core";
import {
  companyClauses,
  companyContractTemplates,
  companies,
  contractRules,
  documents,
  helperRuns,
  leaseEvents,
  type Tx,
  withTx,
} from "@leasing/db";
import {
  approvalBlockers,
  approvalProblems,
  approvalWarnings,
  autoReview,
  clauseTextFromParagraph,
  hasValues,
  needsCheck,
  paragraphFromClauseText,
  templateParagraphs,
  ContractStructureSchemas,
  contractStructureHelper,
  EMPTY_REVIEW,
  effectiveStyle,
  resuggestBlanks,
  SHEET_KEY_NAMES,
  SHEET_KEYS,
  sheetKeyInfo,
  MAX_LOGO_BYTES,
  SAMPLE_CONTRACT_FIELDS,
  TemplateBlank,
  TemplateRenderError,
  TemplateReview,
  TemplateSections,
  TemplateStyle,
  templateContractBlocks,
} from "@leasing/helpers";
import { sha256Hex } from "@leasing/core/tokens";
import { and, desc, eq, gt, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { replaceContractRule, repointContractRule } from "./portfolio.ts";
// Used only inside functions (the two modules import each other).
import { clauseView, contractJobBudgetSeconds } from "./contract-templates.ts";

/**
 * Company contract templates (slice 4). When a sample contract is uploaded, the `contract-structure`
 * helper reads its structure, blanks and look, and the result is stored as a `proposed` template
 * version. Nothing here approves a template or fills a blank: an admin reviews the mappings and
 * approves (Task 3). IMMUTABILITY: an `approved` row is never edited; a new upload creates a new
 * `version`, and the manager only ever moves `approved` to `retired`.
 */
export const CONTRACT_STRUCTURE_JOB = "contract.structure";
const HELPER_ACTOR = "helper:contract_structure" as const satisfies Actor;

/** Runs the helper on a stored sample and inserts a `proposed` template version. Safe to run twice. */
export async function extractCompanyTemplate(
  ctx: EngineContext,
  input: {
    companyId: string;
    sampleDocumentId: string;
    /** Read the sample again even though a version came from it (the new one is proposed; nothing else changes). */ force?: boolean;
  },
) {
  const { companyId, sampleDocumentId } = input;
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, sampleDocumentId));
  if (!doc || doc.kind !== "contract_sample") throw notFound("sample document");
  // A job run twice (or a retry after a successful read) must not add a second version.
  const [existing] = await ctx.database.db
    .select({ id: companyContractTemplates.id })
    .from(companyContractTemplates)
    .where(eq(companyContractTemplates.sampleDocumentId, sampleDocumentId));
  if (existing && !input.force) return { skipped: true as const, templateId: existing.id };

  const entity = { kind: "company" as const, id: companyId };
  // The emirate chosen at upload (null = any emirate) travels on the sample document.
  const emirate = parseEmirate((doc.extracted as { emirate?: unknown } | null)?.emirate);
  const helperRunId = newId();
  const helper = contractStructureHelper(ctx.contractAiLlm ?? ctx.llm, {
    readFile: async (id) => {
      if (id !== doc.id) throw new Error("unexpected document");
      return new Uint8Array(await ctx.documents.read(doc.path));
    },
  });
  const run = await runOnly(
    ctx,
    helper,
    ContractStructureSchemas,
    entity,
    "extract_structure",
    { docId: doc.id },
    ctx.rulesVersion,
    helperRunId,
  );
  const data = run.result.status === "ok" ? run.result.data : undefined;
  // The logo goes to the content-addressed documents store; the template row keeps only its id.
  let logoBytes: Uint8Array | null = data?.logo ? new Uint8Array(Buffer.from(data.logo.base64, "base64")) : null;
  // Checked again here: a PNG, within the size limit.
  const PNG_MAGIC = [137, 80, 78, 71];
  if (logoBytes && (logoBytes.length > MAX_LOGO_BYTES || !PNG_MAGIC.every((b, i) => logoBytes![i] === b)))
    logoBytes = null;
  const logoStored = logoBytes ? await ctx.documents.put(logoBytes, "png") : null;
  // The image bytes live in the documents store only; helper_runs keeps a reference, not the base64.
  const recorded = data?.logo
    ? ({
        ...run,
        result: {
          ...run.result,
          data: { ...data, logo: { logoStored: logoStored !== null, sha256: logoBytes ? sha256Hex(logoBytes) : null } },
        },
      } as unknown as typeof run)
    : run;

  return withTx(ctx.database, async (tx) => {
    // One extraction at a time per company so version numbers don't collide.
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${companyId}`}))`);
    const [again] = await tx.db
      .select({ id: companyContractTemplates.id })
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.sampleDocumentId, sampleDocumentId));
    if (again && !input.force) return { skipped: true as const, templateId: again.id };
    await recordRun(ctx, tx, helper.name, entity, ctx.rulesVersion, recorded, helperRunId);
    if (!data) {
      return {
        skipped: false as const,
        status: run.result.status as "failed" | "needs_human",
        reasons: run.result.reasons,
        templateId: null,
      };
    }
    let logoDocumentId: string | null = null;
    if (logoStored) {
      logoDocumentId = newId();
      await tx.db.insert(documents).values({
        id: logoDocumentId,
        kind: "template_logo",
        sha256: logoStored.sha256,
        path: logoStored.path,
        mime: "image/png",
        bytes: logoStored.bytes,
        uploadedBy: HELPER_ACTOR,
        extracted: { sampleDocumentId, widthPx: data.logo!.widthPx, heightPx: data.logo!.heightPx },
      });
    }
    const [last] = await tx.db
      .select({ version: companyContractTemplates.version })
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.companyId, companyId))
      .orderBy(desc(companyContractTemplates.version))
      .limit(1);
    const templateId = newId();
    const version = (last?.version ?? 0) + 1;
    // D47: code makes the review decisions it can (marked header or footer, sample notes and values) up front.
    const auto = autoReview({ style: data.style, logoDocumentId, sections: data.sections }, EMPTY_REVIEW);
    await tx.db.insert(companyContractTemplates).values({
      id: templateId,
      companyId,
      sampleDocumentId,
      status: "proposed",
      sections: data.sections,
      blanks: data.blanks,
      style: data.style,
      review: auto.review,
      logoDocumentId,
      emirate,
      version,
      helperRunId,
      createdBy: HELPER_ACTOR,
      createdAt: ctx.clock.now(),
    });
    await appendEvent(tx, ctx, {
      entity,
      type: "COMPANY_TEMPLATE_PROPOSED",
      actor: HELPER_ACTOR,
      payload: {
        templateId,
        version,
        sampleDocumentId,
        emirate,
        helperRunId,
        sections: data.sections.items.length,
        blanks: data.blanks.length,
        unmapped: data.unmappedBlanks,
        authorityMarks: data.style.flags.authorityMarks,
        logoDocumentId,
      },
      rulesVersion: ctx.rulesVersion,
    });
    await linkSampleClauses(ctx, tx, companyId, sampleDocumentId);
    return { skipped: false as const, status: "ok" as const, templateId, version };
  });
}

/**
 * D47: links the clauses read from a sample to the paragraphs of the template read from the same sample, in whichever
 * order the two jobs finish. A linked clause's wording becomes the paragraph's (blanks as `[label]`), and contracts in
 * that template print the clause's current wording there. A clause whose paragraph code left out (sample values or a
 * sample note) is rejected if still proposed. Idempotent: clauses already linked to this template are skipped.
 */
export async function linkSampleClauses(ctx: EngineContext, tx: Tx, companyId: string, sampleDocumentId: string) {
  const [row] = await tx.db
    .select()
    .from(companyContractTemplates)
    .where(
      and(
        eq(companyContractTemplates.companyId, companyId),
        eq(companyContractTemplates.sampleDocumentId, sampleDocumentId),
        inArray(companyContractTemplates.status, ["proposed", "approved"]),
      ),
    )
    .orderBy(desc(companyContractTemplates.version))
    .limit(1);
  if (!row) return 0;
  const t = parseTemplate(row);
  const clauses = await tx.db
    .select()
    .from(companyClauses)
    .where(
      and(
        eq(companyClauses.companyId, companyId),
        eq(companyClauses.sourceDocumentId, sampleDocumentId),
        inArray(companyClauses.status, ["proposed", "approved"]),
      ),
    )
    .orderBy(companyClauses.createdAt, companyClauses.id)
    .for("update");
  const taken = new Set(
    clauses.filter((c) => c.inTemplateId === row.id && c.templateParagraphKey).map((c) => c.templateParagraphKey!),
  );
  const paragraphs = templateParagraphs(t.sections);
  const raw = new Map(paragraphs.map((p) => [p.key, p.text]));
  const dropped = new Set(t.review.droppedParagraphs);
  let linked = 0;
  const joined: string[] = [];
  for (const c of clauses) {
    if (c.inTemplateId === row.id && c.templateParagraphKey) continue;
    const key = paragraphForQuote(paragraphs, c.quote ?? c.textEn);
    if (!key || taken.has(key)) continue;
    if (dropped.has(key)) {
      if (c.status === "proposed") {
        await tx.db.update(companyClauses).set({ status: "rejected" }).where(eq(companyClauses.id, c.id));
        await appendEvent(tx, ctx, {
          entity: { kind: "company", id: companyId },
          type: "COMPANY_CLAUSE_REJECTED",
          actor: HELPER_ACTOR,
          payload: { clauseId: c.id, reason: "paragraph_left_out", templateId: row.id, paragraphKey: key },
          rulesVersion: ctx.rulesVersion,
        });
      }
      continue;
    }
    taken.add(key);
    const text = clauseTextFromParagraph(raw.get(key)!, t.blanks);
    await tx.db
      .update(companyClauses)
      .set({ inTemplateId: row.id, templateParagraphKey: key, textEn: text, hasValues: hasValues(text) })
      .where(eq(companyClauses.id, c.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: companyId },
      type: "COMPANY_CLAUSE_LINKED",
      actor: HELPER_ACTOR,
      payload: {
        clauseId: c.id,
        templateId: row.id,
        paragraphKey: key,
        beforeSha256: sha256Hex(c.textEn),
        afterSha256: sha256Hex(text),
      },
      rulesVersion: ctx.rulesVersion,
    });
    linked++;
    if (c.status === "approved") joined.push(`cc:${c.id}`);
  }
  // Clauses already approved (an older template, or auto-approved) printed in the template's wording before they were
  // linked: they join the active rules on this template so contracts keep printing them.
  if (joined.length && row.status === "approved") {
    const rules = await tx.db
      .select()
      .from(contractRules)
      .where(
        and(
          eq(contractRules.companyId, companyId),
          eq(contractRules.active, true),
          eq(contractRules.templateId, row.id),
        ),
      )
      .for("update");
    for (const r of rules) {
      const add = joined.filter((x) => !r.clauseIds.includes(x as (typeof r.clauseIds)[number]));
      if (!add.length) continue;
      await replaceContractRule(
        ctx,
        tx,
        r.id,
        {
          category: r.category as PropertyCategory,
          subtype: r.subtype as PropertySubtype | null,
          tenures: r.tenures as ("annual" | "short_term")[],
          minCheques: r.minCheques,
          maxCheques: r.maxCheques,
          clauseIds: [...r.clauseIds, ...add] as typeof r.clauseIds,
          sampleDocumentId: r.sampleDocumentId,
        },
        HELPER_ACTOR,
      );
    }
  }
  return linked;
}

/** D47, once at start: links the clauses of templates read before linking existed. Safe to run every start. */
export async function backfillTemplateClauseLinks(ctx: EngineContext) {
  const rows = await ctx.database.db
    .select({
      companyId: companyContractTemplates.companyId,
      sampleDocumentId: companyContractTemplates.sampleDocumentId,
    })
    .from(companyContractTemplates)
    .where(inArray(companyContractTemplates.status, ["proposed", "approved"]));
  let linked = 0;
  for (const r of rows) {
    linked += await withTx(ctx.database, async (tx) => {
      await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${r.companyId}`}))`);
      return linkSampleClauses(ctx, tx, r.companyId, r.sampleDocumentId);
    });
  }
  return linked;
}

/**
 * D47: what each linked paragraph prints in a contract: an approved clause in the contract's rule prints its current
 * wording (`[label]` back to the paragraph's blanks); a clause that is removed, still proposed or not in the rule
 * leaves its paragraph out. `ruleClauseIds` absent (a preview): every approved linked clause prints.
 */
export async function linkedParagraphs(
  tx: Pick<Tx, "db">,
  row: TemplateRow,
  ruleClauseIds?: readonly string[] | null,
  /** Preview of a proposed template: its proposed clauses print as they would once approved. */
  includeProposed = false,
): Promise<{ paragraphs: Record<string, string | null>; clauseIds: Set<string> }> {
  const t = parseTemplate(row);
  const raw = new Map(templateParagraphs(t.sections).map((p) => [p.key, p.text]));
  const rows = await tx.db
    .select()
    .from(companyClauses)
    .where(and(eq(companyClauses.inTemplateId, row.id), eq(companyClauses.companyId, row.companyId)));
  const inRule = ruleClauseIds ? new Set(ruleClauseIds) : null;
  const paragraphs: Record<string, string | null> = {};
  const clauseIds = new Set<string>();
  for (const c of rows) {
    if (!c.templateParagraphKey || !raw.has(c.templateParagraphKey)) continue;
    clauseIds.add(c.id);
    const live = c.status === "approved" || (includeProposed && c.status === "proposed");
    const on = live && (!inRule || inRule.has(`cc:${c.id}`));
    paragraphs[c.templateParagraphKey] = on
      ? paragraphFromClauseText(c.textEn, raw.get(c.templateParagraphKey)!, t.blanks)
      : null;
  }
  return { paragraphs, clauseIds };
}

// ---------------------------------------------------------------------------------------------
// Review, approval and rendering (Task 3)
// ---------------------------------------------------------------------------------------------

export type TemplateRow = typeof companyContractTemplates.$inferSelect;

/** A stored template with its JSON columns parsed (a bad row is a bug, not a user error). */
export function parseTemplate(row: TemplateRow) {
  return {
    row,
    sections: TemplateSections.parse(row.sections),
    blanks: TemplateBlank.array().parse(row.blanks),
    style: TemplateStyle.parse(row.style),
    review: TemplateReview.parse({ ...EMPTY_REVIEW, ...(row.review as object) }),
  };
}

/**
 * Identity of what a contract is rendered from: id, version and a hash of the content that decides
 * the PDF (wording, mappings, look, review decisions, logo). An approved row never changes, so the
 * hash is stable; a different template, version or rule makes a pending `final_contract` stale.
 */
export function templateKey(row: TemplateRow) {
  const content = sha256Hex(
    JSON.stringify({
      sections: row.sections,
      blanks: row.blanks,
      style: row.style,
      review: row.review,
      logoDocumentId: row.logoDocumentId,
    }),
  );
  return { id: row.id, version: row.version, contentHash: content };
}
export type TemplateKey = ReturnType<typeof templateKey>;

/** Parses a stored or posted emirate: a known emirate, else null ("any emirate"). */
export function parseEmirate(v: unknown): Emirate | null {
  const r = Emirate.safeParse(v);
  return r.success ? r.data : null;
}

/** SQL for "this template group": the same emirate, or no emirate (null = any). */
const inGroup = (emirate: Emirate | null) =>
  emirate === null ? isNull(companyContractTemplates.emirate) : eq(companyContractTemplates.emirate, emirate);

/**
 * The template a contract rule points at: it must exist, be the company's own, be approved and, when `emirate` is
 * given, be for that emirate or for any emirate (a template of another emirate is never used).
 */
export async function approvedTemplateFor(
  tx: Pick<Tx, "db">,
  companyId: string,
  templateId: string,
  emirate?: Emirate,
) {
  const [row] = await tx.db.select().from(companyContractTemplates).where(eq(companyContractTemplates.id, templateId));
  if (!row || row.companyId !== companyId) {
    throw unprocessable(
      "The contract rule's company template does not exist for this company.",
      [],
      "template_unavailable",
    );
  }
  if (row.status !== "approved") {
    throw unprocessable(
      `The contract rule's company template (v${row.version}) is ${row.status}, not approved. Point the rule at an approved template.`,
      [],
      "template_unavailable",
    );
  }
  if (emirate && row.emirate !== null && row.emirate !== emirate) {
    throw unprocessable(
      `The contract rule's company template (v${row.version}) is for ${EMIRATE_LABELS[row.emirate]}, not ${EMIRATE_LABELS[emirate]}.`,
      [],
      "template_unavailable",
    );
  }
  return row;
}

/**
 * The template a unit's contract is rendered in (D56): the rule's own template when it is approved and for the unit's
 * emirate (or any emirate); else the company's approved template for the unit's emirate; else its approved "any
 * emirate" template; else null, and the emirate-aware standard form is used. A template of another emirate is never
 * returned. A rule pointing at a missing, other-company or not approved template still throws (`template_unavailable`).
 */
export async function templateForUnit(
  tx: Pick<Tx, "db">,
  input: { companyId: string; ruleTemplateId: string | null | undefined; emirate: Emirate },
): Promise<TemplateRow | null> {
  const { companyId, ruleTemplateId, emirate } = input;
  if (ruleTemplateId) {
    const [row] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, ruleTemplateId));
    // Same checks as before for a rule's template; only a different emirate falls through to the lookup below.
    if (!row || row.companyId !== companyId || row.status !== "approved")
      return approvedTemplateFor(tx, companyId, ruleTemplateId);
    if (row.emirate === null || row.emirate === emirate) return row;
  }
  const approved = await tx.db
    .select()
    .from(companyContractTemplates)
    .where(and(eq(companyContractTemplates.companyId, companyId), eq(companyContractTemplates.status, "approved")))
    .orderBy(desc(companyContractTemplates.version));
  return approved.find((r) => r.emirate === emirate) ?? approved.find((r) => r.emirate === null) ?? null;
}

/** Rule check: `templateId` must be an approved template of the same company. */
export async function requireApprovedTemplate(
  tx: Pick<Tx, "db">,
  companyId: string,
  templateId: string | null | undefined,
) {
  if (!templateId) return null;
  return approvedTemplateFor(tx, companyId, templateId);
}

async function readLogo(ctx: EngineContext, tx: Pick<Tx, "db">, logoDocumentId: string | null) {
  if (!logoDocumentId) return null;
  const gone = () =>
    unprocessable(
      "The company template's logo is missing from storage. Drop the logo or upload the sample again.",
      [],
      "template_unavailable",
    );
  const [doc] = await tx.db.select().from(documents).where(eq(documents.id, logoDocumentId));
  if (!doc) throw gone();
  const x = (doc.extracted ?? {}) as { widthPx?: number; heightPx?: number };
  const bytes = await ctx.documents.read(doc.path).catch(() => null);
  if (!bytes) throw gone();
  return {
    bytes: new Uint8Array(bytes),
    mime: doc.mime ?? "image/png",
    widthPx: x.widthPx ?? 1,
    heightPx: x.heightPx ?? 1,
  };
}

/**
 * Fills a template's blanks from the records without rendering (code only): what the contract agent sees through
 * `fill_blanks`. Legal and money blanks with no value come back in `missingCore`.
 */
export function fillTemplateBlanks(
  ctx: EngineContext,
  row: TemplateRow,
  fields: ContractFields,
  extras: Record<string, string | number | null>,
  blanks?: TemplateBlank[],
): { filled: { label: string; key: string }[]; leftEmpty: string[]; missingCore: string[] } {
  const t = parseTemplate(row);
  try {
    const built = templateContractBlocks(
      {
        sections: t.sections,
        blanks: blanks ?? t.blanks,
        templateVersion: row.version,
        dropped: t.review.droppedParagraphs,
      },
      { ...fields, contractOn: fields.contractOn ?? ctx.clock.today() },
      { clauses: [], freeText: null },
      { version: 1, reference: "check", demo: ctx.demoMode, preview: true, extras },
    );
    return { filled: built.filled, leftEmpty: built.leftEmpty, missingCore: [] };
  } catch (e) {
    if (e instanceof TemplateRenderError) return { filled: [], leftEmpty: [], missingCore: e.problems };
    throw e;
  }
}

/**
 * The contract PDF in a company template: its sections and wording, blanks filled from `fields`
 * only, its look. A blank with no value prints as an empty line (listed in `leftEmpty`), except legal and money
 * core fields: those fail with a 422 listing what is missing.
 */
export async function renderCompanyContract(
  ctx: EngineContext,
  tx: Pick<Tx, "db">,
  row: TemplateRow,
  input: {
    fields: ContractFields;
    addendum: Addendum;
    version: number;
    reference: string;
    subject: string;
    preview?: boolean;
    /** Values of the data-sheet keys beyond the contract fields (`sheetExtras`), copied from the records. */
    extras?: Record<string, string | number | null>;
    /** Blank mappings to use for this contract instead of the stored ones (a per-lease refresh; the row is untouched). */
    blanks?: TemplateBlank[];
    /** D47: the contract rule's clause ids (linked paragraphs print only for clauses in it); absent for a preview. */
    ruleClauseIds?: readonly string[] | null;
    /** The unit's emirate (wording of the required terms); default: the template's, else Dubai. */
    emirate?: Emirate;
    /**
     * D64: paragraphs the contract agent reworded from the unit's records (code-checked). Used only where the
     * paragraph still reads as it did (`before`) and no clause prints there.
     */
    rewrites?: readonly { key: string; before: string; after: string }[];
  },
): Promise<{ pdf: Uint8Array; title: string; leftEmpty: string[]; filled: { label: string; key: string }[] }> {
  const t = parseTemplate(row);
  const look = effectiveStyle(t.style, t.review, row.logoDocumentId);
  const linked = await linkedParagraphs(
    tx,
    row,
    input.ruleClauseIds,
    input.preview === true && row.status === "proposed",
  );
  const raw = new Map(templateParagraphs(t.sections).map((p) => [p.key, p.text]));
  const paragraphs: Record<string, string | null> = { ...linked.paragraphs };
  for (const r of input.rewrites ?? []) {
    if (!Object.hasOwn(paragraphs, r.key) && raw.get(r.key) === r.before) paragraphs[r.key] = r.after;
  }
  // A clause linked to a paragraph prints there, never again under the additional terms.
  const extra = input.addendum.companyClauses?.filter((c) => !linked.clauseIds.has(c.id));
  const { companyClauses: _all, ...rest } = input.addendum;
  const clauses = rest.clauses.filter((x) => !(isCompanyClauseRef(x) && linked.clauseIds.has(companyClauseIdOf(x))));
  const addendum: Addendum = extra?.length ? { ...rest, clauses, companyClauses: extra } : { ...rest, clauses };
  let built: ReturnType<typeof templateContractBlocks>;
  try {
    built = templateContractBlocks(
      {
        sections: t.sections,
        blanks: input.blanks ?? t.blanks,
        templateVersion: row.version,
        dropped: t.review.droppedParagraphs,
        paragraphs,
      },
      // The date of the contract is the day it is prepared (Clock), never read from the lease.
      { ...input.fields, contractOn: input.fields.contractOn ?? ctx.clock.today() },
      addendum,
      {
        version: input.version,
        reference: input.reference,
        demo: ctx.demoMode,
        preview: input.preview === true,
        emirate: input.emirate ?? row.emirate ?? "dubai",
        ...(input.extras ? { extras: input.extras } : {}),
      },
    );
  } catch (e) {
    if (e instanceof TemplateRenderError) {
      throw unprocessable(
        `The contract can't be prepared in the company template (v${row.version}): ${e.problems[0]}`,
        e.problems,
        "template_blank_unfilled",
      );
    }
    throw e;
  }
  const logo = await readLogo(ctx, tx, look.logoDocumentId);
  const pdf = await renderStyledPdf(
    { title: built.title, subject: input.subject },
    built.blocks,
    {
      page: look.style.page,
      margins: look.style.margins,
      font: look.style.font,
      sizes: look.style.sizes,
      headingBold: look.style.headingBold,
      accentColour: look.style.accentColour,
      header: look.style.header,
      footer: look.style.footer,
    },
    { logo, watermark: input.preview ? "Preview" : null },
  ).catch((e: unknown) => {
    if (e instanceof PdfLogoError) {
      throw unprocessable(
        "The company template's logo image can't be read. Drop the logo or upload the sample again.",
        [],
        "template_unavailable",
      );
    }
    throw e;
  });
  return { pdf, title: built.title, leftEmpty: built.leftEmpty, filled: built.filled };
}

/** A sample contract in the template with demo values, watermarked "Preview" (admin only; nothing stored). */
export async function previewTemplate(ctx: EngineContext, templateId: string) {
  const [row] = await ctx.database.db
    .select()
    .from(companyContractTemplates)
    .where(eq(companyContractTemplates.id, templateId));
  if (!row) throw notFound("template");
  const { pdf } = await renderCompanyContract(ctx, ctx.database, row, {
    fields: SAMPLE_CONTRACT_FIELDS,
    addendum: { clauses: [], freeText: null },
    version: 1,
    reference: "PREVIEW",
    subject: `Preview of company template v${row.version}`,
    preview: true,
  });
  return pdf;
}

/** What the review screen shows for one template. */
export function templateView(row: TemplateRow) {
  const t = parseTemplate(row);
  const look = effectiveStyle(t.style, t.review, row.logoDocumentId);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    /** The emirate the template is for; null = any emirate. */
    emirate: row.emirate,
    sampleDocumentId: row.sampleDocumentId,
    sections: t.sections,
    // Read-only: which data-sheet key fills each blank and how it was chosen (matched, model or left empty).
    blanks: t.blanks.map((b) => ({
      ...b,
      fieldLabel: b.role === "field" ? (sheetKeyInfo(b.field)?.label ?? null) : null,
      source:
        b.role === "field"
          ? (b.source ?? (b.field === "unmapped" || b.field === "leave_empty" ? "empty" : "matched"))
          : null,
    })),
    style: t.style,
    review: t.review,
    effective: {
      header: look.style.header,
      footer: look.style.footer,
      accentColour: look.style.accentColour,
      hasLogo: look.logoDocumentId !== null,
    },
    hasLogo: row.logoDocumentId !== null,
    /** Wording that needs a decision (values, authority marks) or a look (warning), for the review list. */
    paragraphs: templateParagraphs(t.sections).filter(
      (p) => p.values || p.authority || p.warning || p.fixedValues.length > 0 || p.sampleOnly,
    ),
    warnings: approvalWarnings({ sections: t.sections }),
    /** D47: what code changed on its own (removed marked header, notes and sample values), in plain words. */
    changes: autoReview({ style: t.style, logoDocumentId: row.logoDocumentId, sections: t.sections }, EMPTY_REVIEW)
      .changes,
    /** D47: what still blocks approval (text the PDF fonts can't print). */
    blockers: row.status === "proposed" ? approvalBlockers({ style: t.style, sections: t.sections }) : [],
    problems:
      row.status === "proposed"
        ? approvalProblems(
            { blanks: t.blanks, style: t.style, logoDocumentId: row.logoDocumentId, sections: t.sections },
            t.review,
          )
        : [],
    approvedBy: row.approvedBy,
    approvedAt: row.approvedAt,
    createdAt: row.createdAt,
  };
}

/**
 * Max age of an extraction with no result before the panel offers "Try again" (Clock): the job's own deadline plus a
 * margin, so the panel never calls a reading "stopped" while it is still allowed to run. The job stores its own
 * failure reason when it passes the deadline; this is only for a worker that died.
 */
const extractionStuckMs = (ctx: EngineContext) =>
  (contractJobBudgetSeconds(ctx.backgroundModelTimeoutSeconds ?? 300) + 180) * 1000;

/** The company's templates (newest first) and the state of reading its latest sample (any staff). */
export async function companyTemplatePanel(ctx: EngineContext, companyId: string) {
  const db = ctx.database.db;
  const [company] = await db.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId));
  if (!company) throw notFound("company");
  const rows = await db
    .select()
    .from(companyContractTemplates)
    .where(eq(companyContractTemplates.companyId, companyId))
    .orderBy(desc(companyContractTemplates.version));
  const [sample] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.kind, "contract_sample"), sql`${documents.extracted}->>'companyId' = ${companyId}`))
    .orderBy(desc(documents.createdAt))
    .limit(1);
  let extraction: {
    sampleDocumentId: string;
    status: "reading" | "ready" | "failed" | "retired";
    reasons: string[];
    /** Whole minutes (Clock) since the current reading was asked for, for the progress line. */
    minutes?: number;
    /** Whole minutes after which the reading stops itself and says why. */
    limitMinutes?: number;
  } | null = null;
  if (sample) {
    const fromSample = rows.filter((r) => r.sampleDocumentId === sample.id);
    // Every version read from this sample was retired: offer to read it again (with the current reader).
    const allRetired = fromSample.length > 0 && fromSample.every((r) => r.status === "retired");
    const reAskedAt = allRetired ? await reReadAskedAt(ctx, companyId, fromSample) : null;
    if (allRetired && !reAskedAt) {
      extraction = { sampleDocumentId: sample.id, status: "retired", reasons: [] };
    } else if (!allRetired && fromSample.some((r) => r.status !== "retired")) {
      extraction = { sampleDocumentId: sample.id, status: "ready", reasons: [] };
    } else {
      // Clock times only (runs and events use the Clock; row `createdAt` is the database's own time).
      const queuedAt = (sample.extracted as { queuedAt?: string } | null)?.queuedAt;
      const queued = queuedAt ? new Date(queuedAt) : sample.createdAt;
      // "Try again" after a failed or stopped reading starts the clock again (the run before it no longer counts).
      const [retried] = reAskedAt
        ? []
        : await db
            .select({ at: leaseEvents.at, id: leaseEvents.id })
            .from(leaseEvents)
            .where(
              and(
                eq(leaseEvents.entityId, companyId),
                eq(leaseEvents.type, "COMPANY_TEMPLATE_EXTRACTION_RETRIED"),
                gte(leaseEvents.at, queued),
              ),
            )
            .orderBy(desc(leaseEvents.at))
            .limit(1);
      const since = reAskedAt ?? retried?.at ?? queued;
      const [run] = await db
        .select()
        .from(helperRuns)
        .where(
          and(
            eq(helperRuns.helper, "contract_structure"),
            eq(helperRuns.entityId, companyId),
            gte(helperRuns.at, since),
            // After "Try again", only runs started after it count (ids are time-ordered UUIDv7; the Clock may stand
            // still in demos, and a run that hung before the retry must not mark the new reading as failed).
            ...(retried ? [gt(helperRuns.id, retried.id)] : []),
          ),
        )
        .orderBy(desc(helperRuns.at))
        .limit(1);
      const stuck = ctx.clock.now().getTime() - since.getTime() > extractionStuckMs(ctx);
      if (run && run.status !== "ok") {
        const out = run.output as { reasons?: string[]; error?: string } | null;
        const reasons = out?.error?.includes("JSON")
          ? [
              "The model didn't return a usable answer, twice. Try again; if it keeps failing, the model may be overloaded.",
            ]
          : (out?.reasons ?? []);
        extraction = { sampleDocumentId: sample.id, status: "failed", reasons };
      } else if (stuck) {
        extraction = {
          sampleDocumentId: sample.id,
          status: "failed",
          reasons: ["The reading job stopped; try again."],
        };
      } else
        extraction = {
          sampleDocumentId: sample.id,
          status: "reading",
          reasons: [],
          minutes: Math.max(0, Math.floor((ctx.clock.now().getTime() - since.getTime()) / 60_000)),
          limitMinutes: Math.ceil(contractJobBudgetSeconds(ctx.backgroundModelTimeoutSeconds ?? 300) / 60),
        };
    }
  }
  const catalogue = SHEET_KEY_NAMES.map((name) => ({
    name,
    type: SHEET_KEYS[name]!.type,
    label: SHEET_KEYS[name]!.label,
  }));
  const retiredIds = rows.filter((r) => r.status === "retired").map((r) => r.id);
  const onRetired = retiredIds.length
    ? await db
        .select({ id: contractRules.id })
        .from(contractRules)
        .where(
          and(
            eq(contractRules.companyId, companyId),
            eq(contractRules.active, true),
            inArray(contractRules.templateId, retiredIds),
          ),
        )
    : [];
  // What approving a proposed version would move: active rules on the approved or any retired version of its own
  // (company, emirate) group; rules with no template only for an "any emirate" template.
  const target = sample ? rows.find((r) => r.sampleDocumentId === sample.id && r.status === "proposed") : undefined;
  const groupRows = target ? rows.filter((r) => r.emirate === target.emirate) : rows;
  const groupRetired = groupRows.filter((r) => r.status === "retired").map((r) => r.id);
  const approvedId = groupRows.find((r) => r.status === "approved")?.id;
  const movable = [...groupRetired, ...(approvedId ? [approvedId] : [])];
  const noTemplate = !target || target.emirate === null ? isNull(contractRules.templateId) : undefined;
  const toMove = await db
    .select({ id: contractRules.id })
    .from(contractRules)
    .where(
      and(
        eq(contractRules.companyId, companyId),
        eq(contractRules.active, true),
        movable.length ? or(noTemplate, inArray(contractRules.templateId, movable)) : (noTemplate ?? sql`false`),
      ),
    );
  // D47: the latest sample's clauses waiting for approval (shown on the review with "Approve all").
  const proposedClauses = sample
    ? await db
        .select()
        .from(companyClauses)
        .where(
          and(
            eq(companyClauses.companyId, companyId),
            eq(companyClauses.sourceDocumentId, sample.id),
            eq(companyClauses.status, "proposed"),
          ),
        )
        .orderBy(companyClauses.createdAt, companyClauses.id)
    : [];
  const openTemplate = sample
    ? rows.find((r) => r.sampleDocumentId === sample.id && r.status === "proposed")
    : undefined;
  return {
    templates: rows.map(templateView),
    extraction,
    catalogue,
    rulesOnRetired: onRetired.length,
    rulesToMove: toMove.length,
    review: sample
      ? {
          sampleDocumentId: sample.id,
          ruleId: (sample.extracted as { ruleId?: string } | null)?.ruleId ?? null,
          clauses: proposedClauses.map(clauseView),
          templateId: openTemplate?.id ?? null,
          // The one tick is needed when kept wording or these clauses have amounts, dates, DLD/RERA words or a logo.
          needsCheck: openTemplate
            ? needsCheck(
                { logoDocumentId: openTemplate.logoDocumentId, sections: parseTemplate(openTemplate).sections },
                parseTemplate(openTemplate).review,
                proposedClauses.map((c) => c.textEn),
              )
            : proposedClauses.some((c) => c.hasValues),
        }
      : null,
  };
}

/**
 * Stores why a structure reading failed (deadline or error) as a failed `contract_structure` run, so the panel shows
 * the reason and "Try again". Nothing is stored when a version from this sample was proposed meanwhile.
 */
export async function failStructure(ctx: EngineContext, documentId: string, reason: string) {
  const [doc] = await ctx.database.db.select().from(documents).where(eq(documents.id, documentId));
  const companyId = (doc?.extracted as { companyId?: string } | null)?.companyId;
  if (!doc || !companyId) return false;
  return withTx(ctx.database, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${companyId}`}))`);
    const [open] = await tx.db
      .select({ id: companyContractTemplates.id })
      .from(companyContractTemplates)
      .where(
        and(eq(companyContractTemplates.sampleDocumentId, documentId), eq(companyContractTemplates.status, "proposed")),
      );
    if (open) return false;
    await recordRun(
      ctx,
      tx,
      "contract_structure",
      { kind: "company", id: companyId },
      ctx.rulesVersion,
      {
        result: { status: "failed", reasons: [reason], sourceDocIds: [documentId] },
        attempts: 1,
        latencyMs: 0,
        inputHash: sha256Hex(documentId),
      },
      newId(),
    );
    return true;
  });
}

/** When a "read again" was asked after the newest retired version from this sample, if it was. */
async function reReadAskedAt(ctx: EngineContext, companyId: string, fromSample: { helperRunId: string | null }[]) {
  // When the newest of these versions was read (its helper run's Clock time).
  const runIds = fromSample.flatMap((r) => (r.helperRunId ? [r.helperRunId] : []));
  const [read] = runIds.length
    ? await ctx.database.db
        .select({ at: helperRuns.at })
        .from(helperRuns)
        .where(inArray(helperRuns.id, runIds))
        .orderBy(desc(helperRuns.at))
        .limit(1)
    : [];
  const newest = read?.at ?? new Date(0);
  const [ev] = await ctx.database.db
    .select({ at: leaseEvents.at })
    .from(leaseEvents)
    .where(
      and(
        eq(leaseEvents.entityId, companyId),
        eq(leaseEvents.type, "COMPANY_TEMPLATE_EXTRACTION_RETRIED"),
        gte(leaseEvents.at, newest),
      ),
    )
    .orderBy(desc(leaseEvents.at))
    .limit(1);
  return ev?.at ?? null;
}

export async function retryTemplateExtraction(ctx: EngineContext, companyId: string, actor: Actor) {
  const panel = await companyTemplatePanel(ctx, companyId);
  if (!panel.extraction) throw conflict("This company has no sample contract.", "no_sample");
  if (panel.extraction.status !== "failed" && panel.extraction.status !== "retired")
    throw conflict("Only a reading that failed, or a retired template, can be read again.", "not_failed");
  // Always read again: a version (retired) may already exist from this sample, which would skip the read.
  const force = true;
  const documentId = panel.extraction.sampleDocumentId;
  return withTx(ctx.database, async (tx) => {
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: companyId },
      type: "COMPANY_TEMPLATE_EXTRACTION_RETRIED",
      actor,
      payload: { documentId, force },
      rulesVersion: ctx.rulesVersion,
    });
    await ctx.scheduler.send(tx, {
      name: CONTRACT_STRUCTURE_JOB,
      data: { documentId, force },
      singletonKey: `${documentId}:t${ctx.clock.now().getTime()}`,
    });
    return { queued: true as const, documentId };
  });
}

export interface TemplateReviewPatch {
  dropHeader?: boolean | undefined;
  dropFooter?: boolean | undefined;
  dropLogo?: boolean | undefined;
  logoConfirmed?: boolean | undefined;
  authorityChecked?: boolean | undefined;
  /** Paragraph key to confirmed flag. Only keys of this template's paragraphs are accepted. */
  valuesConfirmed?: Record<string, boolean> | undefined;
  authorityBodyConfirmed?: Record<string, boolean> | undefined;
  /** Paragraph key to dropped flag ("Drop this line"). Only keys of this template's paragraphs are accepted. */
  droppedParagraphs?: Record<string, boolean> | undefined;
}

function applyConfirmations(current: string[], patch: Record<string, boolean> | undefined, valid: Set<string>) {
  const set = new Set(current);
  for (const [k, on] of Object.entries(patch ?? {})) {
    if (!valid.has(k)) continue;
    if (on) set.add(k);
    else set.delete(k);
  }
  return [...set];
}

/**
 * The admin edits a `proposed` template: whether
 * the header, footer or logo are dropped, and the logo confirmation. The section wording can't be
 * edited; to change it, upload a new sample. An approved or retired template is never edited.
 */
export async function reviewTemplate(ctx: EngineContext, templateId: string, patch: TemplateReviewPatch, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId))
      .for("update");
    if (!row) throw notFound("template");
    if (row.status !== "proposed") {
      throw conflict(`This template is ${row.status}; only a proposed one can be edited.`, "template_immutable");
    }
    const t = parseTemplate(row);
    const validKeys = new Set(templateParagraphs(t.sections).map((p) => p.key));
    const review: TemplateReview = {
      dropHeader: patch.dropHeader ?? t.review.dropHeader,
      dropFooter: patch.dropFooter ?? t.review.dropFooter,
      dropLogo: patch.dropLogo ?? t.review.dropLogo,
      logoConfirmed: patch.logoConfirmed ?? t.review.logoConfirmed,
      authorityChecked: patch.authorityChecked ?? t.review.authorityChecked,
      checked: t.review.checked,
      valuesConfirmed: applyConfirmations(t.review.valuesConfirmed, patch.valuesConfirmed, validKeys),
      authorityBodyConfirmed: applyConfirmations(
        t.review.authorityBodyConfirmed,
        patch.authorityBodyConfirmed,
        validKeys,
      ),
      droppedParagraphs: applyConfirmations(
        t.review.droppedParagraphs,
        patch.droppedParagraphs,
        new Set(
          templateParagraphs(t.sections)
            .filter((p) => p.kind === "paragraph")
            .map((p) => p.key),
        ),
      ),
    };
    const [updated] = await tx.db
      .update(companyContractTemplates)
      .set({ review })
      .where(eq(companyContractTemplates.id, row.id))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: row.companyId },
      type: "COMPANY_TEMPLATE_REVIEWED",
      actor,
      payload: { templateId: row.id, version: row.version, review },
      rulesVersion: ctx.rulesVersion,
    });
    return templateView(updated!);
  });
}

/**
 * Approves a proposed template. Blocked (422 with every reason) while a mapping is of the wrong type, while DLD or Ejari marks in the header, footer or logo have not been dropped,
 * or while a kept logo has not been confirmed as the company's own. The previous approved version
 * is retired in the same step. Audited with the actor.
 */
/** Words of a text, lower case, without template blanks. */
const words = (t: string) =>
  t
    .replace(/\{\{b\d+\}\}/g, " ")
    .toLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];

/**
 * The template paragraph a clause's quote was read from: the paragraph whose words appear in the quote the most
 * (blanks in the paragraph hold the sample's values, so an exact match can't be used). At least 60% of the
 * paragraph's words and three words must match; otherwise none.
 */
export function paragraphForQuote(paragraphs: { key: string; kind: string; text: string }[], quote: string) {
  const q = new Set(words(quote));
  let best: { key: string; score: number } | null = null;
  for (const p of paragraphs) {
    if (p.kind !== "paragraph") continue;
    const w = words(p.text);
    if (w.length < 3) continue;
    const hit = w.filter((x) => q.has(x)).length;
    const score = hit / w.length;
    if (hit >= 3 && score >= 0.6 && (!best || score > best.score)) best = { key: p.key, score };
  }
  return best?.key ?? null;
}
/**
 * D47 "Approve all": in one step, every proposed clause read from the company's latest sample is approved (with the
 * wording as the admin left it), the ticked ones join the sample's contract rule, and the proposed template from that
 * sample, if any, is approved and the company's rules move to it. The template only gives the look: its clause
 * paragraphs print the linked clauses' current wording. Blocked only by text the PDF fonts can't print, and by the one
 * "I checked" tick when amounts, dates, DLD/RERA wording or a logo are kept.
 */
export async function approveSample(
  ctx: EngineContext,
  companyId: string,
  actor: Actor,
  opts: {
    /** Clauses to add to the sample's rule. Absent: all of them. */
    ruleClauseIds?: string[] | undefined;
    /** "I checked the amounts, dates and DLD/RERA references, and the logo is the company's own." */
    checked?: boolean | undefined;
  } = {},
) {
  return withTx(ctx.database, async (tx) => {
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${companyId}`}))`);
    const [sample] = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.kind, "contract_sample"), sql`${documents.extracted}->>'companyId' = ${companyId}`))
      .orderBy(desc(documents.createdAt))
      .limit(1);
    if (!sample) throw conflict("This company has no sample contract.", "no_sample");
    const sampleRuleId = (sample.extracted as { ruleId?: string } | null)?.ruleId ?? null;
    const [locked] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(
        and(
          eq(companyContractTemplates.companyId, companyId),
          eq(companyContractTemplates.sampleDocumentId, sample.id),
          eq(companyContractTemplates.status, "proposed"),
        ),
      )
      .orderBy(desc(companyContractTemplates.version))
      .limit(1)
      .for("update");
    if (locked) {
      // Save code's review first (templates read before D47 have none), so a clause whose paragraph code leaves out is
      // rejected by the link step instead of being approved and printed nowhere.
      const t0 = parseTemplate(locked);
      const auto = autoReview(
        { style: t0.style, logoDocumentId: locked.logoDocumentId, sections: t0.sections },
        t0.review,
      ).review;
      await tx.db
        .update(companyContractTemplates)
        .set({ review: auto })
        .where(eq(companyContractTemplates.id, locked.id));
      locked.review = auto;
      await linkSampleClauses(ctx, tx, companyId, sample.id);
    }
    const proposed = await tx.db
      .select()
      .from(companyClauses)
      .where(
        and(
          eq(companyClauses.companyId, companyId),
          eq(companyClauses.sourceDocumentId, sample.id),
          eq(companyClauses.status, "proposed"),
        ),
      )
      .for("update");
    if (!locked && proposed.length === 0)
      throw conflict("There is nothing waiting for approval.", "nothing_to_approve");
    const toRule = new Set(opts.ruleClauseIds ?? proposed.map((c) => c.id));
    const foreign = [...toRule].filter((id) => !proposed.some((c) => c.id === id));
    if (foreign.length)
      throw unprocessable("Only clauses waiting for approval can be added here.", foreign, "bad_clause");

    let review: TemplateReview | null = null;
    if (locked) {
      const t = parseTemplate(locked);
      review = autoReview(
        { style: t.style, logoDocumentId: locked.logoDocumentId, sections: t.sections },
        t.review,
      ).review;
      const blockers = approvalBlockers({ style: t.style, sections: t.sections });
      if (blockers.length) throw unprocessable("This template can't be approved.", blockers, "template_not_ready");
    }
    const texts = proposed.map((c) => c.textEn);
    const mustCheck = locked
      ? needsCheck({ logoDocumentId: locked.logoDocumentId, sections: parseTemplate(locked).sections }, review!, texts)
      : proposed.some((c) => c.hasValues);
    if (mustCheck && opts.checked !== true) {
      throw unprocessable(
        "Tick that you checked the amounts, dates and DLD/RERA references (and the logo) before approving.",
        [],
        "confirm_checked",
      );
    }
    const now = ctx.clock.now();
    const entity = { kind: "company" as const, id: companyId };
    for (const c of proposed) {
      await tx.db
        .update(companyClauses)
        .set({ status: "approved", approvedBy: actor, approvedAt: now })
        .where(eq(companyClauses.id, c.id));
    }

    let approved: TemplateRow | null = null;
    let retired: string[] = [];
    let moved = 0;
    if (locked) {
      const previous = await tx.db
        .select()
        .from(companyContractTemplates)
        .where(
          and(
            eq(companyContractTemplates.companyId, companyId),
            eq(companyContractTemplates.status, "approved"),
            inGroup(locked.emirate),
          ),
        )
        .for("update");
      for (const p of previous) {
        await tx.db
          .update(companyContractTemplates)
          .set({ status: "retired" })
          .where(eq(companyContractTemplates.id, p.id));
        await appendEvent(tx, ctx, {
          entity,
          type: "COMPANY_TEMPLATE_RETIRED",
          actor,
          payload: { templateId: p.id, version: p.version, replacedBy: locked.id },
          rulesVersion: ctx.rulesVersion,
        });
      }
      retired = previous.map((p) => p.id);
      const [row] = await tx.db
        .update(companyContractTemplates)
        .set({
          status: "approved",
          review: { ...review!, checked: opts.checked === true },
          approvedBy: actor,
          approvedAt: now,
        })
        .where(eq(companyContractTemplates.id, locked.id))
        .returning();
      approved = row ?? null;
      // Active rules of this company with no template, or on a retired (older) one, move to the new version as a
      // new rule version, in this transaction, audited with the approving user.
      const retiredIds = (
        await tx.db
          .select({ id: companyContractTemplates.id })
          .from(companyContractTemplates)
          .where(
            and(
              eq(companyContractTemplates.companyId, companyId),
              eq(companyContractTemplates.status, "retired"),
              inGroup(locked.emirate),
            ),
          )
      ).map((r) => r.id);
      // Rules with no template join only an "any emirate" template; a template for one emirate is found by the unit's
      // emirate anyway, so it takes over only the rules that were on an older version of the same (company, emirate).
      const noTemplate = locked.emirate === null ? isNull(contractRules.templateId) : undefined;
      const toMove = await tx.db
        .select({ id: contractRules.id })
        .from(contractRules)
        .where(
          and(
            eq(contractRules.companyId, companyId),
            eq(contractRules.active, true),
            retiredIds.length
              ? or(noTemplate, inArray(contractRules.templateId, retiredIds))
              : (noTemplate ?? sql`false`),
          ),
        )
        .for("update");
      for (const r of toMove) await repointContractRule(ctx, tx, r.id, locked.id, actor);
      moved = toMove.length;
    }

    // The ticked clauses join the rule the sample was uploaded on (its current version).
    // Clauses auto-approved from this sample (D37) and linked to the template print with it too.
    const auto = locked
      ? await tx.db
          .select({ id: companyClauses.id })
          .from(companyClauses)
          .where(
            and(
              eq(companyClauses.inTemplateId, locked.id),
              eq(companyClauses.sourceDocumentId, sample.id),
              eq(companyClauses.status, "approved"),
            ),
          )
      : [];
    const added = [
      ...proposed.filter((c) => toRule.has(c.id)).map((c) => `cc:${c.id}`),
      ...auto.filter((c) => !proposed.some((p) => p.id === c.id)).map((c) => `cc:${c.id}`),
    ];
    // The ticked clauses join the rule the sample was uploaded on and every active rule now on this template (so
    // wording from the template prints for each rule using it); each rule can be changed later from the clause list.
    const targets = new Map<string, typeof contractRules.$inferSelect>();
    if (added.length) {
      const fromSample = sampleRuleId ? await activeRuleFrom(tx, sampleRuleId) : null;
      if (fromSample) targets.set(fromSample.id, fromSample);
      if (locked) {
        const onTemplate = await tx.db
          .select()
          .from(contractRules)
          .where(
            and(
              eq(contractRules.companyId, companyId),
              eq(contractRules.active, true),
              eq(contractRules.templateId, locked.id),
            ),
          )
          .for("update");
        for (const r of onTemplate) targets.set(r.id, r);
      }
    }
    const ruleIds: string[] = [];
    for (const rule of targets.values()) {
      const clauseIds = [
        ...rule.clauseIds,
        ...added.filter((x) => !rule.clauseIds.includes(x as (typeof rule.clauseIds)[number])),
      ];
      if (clauseIds.length === rule.clauseIds.length) {
        ruleIds.push(rule.id);
        continue;
      }
      const next = await replaceContractRule(
        ctx,
        tx,
        rule.id,
        {
          category: rule.category as PropertyCategory,
          subtype: rule.subtype as PropertySubtype | null,
          tenures: rule.tenures as ("annual" | "short_term")[],
          minCheques: rule.minCheques,
          maxCheques: rule.maxCheques,
          clauseIds: clauseIds as typeof rule.clauseIds,
          sampleDocumentId: rule.sampleDocumentId,
        },
        actor,
      );
      ruleIds.push(next.id);
    }
    await appendEvent(tx, ctx, {
      entity,
      type: locked ? "COMPANY_TEMPLATE_APPROVED" : "COMPANY_SAMPLE_CLAUSES_APPROVED",
      actor,
      payload: {
        sampleDocumentId: sample.id,
        ...(approved
          ? {
              templateId: approved.id,
              version: approved.version,
              contentHash: templateKey(approved).contentHash,
              retired,
              rulesRepointed: moved,
            }
          : {}),
        clausesApproved: proposed.map((c) => c.id),
        addedToRules: ruleIds.length ? { ruleIds, clauseIds: added } : null,
        checked: opts.checked === true,
      },
      rulesVersion: ctx.rulesVersion,
    });
    return {
      template: approved ? templateView(approved) : null,
      clausesApproved: proposed.length,
      rulesRepointed: moved,
    };
  });
}

/** The active version of a contract rule, following `supersedesId` forward from any of its versions. */
async function activeRuleFrom(tx: Tx, ruleId: string) {
  let id: string | null = ruleId;
  for (let i = 0; id && i < 200; i++) {
    const [r]: (typeof contractRules.$inferSelect)[] = await tx.db
      .select()
      .from(contractRules)
      .where(eq(contractRules.id, id))
      .for("update");
    if (!r) return null;
    if (r.active) return r;
    const [next]: { id: string }[] = await tx.db
      .select({ id: contractRules.id })
      .from(contractRules)
      .where(eq(contractRules.supersedesId, r.id));
    id = next?.id ?? null;
  }
  return null;
}

/** Retires an approved template: contract rules that point at it fall back to no template (new rule version). */
export async function retireTemplate(ctx: EngineContext, templateId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId))
      .for("update");
    if (!row) throw notFound("template");
    if (row.status !== "approved")
      throw conflict(`This template is ${row.status}; only an approved one can be retired.`, "not_approved");
    const [done] = await tx.db
      .update(companyContractTemplates)
      .set({ status: "retired" })
      .where(eq(companyContractTemplates.id, row.id))
      .returning();
    // Rules on the retired template fall back to no template (a new rule version, audited).
    const rules = await tx.db
      .select({ id: contractRules.id })
      .from(contractRules)
      .where(and(eq(contractRules.active, true), eq(contractRules.templateId, row.id)))
      .for("update");
    for (const r of rules) await repointContractRule(ctx, tx, r.id, null, actor);
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: row.companyId },
      type: "COMPANY_TEMPLATE_RETIRED",
      actor,
      payload: { templateId: row.id, version: row.version, rulesFallenBack: rules.length },
      rulesVersion: ctx.rulesVersion,
    });
    return { ...templateView(done!), rulesStillOnRetired: 0, rulesFallenBack: rules.length };
  });
}

/** The logo image of a template, for the review screen (any staff). Null when it has none. */
export async function templateLogo(ctx: EngineContext, templateId: string) {
  const [row] = await ctx.database.db
    .select()
    .from(companyContractTemplates)
    .where(eq(companyContractTemplates.id, templateId));
  if (!row) throw notFound("template");
  const logo = await readLogo(ctx, ctx.database, row.logoDocumentId);
  return logo ? { bytes: logo.bytes, mime: logo.mime } : null;
}

/**
 * "Re-suggest mappings" on a `proposed` template: code rules, then the model, choose each blank's data-sheet key
 * again (blanks the admin never edits by hand any more; legacy "admin" choices are kept). An approved or retired
 * template is immutable: a new version (upload or read the sample again) is needed to map it afresh.
 */
export async function resuggestTemplate(ctx: EngineContext, templateId: string, actor: Actor) {
  const [peek] = await ctx.database.db
    .select()
    .from(companyContractTemplates)
    .where(eq(companyContractTemplates.id, templateId));
  if (!peek) throw notFound("template");
  if (peek.status !== "proposed") {
    throw conflict(
      `This template is ${peek.status}; mappings of an approved template never change. Upload the sample again to get a new version.`,
      "template_immutable",
    );
  }
  // The model runs outside the transaction (no lock is held while it works), on the label and nearby words only.
  const t0 = parseTemplate(peek);
  const r = await resuggestBlanks(ctx.contractAiLlm ?? ctx.llm, t0.sections, t0.blanks);
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId))
      .for("update");
    if (!row || row.status !== "proposed") {
      throw conflict("This template is no longer proposed.", "template_immutable");
    }
    const [updated] = await tx.db
      .update(companyContractTemplates)
      .set({ blanks: r.blanks })
      .where(eq(companyContractTemplates.id, row.id))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "company", id: row.companyId },
      type: "COMPANY_TEMPLATE_REMAPPED",
      actor,
      payload: { templateId: row.id, version: row.version, changed: r.changed, model: r.model },
      rulesVersion: ctx.rulesVersion,
    });
    return templateView(updated!);
  });
}
