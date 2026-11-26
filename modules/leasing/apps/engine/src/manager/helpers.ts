import { type EntityRef, type Helper, newId } from "@leasing/core";
import { helperRuns, type Tx } from "@leasing/db";
import { type RunRecord, runHelper } from "@leasing/helpers";
import type { z } from "zod";
import type { EngineContext } from "../context.ts";
import { appendEvent } from "./events.ts";

/**
 * Runs a helper through the runner and records it: a `helper_runs` row (input hash, output,
 * status, model, confidence, latency, attempts) and a `HELPER_RAN` event. Helpers return data
 * only; whatever the Manager does with it happens afterwards in the caller.
 */
export async function runAndRecord<C, D>(
  ctx: EngineContext,
  tx: Tx,
  helper: Helper<C, D>,
  schemas: { context: z.ZodType<C>; data: z.ZodType<D> },
  entity: EntityRef,
  step: string,
  context: C,
  rulesVersion: string,
): Promise<{ run: RunRecord<D>; helperRunId: string }> {
  const helperRunId = newId();
  const run = await runOnly(ctx, helper, schemas, entity, step, context, rulesVersion, helperRunId);
  await recordRun(ctx, tx, helper.name, entity, rulesVersion, run, helperRunId);
  return { run, helperRunId };
}

/**
 * Runs a helper without a transaction, for slow model calls that must not hold row locks (the
 * Telegram enquiry flow). The caller records it afterwards with `recordRun`.
 */
export async function runOnly<C, D>(
  ctx: EngineContext,
  helper: Helper<C, D>,
  schemas: { context: z.ZodType<C>; data: z.ZodType<D> },
  entity: EntityRef,
  step: string,
  context: C,
  rulesVersion: string,
  helperRunId: string,
): Promise<RunRecord<D>> {
  // Wall-clock latency is diagnostic only, not domain time.
  return runHelper(
    helper,
    { runId: helperRunId, entity, step, context, rulesVersion, now: ctx.clock.now().toISOString() },
    schemas,
    () => performance.now(),
  );
}

/** Stores a helper run: a `helper_runs` row and a `HELPER_RAN` event. */
export async function recordRun<D>(
  ctx: EngineContext,
  tx: Tx,
  helperName: string,
  entity: EntityRef,
  rulesVersion: string,
  run: RunRecord<D>,
  helperRunId: string,
): Promise<void> {
  const helper = { name: helperName };
  const eventId = await appendEvent(tx, ctx, {
    entity,
    type: "HELPER_RAN",
    actor: `helper:${helper.name}`,
    payload: { helperRunId, helper: helper.name, status: run.result.status, reasons: run.result.reasons },
    rulesVersion,
  });
  await tx.db.insert(helperRuns).values({
    id: helperRunId,
    helper: helper.name,
    entityKind: entity.kind,
    entityId: entity.id,
    inputHash: run.inputHash,
    output: { ...run.result, ...(run.error ? { error: run.error } : {}) },
    status: run.result.status,
    model: run.result.model?.name ?? null,
    confidence: run.result.model?.confidence ?? null,
    latencyMs: Math.round(run.latencyMs),
    attempt: Math.max(1, run.attempts),
    eventId,
    at: ctx.clock.now(),
  });
}
