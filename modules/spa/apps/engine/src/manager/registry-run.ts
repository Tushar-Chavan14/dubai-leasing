import { newId } from "@platform/kernel/ids";
import type { Llm } from "@platform/llm";
import { REGISTRY_NAME_FIELDS, type RegistryField, type RegistryKind, type RegistryRejection } from "@spa/core";
import { deals, helperRuns, registrations, registryRejections, type SpaTx, withSpaTx } from "@spa/db";
import { mapRejection, type MappedRejection, REGISTRY_PROMPT_VERSION, registeredMail } from "@spa/helpers";
import { and, asc, desc, eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import type { RegistrySubmitData } from "../jobs.ts";
import type { SpaContext } from "./context.ts";
import { notFound } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import {
  buildRegistryPayload,
  jobOf,
  REGISTRY_ACTOR,
  registryKindFor,
  type RegistryDeps,
  submitRegistration,
} from "./registry.ts";
import { planNameFixes } from "./registry-fix.ts";
import { afterHelperResult, heldRunIds, helperMode } from "./helper-modes.ts";
import { openTask } from "./tasks.ts";
import { mailDealParties } from "./portal.ts";

/** "Unavailable" is tried again after 5 minutes, 30 minutes and 2 hours (seconds, for pg-boss `startAfter`); the fourth failure opens a task. */
export const registryRetryDelays = [300, 1800, 7200] as const;
const MAX_TRIES = registryRetryDelays.length + 1;

export interface RegistryRunDeps extends RegistryDeps {
  /** The decision model, only to map an unknown rejection message to a field (S56). Null: such a rejection is a task. */
  llm: Llm | null;
  boss: Pick<PgBoss, "send">;
}
export type RegistryRunOutcome = {
  outcome: "issued" | "task" | "retry_queued" | "skipped" | "incomplete";
  reason?: string;
};

const SERVICE_LABEL: Record<RegistryKind, string> = {
  oqood_register: "The Oqood registration",
  oqood_transfer: "The Oqood transfer",
  trustee_transfer: "The trustee transfer",
};
/** Plain words for what a rejection was about. Never the registry's own text, a name or a number. */
const FIELD_WORDS: Record<RegistryField, string> = {
  buyer_name: "a buyer's name is not as the registry has it",
  seller_name: "a seller's name is not as the registry has it",
  buyer_id: "a buyer's identity document was not accepted",
  unit: "the unit was not accepted",
  ownership: "the seller's ownership was not accepted",
  noc: "the no-objection certificate was not accepted",
  service_charges: "service charges are outstanding",
  price: "the price was not accepted",
};
const CODE = /^[A-Za-z0-9_.-]{1,40}$/;

const sameRow = (dealId: string, kind: RegistryKind, approvalId: string) =>
  and(eq(registrations.dealId, dealId), eq(registrations.kind, kind), eq(registrations.approvalId, approvalId));

/**
 * The `registry` helper around one approved submission (S56, C21). It makes the call (`submitRegistration`), then looks at
 * what the registry said, from the stored rows, so a job that crashed and runs again picks up where it stopped:
 * - **rejected**: each reason is mapped to a field (a code table, else the decision model); if every reason is a
 *   buyer or seller name and the KYC-verified spelling differs only by case or spacing, the name is corrected and the
 *   deal is resubmitted once, under a new request id. Any other rejection, a second rejection, an unclear mapping or no
 *   safe fix becomes a task for the sales admin. The model returns a field and a confidence; code decides.
 * - **unavailable**: the same attempt is tried again (same request id: the registry replays) after 5 min, 30 min and
 *   2 h; the fourth failure opens a task.
 * Nothing is ever submitted twice for one request id, and no value but a name's spelling is ever changed.
 */
export async function runRegistry(
  ctx: SpaContext,
  deps: RegistryRunDeps,
  input: { dealId: string; approvalId: string; retryAttempt?: number },
  opts: { stopBeforeResubmit?: boolean } = {},
): Promise<RegistryRunOutcome> {
  const out = await runRegistryOnce(ctx, deps, input, opts);
  // The people on the deal hear it is registered, with their status link (C35, S67). One mail each, however often this runs.
  if (out.outcome === "issued")
    await mailDealParties(ctx, input.dealId, `registered:${input.approvalId}`, registeredMail);
  return out;
}

async function runRegistryOnce(
  ctx: SpaContext,
  deps: RegistryRunDeps,
  input: { dealId: string; approvalId: string; retryAttempt?: number },
  opts: { stopBeforeResubmit?: boolean } = {},
): Promise<RegistryRunOutcome> {
  const [deal] = await ctx.database.db.select().from(deals).where(eq(deals.id, input.dealId));
  if (!deal) throw notFound("deal");
  const kind = registryKindFor(deal.dealType);
  const rows = await ctx.database.db
    .select()
    .from(registrations)
    .where(sameRow(deal.id, kind, input.approvalId));

  if (!rows.length) {
    if (input.retryAttempt) return { outcome: "skipped", reason: "there is no such attempt" };
    const r = await submitRegistration(ctx, deps, input);
    if (r.status === "skipped") return { outcome: "skipped", reason: r.reason ?? "" };
    if (r.status === "incomplete") return { outcome: "incomplete", reason: r.reason ?? "" };
  } else if (input.retryAttempt !== undefined) {
    const mine = rows.filter((r) => r.attempt === input.retryAttempt);
    if (!mine.length) return { outcome: "skipped", reason: "there is no such attempt" };
    const open = mine.every((r) => r.status === "unavailable") && mine.length < MAX_TRIES;
    if (open) {
      const fields = await fixedFieldsBefore(ctx, deal.id, kind, input.approvalId, input.retryAttempt);
      const r = await submitRegistration(ctx, deps, input, {
        type: "retry",
        attempt: input.retryAttempt,
        ...(fields.length ? { fields } : {}),
      });
      if (r.status === "skipped") return { outcome: "skipped", reason: r.reason ?? "" };
      if (r.status === "incomplete") {
        await openUnavailableTask(ctx, deal, kind, input.approvalId, input.retryAttempt, "payload_changed");
        return { outcome: "incomplete", reason: r.reason ?? "" };
      }
    } else if (mine.some((r) => r.status !== "unavailable")) {
      // Answered already (the job ran twice): look again at what was done about it, but report nothing new.
      const out = await settle(ctx, deps, deal, kind, input.approvalId, opts, 0);
      return out.outcome === "issued" ? { outcome: "skipped", reason: "the registry already answered it" } : out;
    }
  }
  return settle(ctx, deps, deal, kind, input.approvalId, opts, 0);
}

type DealRow = typeof deals.$inferSelect;

/** The name fields the earlier rejection of this deal was fixed for, when `attempt` is the resubmission that followed it. */
async function fixedFieldsBefore(
  ctx: SpaContext,
  dealId: string,
  kind: RegistryKind,
  approvalId: string,
  attempt: number,
): Promise<RegistryField[]> {
  const [r] = await ctx.database.db
    .select({ field: registryRejections.mappedField })
    .from(registryRejections)
    .innerJoin(registrations, eq(registrations.id, registryRejections.registrationId))
    .where(
      and(
        sameRow(dealId, kind, approvalId),
        eq(registrations.attempt, attempt - 1),
        eq(registryRejections.action, "fixed"),
      ),
    );
  return r?.field ? (r.field.split(",") as RegistryField[]) : [];
}

/** Looks at the latest stored answer for this approval and does what is still to do about it (idempotent). */
async function settle(
  ctx: SpaContext,
  deps: RegistryRunDeps,
  deal: DealRow,
  kind: RegistryKind,
  approvalId: string,
  opts: { stopBeforeResubmit?: boolean },
  depth: number,
): Promise<RegistryRunOutcome> {
  const [last] = await ctx.database.db
    .select()
    .from(registrations)
    .where(sameRow(deal.id, kind, approvalId))
    .orderBy(desc(registrations.attempt), desc(registrations.createdAt), desc(registrations.id))
    .limit(1);
  if (!last) return { outcome: "skipped", reason: "nothing was submitted" };
  if (last.status === "issued") return { outcome: "issued" };
  if (last.status === "unavailable") return settleUnavailable(ctx, deps, deal, kind, approvalId, last);

  const [done] = await ctx.database.db
    .select()
    .from(registryRejections)
    .where(eq(registryRejections.registrationId, last.id));
  const decision = done ?? (await decideRejection(ctx, deps, deal, kind, approvalId, last));
  if (decision.action !== "fixed") return { outcome: "task" };
  // Review mode (S59): a fix that waits for a person's look, or one a person rejected, is not resubmitted.
  if (await fixHeld(ctx, deal.id, last.id)) return { outcome: "skipped", reason: "the fix waits for a person's look" };
  // Recorded as a fix: resubmit (a crash between the record and this call is finished by running the job again).
  if (opts.stopBeforeResubmit || depth >= 2) return { outcome: "skipped", reason: "stopped before the resubmission" };
  const fields = (decision.mappedField ?? "").split(",") as RegistryField[];
  const r = await submitRegistration(ctx, deps, { dealId: deal.id, approvalId }, { type: "fix", fields });
  if (r.status === "skipped") return { outcome: "skipped", reason: r.reason ?? "" };
  if (r.status === "incomplete") return { outcome: "incomplete", reason: r.reason ?? "" };
  return settle(ctx, deps, deal, kind, approvalId, opts, depth + 1);
}

async function insertDecisionRun(
  ctx: SpaContext,
  tx: SpaTx,
  deal: DealRow,
  o: {
    status: "ok" | "needs_human";
    result: Record<string, unknown>;
    reasons: string[];
    modelTag?: string | null;
  },
) {
  const id = newId();
  await tx.db.insert(helperRuns).values({
    id,
    helper: "registry",
    dealId: deal.id,
    entityKind: "deal",
    entityId: deal.id,
    status: o.status,
    result: o.result,
    reasons: o.reasons,
    modelTag: o.modelTag ?? null,
    promptVersion: REGISTRY_PROMPT_VERSION,
    rulesVersion: deal.rulesVersion,
    createdAt: ctx.clock.now(),
  });
  return id;
}

/** Whether the recorded fix for this registration answer is held (pending, or rejected by a person). */
async function fixHeld(ctx: SpaContext, dealId: string, registrationId: string): Promise<boolean> {
  const held = await withSpaTx(ctx.database, (tx) => heldRunIds(tx, dealId));
  if (!held.size) return false;
  const runs = await ctx.database.db
    .select({ id: helperRuns.id, result: helperRuns.result })
    .from(helperRuns)
    .where(and(eq(helperRuns.dealId, dealId), eq(helperRuns.helper, "registry")));
  return runs.some((r) => held.has(r.id) && r.result.registrationId === registrationId);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

async function decideRejection(
  ctx: SpaContext,
  deps: RegistryRunDeps,
  deal: DealRow,
  kind: RegistryKind,
  approvalId: string,
  row: typeof registrations.$inferSelect,
) {
  const reasons: RegistryRejection[] = row.reasons;
  // The model calls run outside any transaction.
  const mapped: MappedRejection[] = [];
  for (const r of reasons)
    mapped.push(await mapRejection(deps.llm, { code: r.code, field: r.field, message: r.message }));
  const needsHuman = mapped.some((m) => m.kind === "needs_human");
  const usable = mapped.filter((m): m is Extract<MappedRejection, { kind: "mapped" }> => m.kind === "mapped");
  const fields = [...new Set(usable.map((m) => m.field))];
  const allMapped = reasons.length > 0 && usable.length === mapped.length;
  const confidences = mapped.flatMap((m) => (m.kind === "needs_human" ? [] : [m.confidence]));
  const source: "code" | "model" = mapped.every((m) => m.kind === "mapped" && m.source === "code") ? "code" : "model";
  const model = mapped.flatMap((m) => (m.kind === "needs_human" ? [] : m.model ? [m.model] : []))[0] ?? null;
  const codes = reasons.map((r) => r.code).filter((c) => CODE.test(c));

  return withSpaTx(ctx.database, async (tx) => {
    // One fix per deal and kind, ever (a second rejection of any kind is a task).
    const fixedBefore = await tx.db
      .select({ id: registryRejections.id })
      .from(registryRejections)
      .innerJoin(registrations, eq(registrations.id, registryRejections.registrationId))
      .where(
        and(eq(registrations.dealId, deal.id), eq(registrations.kind, kind), eq(registryRejections.action, "fixed")),
      );
    // Off (S59): no auto-fix at all; every rejection is the sales admin's task, as for any other kind.
    const fixOff = (await helperMode(tx.db, "registry")) === "off";
    let canFix =
      !fixOff &&
      !needsHuman &&
      allMapped &&
      fields.every((f) => REGISTRY_NAME_FIELDS.includes(f)) &&
      !fixedBefore.length;
    if (canFix) {
      const [fresh] = await tx.db.select().from(deals).where(eq(deals.id, deal.id));
      const built = await buildRegistryPayload(ctx, tx, fresh!, kind);
      canFix = built.ok && (await planNameFixes(tx, deal, kind, built.payload, fields)).ok;
    }
    const action = canFix ? ("fixed" as const) : ("task" as const);
    let taskId: string | null = null;
    if (action === "task") {
      const words = fields.length
        ? fields.map((f) => FIELD_WORDS[f])
        : ["the registry gave a reason that could not be sorted by a rule"];
      const t = await openTask(ctx, tx, {
        dealId: deal.id,
        kind: "registry_rejected",
        role: "sales_admin",
        title: `${SERVICE_LABEL[kind]} was rejected: ${words.join("; ")}. Check the deal's records, then request it again.`,
        detail: { kind, attempt: row.attempt, codes, fields },
        dedupeKey: `${row.id}:registry_rejected`,
      });
      taskId = t.id;
    }
    const [rec] = await tx.db
      .insert(registryRejections)
      .values({
        id: newId(),
        registrationId: row.id,
        codes,
        mappedField: fields.length ? fields.join(",") : null,
        mappedConfidence: confidences.length ? String(round2(Math.min(...confidences))) : null,
        source,
        action,
        taskId,
        createdAt: ctx.clock.now(),
      })
      .returning();
    const decisionRunId = await insertDecisionRun(ctx, tx, deal, {
      status: action === "fixed" ? "ok" : "needs_human",
      result: {
        kind,
        attempt: row.attempt,
        action,
        field: fields.join(",") || null,
        source,
        codes,
        // What a held fix needs to be resubmitted once a person releases it (S59).
        ...(action === "fixed" ? { registrationId: row.id, approvalId } : {}),
      },
      reasons:
        action === "fixed"
          ? ["A name differed only by case or spacing from the verified name; it was corrected once and resubmitted."]
          : needsHuman
            ? ["The decision model gave no valid answer; a person needs to look."]
            : ["A person needs to look at this rejection."],
      modelTag: model,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: deal.id },
      type: "REGISTRATION_REJECTION_HANDLED",
      rulesVersion: deal.rulesVersion,
      actor: REGISTRY_ACTOR,
      payload: { kind, attempt: row.attempt, action, fields, source, codes, approvalId },
    });
    // Review mode (S59): only the auto-fix is held; the resubmission waits for a person's "looks right".
    if (action === "fixed")
      await afterHelperResult(ctx, tx, {
        helper: "registry",
        scope: "*",
        dealId: deal.id,
        runId: decisionRunId,
        status: "ok",
      });
    return rec!;
  });
}

async function openUnavailableTask(
  ctx: SpaContext,
  deal: DealRow,
  kind: RegistryKind,
  approvalId: string,
  attempt: number,
  why: "four_failures" | "payload_changed",
  tx?: SpaTx,
) {
  const run = async (t: SpaTx) =>
    openTask(ctx, t, {
      dealId: deal.id,
      kind: "registry_unavailable",
      role: "sales_admin",
      title:
        why === "four_failures"
          ? `${SERVICE_LABEL[kind]} could not be sent: the registry did not answer after four tries. Request it again later.`
          : `${SERVICE_LABEL[kind]} was not retried because the deal's details changed since the first try. Request it again.`,
      detail: { kind, attempt, why },
      dedupeKey: `${deal.id}:${kind}:${approvalId}:registry_unavailable`,
    });
  return tx ? run(tx) : withSpaTx(ctx.database, run);
}

async function settleUnavailable(
  ctx: SpaContext,
  deps: RegistryRunDeps,
  deal: DealRow,
  kind: RegistryKind,
  approvalId: string,
  row: typeof registrations.$inferSelect,
): Promise<RegistryRunOutcome> {
  const [done] = await ctx.database.db
    .select()
    .from(registryRejections)
    .where(eq(registryRejections.registrationId, row.id));
  if (done) return { outcome: done.action === "retry" ? "retry_queued" : "task" };
  const tries = (
    await ctx.database.db
      .select({ id: registrations.id })
      .from(registrations)
      .where(
        and(
          sameRow(deal.id, kind, approvalId),
          eq(registrations.attempt, row.attempt),
          eq(registrations.status, "unavailable"),
        ),
      )
      .orderBy(asc(registrations.createdAt))
  ).length;
  if (tries < MAX_TRIES) {
    const data: RegistrySubmitData = { dealId: deal.id, approvalId, kind, retryAttempt: row.attempt };
    // Queued before it is recorded: a crash in between queues the same key again, which pg-boss ignores.
    await deps.boss.send(jobOf(kind), data, {
      startAfter: registryRetryDelays[tries - 1]!,
      singletonKey: `${deal.id}:${kind}:${approvalId}:${row.attempt}:retry:${tries}`,
    });
  }
  await withSpaTx(ctx.database, async (tx) => {
    const queued = tries < MAX_TRIES;
    const t = queued ? null : await openUnavailableTask(ctx, deal, kind, approvalId, row.attempt, "four_failures", tx);
    await tx.db.insert(registryRejections).values({
      id: newId(),
      registrationId: row.id,
      codes: ["unavailable"],
      mappedField: null,
      mappedConfidence: null,
      source: "code",
      action: queued ? "retry" : "task",
      taskId: t?.id ?? null,
      createdAt: ctx.clock.now(),
    });
    await insertDecisionRun(ctx, tx, deal, {
      status: queued ? "ok" : "needs_human",
      result: { kind, attempt: row.attempt, action: queued ? "retry" : "task", tries },
      reasons: [
        queued
          ? `The registry was unavailable; the same request is tried again in ${registryRetryDelays[tries - 1]! / 60} minutes.`
          : "The registry was unavailable four times; a person needs to request it again.",
      ],
    });
  });
  return tries < MAX_TRIES ? { outcome: "retry_queued" } : { outcome: "task" };
}
