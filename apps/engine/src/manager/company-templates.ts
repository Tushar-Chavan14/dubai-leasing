import { PdfLogoError, renderStyledPdf } from "@leasing/adapters";
import { type Actor, type Addendum, type ContractFields, newId } from "@leasing/core";
import {
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
  approvalProblems,
  approvalWarnings,
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
import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { appendEvent } from "./events.ts";
import { recordRun, runOnly } from "./helpers.ts";
import { repointContractRule } from "./portfolio.ts";

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
    await tx.db.insert(companyContractTemplates).values({
      id: templateId,
      companyId,
      sampleDocumentId,
      status: "proposed",
      sections: data.sections,
      blanks: data.blanks,
      style: data.style,
      logoDocumentId,
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
        helperRunId,
        sections: data.sections.items.length,
        blanks: data.blanks.length,
        unmapped: data.unmappedBlanks,
        authorityMarks: data.style.flags.authorityMarks,
        logoDocumentId,
      },
      rulesVersion: ctx.rulesVersion,
    });
    return { skipped: false as const, status: "ok" as const, templateId, version };
  });
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

/** The template a contract rule points at: it must exist, be the company's own and be approved. */
export async function approvedTemplateFor(tx: Pick<Tx, "db">, companyId: string, templateId: string) {
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
  return row;
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
  },
): Promise<{ pdf: Uint8Array; title: string; leftEmpty: string[]; filled: { label: string; key: string }[] }> {
  const t = parseTemplate(row);
  const look = effectiveStyle(t.style, t.review, row.logoDocumentId);
  let built: ReturnType<typeof templateContractBlocks>;
  try {
    built = templateContractBlocks(
      {
        sections: t.sections,
        blanks: input.blanks ?? t.blanks,
        templateVersion: row.version,
        dropped: t.review.droppedParagraphs,
      },
      // The date of the contract is the day it is prepared (Clock), never read from the lease.
      { ...input.fields, contractOn: input.fields.contractOn ?? ctx.clock.today() },
      input.addendum,
      {
        version: input.version,
        reference: input.reference,
        demo: ctx.demoMode,
        preview: input.preview === true,
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

/** Max age of an extraction with no result before the panel offers "Try again" (Clock). */
const EXTRACTION_STUCK_MS = 15 * 60 * 1000;

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
      const since = reAskedAt ?? (queuedAt ? new Date(queuedAt) : sample.createdAt);
      const [run] = await db
        .select()
        .from(helperRuns)
        .where(
          and(
            eq(helperRuns.helper, "contract_structure"),
            eq(helperRuns.entityId, companyId),
            gte(helperRuns.at, since),
          ),
        )
        .orderBy(desc(helperRuns.at))
        .limit(1);
      const stuck = ctx.clock.now().getTime() - since.getTime() > EXTRACTION_STUCK_MS;
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
  // What approving a proposed version would move: active rules on the approved or any retired version.
  const approvedId = rows.find((r) => r.status === "approved")?.id;
  const movable = [...retiredIds, ...(approvedId ? [approvedId] : [])];
  const toMove = await db
    .select({ id: contractRules.id })
    .from(contractRules)
    .where(
      and(
        eq(contractRules.companyId, companyId),
        eq(contractRules.active, true),
        movable.length
          ? or(isNull(contractRules.templateId), inArray(contractRules.templateId, movable))
          : isNull(contractRules.templateId),
      ),
    );
  return {
    templates: rows.map(templateView),
    extraction,
    catalogue,
    rulesOnRetired: onRetired.length,
    rulesToMove: toMove.length,
  };
}

/** "Try again" on a template reading that failed: queues the structure job for the stored sample. */
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
export async function approveTemplate(ctx: EngineContext, templateId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId));
    if (!row) throw notFound("template");
    await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${`template:${row.companyId}`}))`);
    const [locked] = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(eq(companyContractTemplates.id, templateId))
      .for("update");
    if (!locked || locked.status !== "proposed") {
      throw conflict(
        `This template is ${locked?.status ?? "gone"}; only a proposed one can be approved.`,
        "template_immutable",
      );
    }
    const t = parseTemplate(locked);
    const reasons = approvalProblems(
      { blanks: t.blanks, style: t.style, logoDocumentId: locked.logoDocumentId, sections: t.sections },
      t.review,
    );
    if (reasons.length) throw unprocessable("This template can't be approved yet.", reasons, "template_not_ready");
    const entity = { kind: "company" as const, id: locked.companyId };
    const previous = await tx.db
      .select()
      .from(companyContractTemplates)
      .where(
        and(eq(companyContractTemplates.companyId, locked.companyId), eq(companyContractTemplates.status, "approved")),
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
    const [approved] = await tx.db
      .update(companyContractTemplates)
      .set({ status: "approved", approvedBy: actor, approvedAt: ctx.clock.now() })
      .where(eq(companyContractTemplates.id, locked.id))
      .returning();
    // Active rules of this company with no template, or on a retired (older) one, move to the new version as a
    // new rule version, in this transaction, audited with the approving user.
    const retiredIds = (
      await tx.db
        .select({ id: companyContractTemplates.id })
        .from(companyContractTemplates)
        .where(
          and(eq(companyContractTemplates.companyId, locked.companyId), eq(companyContractTemplates.status, "retired")),
        )
    ).map((r) => r.id);
    const moved = await tx.db
      .select({ id: contractRules.id })
      .from(contractRules)
      .where(
        and(
          eq(contractRules.companyId, locked.companyId),
          eq(contractRules.active, true),
          retiredIds.length
            ? or(isNull(contractRules.templateId), inArray(contractRules.templateId, retiredIds))
            : isNull(contractRules.templateId),
        ),
      )
      .for("update");
    for (const r of moved) await repointContractRule(ctx, tx, r.id, locked.id, actor);
    await appendEvent(tx, ctx, {
      entity,
      type: "COMPANY_TEMPLATE_APPROVED",
      actor,
      payload: {
        templateId: locked.id,
        version: locked.version,
        contentHash: templateKey(approved!).contentHash,
        retired: previous.map((p) => p.id),
        rulesRepointed: moved.length,
      },
      rulesVersion: ctx.rulesVersion,
    });
    return { ...templateView(approved!), rulesRepointed: moved.length };
  });
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
