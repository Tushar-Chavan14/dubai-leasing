import { maskPiiText } from "@leasing/core";
import { type KycStep } from "@leasing/helpers";
import { applications, inboundEvents, leaseEvents, type Db, type Tx, withTx } from "@leasing/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { appendEvent } from "./events.ts";

/**
 * The document check as the record shows it (architecture §5, KYC). Steps are audit events by
 * `helper:kyc`; "stuck" and "failed" are derived from the stored submission and the Clock, so
 * nothing here needs the job queue to be reachable.
 */

export const DEFAULT_KYC_STUCK_MINUTES = 10;
export const kycStuckMs = (ctx: Pick<EngineContext, "kyc">) =>
  (ctx.kyc?.stuckMinutes ?? DEFAULT_KYC_STUCK_MINUTES) * 60_000;

const short = (s: string | undefined) => (s ? maskPiiText(s.replace(/\s+/g, " ")).slice(0, 200) : undefined);

/** Writes one step in its own short transaction, so the log fills in while the models work. Never throws. */
export async function logKycStep(
  ctx: EngineContext,
  appId: string,
  attempt: number,
  ref: string,
  step: KycStep,
  extra: { latencyMs?: number } = {},
): Promise<void> {
  const base = { attempt, inboundRef: ref };
  let type: string;
  let payload: Record<string, unknown>;
  switch (step.kind) {
    case "start":
      type = "KYC_CHECK_STARTED";
      payload = {
        ...base,
        documents: step.documents,
        model: step.model ?? null,
        timeoutSeconds: step.timeoutMs / 1000,
      };
      break;
    case "doc":
      type = "KYC_DOC_READ";
      payload = {
        ...base,
        doc: step.doc,
        index: step.index,
        total: step.total,
        ok: step.ok,
        seconds: Math.round(step.ms / 100) / 10,
        ...(step.why ? { why: step.why } : {}),
        ...(step.error ? { error: short(step.error) } : {}),
      };
      break;
    case "assess":
      type = "KYC_DECISION_STEP";
      payload = base;
      break;
    case "result":
      type = step.status === "ok" ? "KYC_CHECK_FINISHED" : "KYC_CHECK_FAILED";
      payload = {
        ...base,
        ...(step.verdict ? { verdict: step.verdict } : {}),
        ...(step.flags !== undefined ? { flags: step.flags } : {}),
        ...(step.reason ? { reason: short(step.reason) } : {}),
        ...(extra.latencyMs !== undefined ? { seconds: Math.round(extra.latencyMs / 100) / 10 } : {}),
      };
      break;
  }
  try {
    await withTx(ctx.database, (tx) =>
      appendEvent(tx, ctx, {
        entity: { kind: "application", id: appId },
        type,
        actor: "helper:kyc",
        payload,
        rulesVersion: ctx.rulesVersion,
      }),
    );
  } catch {
    // The check goes on without its log line.
  }
}

export type KycCheckState =
  | { state: "none" }
  | { state: "running"; inboundId: string; ref: string; since: Date }
  | { state: "stuck"; inboundId: string; ref: string; since: Date; reason: string }
  | { state: "failed"; inboundId: string; ref: string; since: Date; reason: string };

type Reader = Db | Tx["db"];

/**
 * State of the latest document submission of an application still in screening:
 * running (waiting for the Manager), stuck (running longer than `stuckMs`, by the Clock), or
 * failed (the helper ended in `needs_human`). A person may retry a stuck or failed one.
 */
export async function kycCheckState(db: Reader, appId: string, now: Date, stuckMs: number): Promise<KycCheckState> {
  const [app] = await db.select({ state: applications.state }).from(applications).where(eq(applications.id, appId));
  if (app?.state !== "SCREENING") return { state: "none" };
  const [ev] = await db
    .select()
    .from(inboundEvents)
    .where(and(eq(inboundEvents.entityId, appId), eq(inboundEvents.type, "DOCS_UPLOADED")))
    .orderBy(desc(inboundEvents.receivedAt))
    .limit(1);
  if (!ev) return { state: "none" };
  if (ev.status === "stored_only" && (ev.result as { action?: string } | null)?.action === "kyc check failed") {
    return {
      state: "failed",
      inboundId: ev.id,
      ref: ev.ref,
      since: ev.processedAt ?? ev.receivedAt,
      reason: String((ev.result as { reason?: string }).reason ?? "the check could not finish"),
    };
  }
  if (ev.status !== "received") return { state: "none" };
  // A retry restarts the clock.
  const [retry] = await db
    .select({ at: leaseEvents.at })
    .from(leaseEvents)
    .where(and(eq(leaseEvents.entityId, appId), inArray(leaseEvents.type, ["KYC_CHECK_RETRY_REQUESTED"])))
    .orderBy(desc(leaseEvents.at))
    .limit(1);
  const since = retry && retry.at > ev.receivedAt ? retry.at : ev.receivedAt;
  const minutes = Math.floor((now.getTime() - since.getTime()) / 60_000);
  if (now.getTime() - since.getTime() > stuckMs) {
    return {
      state: "stuck",
      inboundId: ev.id,
      ref: ev.ref,
      since,
      reason: `no result after ${minutes} minutes (the model may be busy or stuck)`,
    };
  }
  return { state: "running", inboundId: ev.id, ref: ev.ref, since };
}
