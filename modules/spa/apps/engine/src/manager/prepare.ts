import { createHash } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { newId } from "@platform/kernel/ids";
import { maskPii } from "@platform/kernel/pii";
import { templateLines } from "@platform/readers/structure/mapping";
import type { TemplateBlank, TemplateSections, TemplateStyle } from "@platform/readers/structure/schema";
import { formatMoneyFils } from "@platform/readers/structure/format";
import { type DealType, type SheetKeyInfo, type SpaActor, spaDataSheet, type SpaRole, hasAnyRole } from "@spa/core";
import { agreements, deals, helperRuns, spaApprovals, spaTemplateVersions, type SpaTx, withSpaTx } from "@spa/db";
import {
  formatSpaValue,
  renderSpaAgreement,
  type SpaDocumentKind,
  type SpaRenderInput,
  spaAgreementBlocks,
  splitSlotKey,
  strayMatches,
  templateChecks,
} from "@spa/helpers";
import { and, desc, eq, max, ne } from "drizzle-orm";
import { advance } from "./advance.ts";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, SpaDomainError, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DocumentStore } from "./noc.ts";
import { policyAt } from "./policy.ts";
import { AGREEMENT_PREPARE_JOB } from "../jobs.ts";
import { afterHelperResult, heldAgreementIds, helperMode, requireHelperOn } from "./helper-modes.ts";
import type { DealRow } from "./facts.ts";
import {
  currentSheetHash,
  type DealSheet,
  gatherSheetInputs,
  rulebookFor,
  sheetFromInputs,
  sheetInputHash,
} from "./sheet.ts";
import { supersedeEnvelopes } from "./signing.ts";
import { currentTemplate } from "./templates.ts";

const SYSTEM: SpaActor = "system:prepare";
/** Who may start preparation (S51): the people who enter the other deal records. */
const START_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];

/** The document each deal type is prepared as (S51; confirm with legal). */
export const KIND_BY_DEAL_TYPE: Readonly<Record<DealType, SpaDocumentKind>> = Object.freeze({
  primary_offplan: "spa",
  resale_ready: "mou",
  resale_offplan: "assignment",
});

export interface PrepareDeps {
  store: DocumentStore;
}
export type PrepareResult =
  | { ok: true; created: boolean; agreementId: string; version: number; kind: SpaDocumentKind; docHash: string }
  | { ok: false; reasons: string[]; keys: string[] };

interface Problem {
  code:
    | "no_template"
    | "no_rulebook"
    | "fee_rate"
    | "missing_key"
    | "unavailable"
    | "ambiguous"
    | "render"
    | "stray_value";
  /** The data-sheet key, for the event (keys, never values). */
  key?: string;
  message: string;
}

const sheetInfo = (key: string): SheetKeyInfo | null =>
  Object.hasOwn(spaDataSheet, key) ? (spaDataSheet[key as keyof typeof spaDataSheet] as SheetKeyInfo) : null;

/** The text the PDF will hold, for the stray-value scan. */
export function flatText(
  blocks: { kind: string; text?: string; label?: string; head?: string[]; rows?: string[][] }[],
  extra: (string | null)[],
): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (b.kind === "table") parts.push(...(b.head ?? []), ...(b.rows ?? []).flat());
    else parts.push(b.text ?? b.label ?? "");
  }
  for (const e of extra) if (e) parts.push(e);
  // A separator that is not whitespace: "2028" and "AED 1,800,000" in neighbouring cells are not one amount.
  return parts.join(" | ");
}

const STRAY_KINDS = ["an email address", "an Emirates ID number", "a passport number", "an AED amount"];

/** The kinds of value in `text` that aren't among `allowed` (the scan itself is shared with `agreement-review`, S60). */
export function strayValues(text: string, allowed: string): string[] {
  return [...new Set(strayMatches(text, allowed, STRAY_KINDS).map((m) => m.kind))];
}

/**
 * The renderer's input for a deal: the stored template version's own sections, blanks and look, with the deal's sheet.
 * Prepare prints it with the Clock's `now`; signing prints it again with the agreement's `preparedAt`, which gives the
 * same bytes and so the same hash and signature-line anchors (S54).
 */
export function agreementRenderInput(
  tv: typeof spaTemplateVersions.$inferSelect,
  d: Pick<DealRow, "dealType" | "ref">,
  sheet: Pick<DealSheet, "purchasers" | "sellers" | "values" | "plan">,
  now: Date,
): SpaRenderInput {
  const look = tv.look as unknown as {
    style: TemplateStyle;
    logo: { base64: string; mime: string; widthPx: number; heightPx: number } | null;
  };
  return {
    template: {
      sections: tv.sections as unknown as TemplateSections,
      blanks: tv.blanks as unknown as TemplateBlank[],
      style: look.style,
      version: tv.version,
      logo: look.logo
        ? {
            bytes: new Uint8Array(Buffer.from(look.logo.base64, "base64")),
            mime: look.logo.mime,
            widthPx: look.logo.widthPx,
            heightPx: look.logo.heightPx,
          }
        : null,
    },
    dealType: d.dealType,
    reference: d.ref,
    purchasers: sheet.purchasers,
    sellers: sheet.sellers,
    values: sheet.values,
    plan: sheet.plan,
    now,
  };
}

/**
 * Prepares a deal's agreement (S51). In `AGREEMENT_DRAFT`: picks the approved template for the deal type and project,
 * builds the data sheet from this deal's records, runs the prepare checks, renders the PDF (C14), hashes it, stores it,
 * records the source of every field, moves the deal to `LEGAL_REVIEW` and opens `agreement_approval` for legal.
 * No model is involved. Anything that can't be printed with certainty stops preparation (a `helper_runs` row and a
 * `PREPARE_STOPPED` event listing keys, never values); nothing is stored. Safe to run twice: the same values give the
 * same agreement back.
 */
export async function prepareAgreement(
  ctx: SpaContext,
  deps: PrepareDeps,
  dealId: string,
  actor: SpaActor = SYSTEM,
): Promise<PrepareResult> {
  // Off (S59): not prepared by the helper, and the agent has a task. Only a deal that is ready for it gets the task.
  const [pre] = await ctx.database.db.select({ state: deals.state }).from(deals).where(eq(deals.id, dealId));
  if (pre?.state === "AGREEMENT_DRAFT") await requireHelperOn(ctx, "spa_prepare", "*", dealId);
  return withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!d) throw notFound("deal");
    const kind = KIND_BY_DEAL_TYPE[d.dealType];
    const inputs = await gatherSheetInputs(tx, d);
    const valuesHash = sheetInputHash(inputs);
    const [live] = await tx.db
      .select()
      .from(agreements)
      .where(and(eq(agreements.dealId, dealId), ne(agreements.status, "superseded")))
      .orderBy(desc(agreements.version))
      .limit(1);
    const sameAgreement = live && live.valuesHash === valuesHash;
    // Review mode (S59): the same values, prepared and waiting for a person's look: nothing new to make or ask.
    if (sameAgreement && live.status === "prepared" && (await heldAgreementIds(tx, dealId, true)).has(live.id))
      return {
        ok: true as const,
        created: false,
        agreementId: live.id,
        version: live.version,
        kind: live.kind,
        docHash: live.docHash,
      };
    if (sameAgreement) {
      const result = {
        ok: true as const,
        created: false,
        agreementId: live.id,
        version: live.version,
        kind: live.kind,
        docHash: live.docHash,
      };
      if (d.state !== "AGREEMENT_DRAFT") return result;
      // The deal is back in the draft step (a compliance hold sent it back from legal review, review 7) with the same
      // agreement still waiting for legal: go forward again with the approval it already has. Nothing is rendered.
      const [approval] = live.approvalId
        ? await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, live.approvalId))
        : [];
      if (live.status === "in_review" && approval?.status === "pending") {
        await advance(ctx, { kind: "deal", id: dealId }, "PREPARED", {
          actor,
          payload: {
            agreementId: live.id,
            version: live.version,
            kind: live.kind,
            docHash: live.docHash,
            resumed: true,
          },
          tx,
        });
        return result;
      }
      // Otherwise (no live approval behind it) it is prepared afresh below and replaces this one.
    }
    if (d.state !== "AGREEMENT_DRAFT")
      throw conflict("not_in_agreement_draft", `an agreement is prepared in AGREEMENT_DRAFT, not ${d.state}`);

    const stop = async (problems: Problem[]): Promise<PrepareResult> => {
      const reasons = [...new Set(problems.map((p) => p.message))];
      const keys = [...new Set(problems.flatMap((p) => (p.key ? [p.key] : [])))];
      const codes = [...new Set(problems.map((p) => p.code))];
      const [last] = await tx.db
        .select()
        .from(helperRuns)
        .where(and(eq(helperRuns.dealId, dealId), eq(helperRuns.helper, "spa_prepare")))
        .orderBy(desc(helperRuns.createdAt), desc(helperRuns.id))
        .limit(1);
      const same =
        last?.status === "needs_human" &&
        (last.result as { valuesHash?: string }).valuesHash === valuesHash &&
        JSON.stringify(last.reasons) === JSON.stringify(reasons);
      if (!same) {
        await tx.db.insert(helperRuns).values({
          id: newId(),
          helper: "spa_prepare",
          dealId,
          entityKind: "deal",
          entityId: dealId,
          status: "needs_human",
          result: { valuesHash, kind, keys, codes },
          reasons: maskPii(reasons),
          modelTag: null,
          promptVersion: null,
          rulesVersion: d.rulesVersion,
          visibility: "staff",
          createdAt: ctx.clock.now(),
        });
        await appendDealEvent(tx, ctx, {
          entity: { kind: "deal", id: dealId },
          type: "PREPARE_STOPPED",
          actor,
          rulesVersion: d.rulesVersion,
          payload: { kind, codes, keys, reasons: reasons.length },
        });
      }
      return { ok: false, reasons, keys };
    };

    const tpl = await currentTemplate(ctx.database.db, kind, d.projectCode);
    if (!tpl) return stop([{ code: "no_template", message: `No approved template for a ${kind} on this project.` }]);
    const [tv] = await tx.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, tpl.versionId));
    if (!tv) throw notFound("template version");
    const rb = rulebookFor(ctx, d.rulesVersion);
    if (!rb) return stop([{ code: "no_rulebook", message: `The rulebook ${d.rulesVersion} isn't available.` }]);
    const policy = await policyAt(tx.db, d.policyVersion);
    const sheet = sheetFromInputs(inputs, rb, policy);

    const blanks = tv.blanks as unknown as TemplateBlank[];
    const sections = tv.sections as unknown as TemplateSections;
    const look = tv.look as unknown as {
      style: TemplateStyle;
      logo: { base64: string; mime: string; widthPx: number; heightPx: number } | null;
    };
    const problems: Problem[] = [];

    // The template's fee % against the rulebook pinned on THIS deal (a version approved under another one isn't trusted).
    for (const c of templateChecks({
      documentKind: kind,
      paragraphs: templateLines(sections),
      blanks,
      authorityMarks: look.style.flags.authorityMarks,
      rulebook: rb,
    }))
      if (c.code === "fee_rate" && c.severity === "blocker") problems.push({ code: "fee_rate", message: c.message });

    // Core and required keys the template prints and the deal has no value for: the keys go to the event.
    const missing = new Set<string>();
    for (const b of blanks) {
      if (b.role !== "field") continue;
      const { key, slot } = splitSlotKey(b.field);
      const info = sheetInfo(key);
      if (!info || !(info.core || info.requiredFor?.includes(inputs.deal.type as DealType))) continue;
      let absent: boolean;
      if (key === "payment_plan") absent = sheet.plan.length === 0;
      else if (info.repeat) {
        const list = info.repeat === "buyer" ? sheet.purchasers : sheet.sellers;
        const who = slot ? list.slice(slot - 1, slot) : list;
        absent = who.some((p) => formatSpaValue(key, p) === null);
      } else absent = formatSpaValue(key, sheet.values) === null;
      if (absent) missing.add(key);
    }
    for (const key of missing)
      problems.push({
        code: sheet.unavailable[key] ? "unavailable" : "missing_key",
        key,
        message: sheet.unavailable[key]
          ? `${spaDataSheet[key as keyof typeof spaDataSheet].label} can't be filled: ${sheet.unavailable[key]}`
          : `No value for ${sheetInfo(key)!.label}.`,
      });

    if (
      sheet.ambiguous.includes("broker") &&
      blanks.some((b) => sheetInfo(splitSlotKey(b.field).key)?.group === "broker")
    )
      problems.push({
        code: "ambiguous",
        message: "The deal has two brokers, but the template has one broker block.",
      });

    const input = agreementRenderInput(tv, d, sheet, ctx.clock.now());
    const built = spaAgreementBlocks(input);
    if (!built.ok) for (const m of built.problems) problems.push({ code: "render", message: m });
    else {
      // An email, ID, passport number or AED amount in the text that isn't one of this deal's values (rule 8).
      const allowed: string[] = [];
      for (const rec of [...sheet.purchasers, ...sheet.sellers, sheet.values])
        for (const [k, v] of Object.entries(rec)) {
          if (v === null || v === undefined) continue;
          allowed.push(String(v), formatSpaValue(k, rec) ?? "");
        }
      for (const r of sheet.plan) allowed.push(formatMoneyFils(r.amountFils), r.label, r.milestone ?? "");
      for (const kindFound of strayValues(flatText(built.blocks, [built.header, built.footer]), allowed.join("\n")))
        problems.push({
          code: "stray_value",
          message: `The agreement text holds ${kindFound} that isn't this deal's.`,
        });
    }
    if (problems.length) return stop(problems);

    const pdf = await renderSpaAgreement(input);
    if (!pdf.ok) return stop(pdf.problems.map((message) => ({ code: "render" as const, message })));
    const docHash = createHash("sha256").update(pdf.bytes).digest("hex");
    const stored = await deps.store.put(pdf.bytes, "pdf");

    // A live agreement from before (values changed, or a return that left it behind) is superseded by this one.
    await supersedeEnvelopes(
      ctx,
      tx,
      dealId,
      (
        await tx.db
          .select({ id: agreements.id })
          .from(agreements)
          .where(and(eq(agreements.dealId, dealId), ne(agreements.status, "superseded")))
      ).map((a) => a.id),
      actor,
      d.rulesVersion,
    );
    await tx.db
      .update(agreements)
      .set({ status: "superseded" })
      .where(and(eq(agreements.dealId, dealId), ne(agreements.status, "superseded")));
    const [{ last } = { last: null }] = await tx.db
      .select({ last: max(agreements.version) })
      .from(agreements)
      .where(and(eq(agreements.dealId, dealId), eq(agreements.kind, kind)));
    const version = (last ?? 0) + 1;
    const id = newId();
    await tx.db.insert(agreements).values({
      id,
      dealId,
      kind,
      version,
      templateVersionId: tpl.versionId,
      status: "prepared",
      docHash,
      storageKey: stored.path,
      valuesHash,
      fieldSources: sheet.sources,
      rulesVersion: d.rulesVersion,
      policyVersion: d.policyVersion,
      preparedBy: actor,
      preparedAt: ctx.clock.now(),
    });
    // Review mode (S59): the agreement is made and stored, but "prepared" waits for a person's look.
    let held = false;
    if ((await helperMode(tx.db, "spa_prepare")) === "review") {
      const runId = newId();
      await tx.db.insert(helperRuns).values({
        id: runId,
        helper: "spa_prepare",
        dealId,
        entityKind: "deal",
        entityId: dealId,
        status: "ok",
        result: { agreementId: id, valuesHash, kind, version },
        reasons: [],
        modelTag: null,
        promptVersion: null,
        rulesVersion: d.rulesVersion,
        visibility: "staff",
        createdAt: ctx.clock.now(),
      });
      held = (await afterHelperResult(ctx, tx, { helper: "spa_prepare", scope: "*", dealId, runId, status: "ok" }))
        .held;
    }
    const approval = held ? null : await submitPrepared(ctx, tx, dealId, { id, version, kind, docHash }, actor);
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "AGREEMENT_PREPARED",
      actor,
      rulesVersion: d.rulesVersion,
      payload: {
        agreementId: id,
        version,
        kind,
        docHash,
        valuesHash,
        templateVersionId: tpl.versionId,
        fields: Object.keys(sheet.sources).length,
        ...(approval ? { approvalId: approval.id } : { held: true }),
      },
    });
    return { ok: true, created: true, agreementId: id, version, kind, docHash };
  });
}

/**
 * The step after an agreement is stored: `PREPARED` (deal to `LEGAL_REVIEW`) and the legal gate, on the agreement. Runs at
 * once in auto mode, and after a person releases the held result in review mode (S59).
 */
async function submitPrepared(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  a: { id: string; version: number; kind: string; docHash: string },
  actor: SpaActor,
): Promise<{ id: string }> {
  await advance(ctx, { kind: "deal", id: dealId }, "PREPARED", {
    actor,
    payload: { agreementId: a.id, version: a.version, kind: a.kind, docHash: a.docHash },
    tx,
  });
  const approval = await proposeApproval(
    ctx,
    {
      gate: "agreement_approval",
      entity: { kind: "deal", id: dealId },
      dedupeKey: `${a.id}:agreement_approval`,
      title: `${a.kind.toUpperCase()} v${a.version}`,
      proposal: { agreementId: a.id, docHash: a.docHash, version: a.version, kind: a.kind },
      proposedBy: actor,
    },
    tx,
  );
  await tx.db.update(agreements).set({ status: "in_review", approvalId: approval.id }).where(eq(agreements.id, a.id));
  return approval;
}

/**
 * A person released a held preparation (S59, inside the decision's transaction): the agreement goes to legal, but only if it
 * is still the live one, the deal is still in `AGREEMENT_DRAFT` and its values still hash the same. Otherwise nothing is
 * sent: the next preparation makes a fresh agreement.
 */
export async function applyHeldPrepare(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  agreementId: string,
): Promise<boolean> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
  if (!d || d.state !== "AGREEMENT_DRAFT") return false;
  const [a] = await tx.db.select().from(agreements).where(eq(agreements.id, agreementId));
  if (!a || a.status !== "prepared") return false;
  if (a.valuesHash !== (await currentSheetHash(tx, d))) return false;
  await submitPrepared(ctx, tx, dealId, a, SYSTEM);
  return true;
}

/** The job's body: prepares, and answers a refusal (a deal that moved on, an unknown deal) instead of retrying it. */
export async function runPrepareJob(
  ctx: SpaContext,
  deps: PrepareDeps,
  data: { dealId: string },
): Promise<PrepareResult> {
  try {
    return await prepareAgreement(ctx, deps, data.dealId);
  } catch (e) {
    if (e instanceof SpaDomainError) return { ok: false, reasons: [e.message], keys: [] };
    throw e;
  }
}

/** The queue key: one job per deal and set of values (rule 7). A changed value is a new key. */
export async function prepareJobKey(ctx: SpaContext, dealId: string): Promise<string> {
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  return `${dealId}:prepare:${await currentSheetHash({ db: ctx.database.db }, d)}`;
}

/** Queues preparation. The deal must be in `AGREEMENT_DRAFT`. The answer says nothing about the result. */
export async function enqueuePrepare(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  dealId: string,
  user?: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ key: string; jobId: string | null; queued: boolean }> {
  if (user && !hasAnyRole(user, START_ROLES)) throw forbidden("you can't prepare an agreement");
  const [d] = await ctx.database.db.select({ state: deals.state }).from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  if (d.state !== "AGREEMENT_DRAFT")
    throw conflict("not_in_agreement_draft", `an agreement is prepared in AGREEMENT_DRAFT, not ${d.state}`);
  await requireHelperOn(ctx, "spa_prepare", "*", dealId);
  const key = await prepareJobKey(ctx, dealId);
  const jobId = await boss.send(AGREEMENT_PREPARE_JOB, { dealId }, { singletonKey: key });
  return { key, jobId, queued: jobId !== null };
}

/**
 * Legal's decision on an agreement, checked inside `decideApproval`'s transaction before the approval row is written
 * (S51). Approving needs the agreement still in review, the deal still in `LEGAL_REVIEW` and its values hashing the
 * same as when it was prepared: otherwise 422 `agreement_stale`, nothing written. Editing is refused (legal approves or
 * returns; the numbers are code's).
 */
export async function checkAgreementDecision(
  tx: SpaTx,
  approval: { id: string; entityId: string },
  decision: "approve" | "reject" | "edit",
): Promise<void> {
  if (decision === "edit") throw unprocessable("edit_not_allowed", "an agreement is approved or returned, not edited");
  if (decision === "reject") return;
  const [ag] = await tx.db.select().from(agreements).where(eq(agreements.approvalId, approval.id));
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, approval.entityId)).for("update");
  if (!ag || !d || ag.status !== "in_review" || d.state !== "LEGAL_REVIEW")
    throw unprocessable("agreement_stale", "this agreement is no longer the current one; prepare a new one");
  if ((await currentSheetHash(tx, d)) !== ag.valuesHash)
    throw unprocessable("agreement_stale", "the deal changed since this agreement was prepared; return it");
}

/**
 * After the approval row is written (S51): an approved agreement becomes `approved` and the deal moves to `SIGNING`
 * (the approval is consumed by the step); a rejected one is superseded and the deal returns to `AGREEMENT_DRAFT`.
 */
export async function applyAgreementDecision(
  tx: SpaTx,
  ctx: SpaContext,
  approval: { id: string; entityId: string },
  decision: "approve" | "reject",
): Promise<void> {
  const [ag] = await tx.db.select().from(agreements).where(eq(agreements.approvalId, approval.id));
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, approval.entityId));
  if (!ag || !d) return;
  const approve = decision === "approve";
  await tx.db
    .update(agreements)
    .set({ status: approve ? "approved" : "superseded" })
    .where(and(eq(agreements.id, ag.id), eq(agreements.status, "in_review")));
  // A deal that left `LEGAL_REVIEW` meanwhile (an AML hold) keeps its state; only the agreement is closed.
  if (d.state !== "LEGAL_REVIEW") return;
  await advance(ctx, { kind: "deal", id: d.id }, approve ? "APPROVED" : "RETURNED", {
    actor: SYSTEM,
    approvalId: approval.id,
    payload: { agreementId: ag.id, version: ag.version, docHash: ag.docHash },
    tx,
  });
}
