import { newId } from "@platform/kernel/ids";
import { toDubaiDate } from "@platform/kernel/dates";
import { maskPii } from "@platform/kernel/pii";
import type { Llm } from "@platform/llm";
import { formatCalendarDate, formatMoneyFils } from "@platform/readers/structure/format";
import type { AgreementFlag } from "@spa/core";
import {
  agreementReviews,
  agreements,
  deals,
  helperReviewHolds,
  helperRuns,
  offers,
  type SpaDb,
  spaTemplateVersions,
  withSpaTx,
} from "@spa/db";
import { AGREEMENT_REVIEW_PROMPT_VERSION, formatSpaValue, reviewAgreement, spaAgreementBlocks } from "@spa/helpers";
import { and, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { AGREEMENT_REVIEW_JOB } from "../jobs.ts";
import type { SpaContext } from "./context.ts";
import { SpaDomainError } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { afterHelperResult, helperMode, requireHelperOn } from "./helper-modes.ts";
import { policyAt } from "./policy.ts";
import { agreementRenderInput } from "./prepare.ts";
import { gatherSheetInputs, rulebookFor, sheetFromInputs, sheetInputHash } from "./sheet.ts";

const ACTOR = "system:agreement-review" as const;

/** What the model and the quote guard read: the agreement's printed text (blocks, one per line) and what is allowed. */
export interface ReviewInput {
  agreementText: string;
  conditions: string | null;
  /** The deal's own values as text, so a stray amount or date is anything not listed here. */
  allowed: string;
  dealId: string;
  rulesVersion: string;
}

type AgreementRow = typeof agreements.$inferSelect;

/** Joins an agreement's blocks into plain lines (a table row is one line, cells separated by ` | `). */
function blocksText(
  blocks: { kind: string; text?: string; label?: string; head?: string[]; rows?: string[][] }[],
  extra: (string | null)[],
): string {
  const lines: string[] = [];
  for (const b of blocks) {
    if (b.kind === "table") {
      if (b.head?.length) lines.push(b.head.join(" | "));
      for (const r of b.rows ?? []) lines.push(r.join(" | "));
    } else lines.push(b.text ?? b.label ?? "");
  }
  for (const e of extra) if (e) lines.push(e);
  return lines.filter((l) => l.trim()).join("\n");
}

/**
 * The agreement's text and the deal's values, rebuilt from the same inputs the PDF was printed from. `null` when the
 * deal changed since (its values no longer hash as they did): a stale agreement is not reviewed.
 */
async function reviewInputOf(ctx: SpaContext, ag: AgreementRow): Promise<ReviewInput | null> {
  const db = ctx.database.db;
  const [d] = await db.select().from(deals).where(eq(deals.id, ag.dealId));
  if (!d) return null;
  const inputs = await gatherSheetInputs({ db }, d);
  if (sheetInputHash(inputs) !== ag.valuesHash) return null;
  const [tv] = await db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, ag.templateVersionId));
  if (!tv) return null;
  const policy = await policyAt(db, d.policyVersion);
  const sheet = sheetFromInputs(inputs, rulebookFor(ctx, d.rulesVersion), policy);
  const built = spaAgreementBlocks(agreementRenderInput(tv, d, sheet, ag.preparedAt));
  if (!built.ok) return null;
  const agreementText = blocksText(built.blocks, [built.header, built.footer]);
  // Every value the deal prints is allowed, in the forms the agreement prints them.
  const allowed: string[] = [];
  for (const rec of [...sheet.purchasers, ...sheet.sellers, sheet.values])
    for (const [k, v] of Object.entries(rec)) {
      if (v === null || v === undefined) continue;
      allowed.push(String(v), formatSpaValue(k, rec) ?? "");
    }
  for (const r of sheet.plan) {
    allowed.push(formatMoneyFils(r.amountFils), r.label, r.milestone ?? "");
    if (r.dueOn) allowed.push(r.dueOn, formatCalendarDate(r.dueOn) ?? "");
  }
  const prepared = toDubaiDate(ag.preparedAt);
  allowed.push(prepared, formatCalendarDate(prepared) ?? "");
  const [offer] = await db
    .select({ conditions: offers.conditions })
    .from(offers)
    .where(and(eq(offers.dealId, ag.dealId), eq(offers.status, "ACCEPTED")))
    .orderBy(desc(offers.createdAt))
    .limit(1);
  return {
    agreementText,
    conditions: offer?.conditions?.trim() ? offer.conditions : null,
    allowed: allowed.join("\n"),
    dealId: ag.dealId,
    rulesVersion: d.rulesVersion,
  };
}

/** The text the agreement prints, as the reviewer reads it (for staff tools and tests). */
export async function agreementTextOf(ctx: SpaContext, agreementId: string): Promise<string> {
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, agreementId));
  const i = ag ? await reviewInputOf(ctx, ag) : null;
  if (!i) throw new SpaDomainError(409, "agreement_stale", "this agreement is no longer the current one");
  return i.agreementText;
}

export type AgreementReviewRun =
  | { status: "reviewed"; reviewId: string; flags: number; dropped: number }
  | { status: "needs_human"; reasons: string[] }
  | { status: "skipped"; reason: "not_found" | "superseded" | "already_reviewed" | "stale" };

/**
 * `spa.agreement.review` (S60): flags for legal on one prepared agreement. Advice only: it never edits, approves or blocks
 * the agreement, and a failed run (`needs_human`) leaves `agreement_approval` decidable. The model's flags go through the
 * quote guard in `@spa/helpers`; the run is one `helper_runs` row and, when it worked, one immutable `agreement_reviews`
 * row (unique per agreement and prompt version, so the job is safe to run twice). Helper modes apply (S59): off refuses,
 * review holds the flags behind a `helper_review` click.
 */
export async function runAgreementReview(
  ctx: SpaContext,
  deps: { llm: Llm },
  data: { agreementId: string },
): Promise<AgreementReviewRun> {
  const db = ctx.database.db;
  const [ag] = await db.select().from(agreements).where(eq(agreements.id, data.agreementId));
  if (!ag) return { status: "skipped", reason: "not_found" };
  if (ag.status === "superseded") return { status: "skipped", reason: "superseded" };
  const seen = async (d: SpaDb) =>
    (
      await d
        .select({ id: agreementReviews.id })
        .from(agreementReviews)
        .where(
          and(
            eq(agreementReviews.agreementId, ag.id),
            eq(agreementReviews.promptVersion, AGREEMENT_REVIEW_PROMPT_VERSION),
          ),
        )
    )[0];
  if (await seen(db)) return { status: "skipped", reason: "already_reviewed" };
  await requireHelperOn(ctx, "spa_agreement_review", "*", ag.dealId);
  const input = await reviewInputOf(ctx, ag);
  if (!input) return { status: "skipped", reason: "stale" };
  const result = await reviewAgreement(deps.llm, input);

  return withSpaTx(ctx.database, async (tx) => {
    if (await seen(tx.db)) return { status: "skipped" as const, reason: "already_reviewed" as const };
    const runId = newId();
    const ok = result.status === "ok";
    await tx.db.insert(helperRuns).values({
      id: runId,
      helper: "spa_agreement_review",
      dealId: ag.dealId,
      entityKind: "agreement",
      entityId: ag.id,
      status: ok ? "ok" : "needs_human",
      // Counts and kinds only: the quotes stay in `agreement_reviews`, which the staff card reads.
      result: ok
        ? {
            agreementId: ag.id,
            flags: result.flags.length,
            dropped: result.dropped,
            instructionFound: result.instructionFound,
          }
        : { agreementId: ag.id },
      reasons: ok ? [] : maskPii(result.reasons),
      modelTag: result.model,
      promptVersion: AGREEMENT_REVIEW_PROMPT_VERSION,
      rulesVersion: input.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    if (!ok) return { status: "needs_human" as const, reasons: result.reasons };
    const reviewId = newId();
    await tx.db.insert(agreementReviews).values({
      id: reviewId,
      agreementId: ag.id,
      flags: maskPii(result.flags),
      dropped: result.dropped,
      modelTag: result.model,
      promptVersion: AGREEMENT_REVIEW_PROMPT_VERSION,
      instructionFound: result.instructionFound,
      runId,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: ag.dealId },
      type: "AGREEMENT_REVIEWED",
      actor: ACTOR,
      rulesVersion: input.rulesVersion,
      // Counts and kinds, never the quoted words.
      payload: {
        agreementId: ag.id,
        reviewId,
        flags: result.flags.length,
        kinds: [...new Set(result.flags.map((f) => f.kind))],
        dropped: result.dropped,
      },
    });
    // Review mode (S59): the flags wait for a person's look. They never hold the agreement itself.
    await afterHelperResult(ctx, tx, {
      helper: "spa_agreement_review",
      scope: "*",
      dealId: ag.dealId,
      runId,
      status: "ok",
    });
    return { status: "reviewed" as const, reviewId, flags: result.flags.length, dropped: result.dropped };
  });
}

/**
 * Queues the review after `prepareAgreement` stored an agreement (key `<agreementId>:review`, rule 7). Off (S59): nothing is
 * queued, and the agent gets the task. Its failure must not undo the preparation (the caller logs it).
 */
export async function queueAgreementReview(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  agreementId: string,
): Promise<{ queued: boolean; reason?: string }> {
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, agreementId));
  if (!ag) return { queued: false, reason: "not_found" };
  if (ag.status === "superseded") return { queued: false, reason: "superseded" };
  try {
    await requireHelperOn(ctx, "spa_agreement_review", "*", ag.dealId);
  } catch (e) {
    if (e instanceof SpaDomainError && e.code === "helper_off") return { queued: false, reason: "helper_off" };
    throw e;
  }
  await boss.send(AGREEMENT_REVIEW_JOB, { agreementId }, { singletonKey: `${agreementId}:review` });
  return { queued: true };
}

export type ReviewStatus = "pending" | "ready" | "held" | "unavailable" | "off";
export interface AgreementReviewView {
  status: ReviewStatus;
  /** The words the card shows. Flags are suggestions: they never block, approve or edit the agreement. */
  label: string;
  note: string;
  flags: Pick<AgreementFlag, "kind" | "quote" | "note" | "in" | "source">[];
  dropped: number;
  instructionFound: boolean;
  model: string | null;
  reviewedAt: Date | null;
}
const LABELS: Record<ReviewStatus, string> = {
  ready: "Suggestions for legal",
  pending: "Review in progress",
  held: "Review waiting for a person to look at it",
  unavailable: "Review not available",
  off: "Review is switched off",
};
const ADVICE = "These are suggestions. They don't change, approve or block the agreement.";
const view = (status: ReviewStatus, o: Partial<AgreementReviewView> = {}): AgreementReviewView => ({
  status,
  label: LABELS[status],
  note: ADVICE,
  flags: [],
  dropped: 0,
  instructionFound: false,
  model: null,
  reviewedAt: null,
  ...o,
});

/**
 * What the `agreement_approval` card shows about the review of its agreement (S60). Staff routes only: no party route
 * reads this. A review waiting for a person's look (review mode), or one a person rejected, shows no flag.
 */
export async function agreementReviewView(ctx: SpaContext, agreementId: string): Promise<AgreementReviewView> {
  const db = ctx.database.db;
  const [row] = await db
    .select()
    .from(agreementReviews)
    .where(eq(agreementReviews.agreementId, agreementId))
    .orderBy(desc(agreementReviews.createdAt))
    .limit(1);
  if (row) {
    const [hold] = row.runId
      ? await db.select().from(helperReviewHolds).where(eq(helperReviewHolds.runId, row.runId))
      : [];
    if (hold?.status === "pending") return view("held");
    if (hold?.status === "rejected") return view("unavailable");
    return view("ready", {
      flags: row.flags.map((f) => ({ kind: f.kind, quote: f.quote, note: f.note, in: f.in, source: f.source })),
      dropped: row.dropped,
      instructionFound: row.instructionFound,
      model: row.modelTag,
      reviewedAt: row.createdAt,
    });
  }
  const [ag] = await db.select({ dealId: agreements.dealId }).from(agreements).where(eq(agreements.id, agreementId));
  if (ag && (await helperMode(db, "spa_agreement_review")) === "off") return view("off");
  const [last] = await db
    .select({ status: helperRuns.status })
    .from(helperRuns)
    .where(and(eq(helperRuns.helper, "spa_agreement_review"), eq(helperRuns.entityId, agreementId)))
    .orderBy(desc(helperRuns.createdAt), desc(helperRuns.id))
    .limit(1);
  return last?.status === "needs_human" ? view("unavailable") : view("pending");
}
