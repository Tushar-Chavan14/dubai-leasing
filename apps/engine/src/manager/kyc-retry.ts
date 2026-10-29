import type { Actor } from "@leasing/core";
import { applications, inboundEvents, leaseEvents, tasks, withTx } from "@leasing/db";
import { and, count, eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { appendEvent } from "./events.ts";
import { INBOUND_JOB } from "./inbound.ts";
import { kycCheckState, kycStuckMs } from "./kyc-check.ts";

/**
 * "Retry document check": runs the same submission again. Allowed only when the last check
 * failed or has run past the stuck threshold; refused while one is still running. Each retry is
 * an audited event and queues one job with singletonKey `<applicationId>:kyc:<attempt>`, so a
 * double click queues nothing new. Whichever run finishes first applies; the other finds the
 * submission already processed and stops.
 */
export async function retryKycCheck(ctx: EngineContext, appId: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, appId)).for("update");
    if (!app) throw notFound("application");
    const st = await kycCheckState(tx.db, appId, ctx.clock.now(), kycStuckMs(ctx));
    if (st.state === "none") throw conflict("There is no document check to retry.", "no_check");
    if (st.state === "running") {
      throw conflict(
        "A document check is already running. It can be retried if it hasn't finished in a few minutes.",
        "check_running",
      );
    }
    const [row] = await tx.db
      .select({ n: count() })
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, appId), eq(leaseEvents.type, "KYC_CHECK_RETRY_REQUESTED")));
    const attempt = Number(row?.n ?? 0) + 2; // the first run was attempt 1
    await tx.db
      .update(inboundEvents)
      .set({ status: "received", result: null, processedAt: null })
      .where(eq(inboundEvents.id, st.inboundId));
    await tx.db
      .update(tasks)
      .set({ status: "cancelled" })
      .where(and(eq(tasks.entityId, appId), eq(tasks.kind, "kyc_check_failed"), eq(tasks.status, "open")));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: appId },
      type: "KYC_CHECK_RETRY_REQUESTED",
      actor,
      payload: { inboundEventId: st.inboundId, inboundRef: st.ref, attempt, after: st.state, reason: st.reason },
      rulesVersion: ctx.rulesVersion,
    });
    await ctx.scheduler.send(tx, {
      name: INBOUND_JOB,
      data: { inboundEventId: st.inboundId, attempt },
      singletonKey: `${appId}:kyc:${attempt}`,
    });
    return { queued: true, attempt };
  });
}
