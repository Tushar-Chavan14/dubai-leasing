import type { SpaActor } from "@spa/core";
import { amlCases, deals, type spaApprovals, type SpaTx } from "@spa/db";
import { eq } from "drizzle-orm";
import { advance } from "./advance.ts";
import type { SpaContext } from "./context.ts";

type Outcome = "clear" | "more_info" | "stop" | "stop_and_report";
const STATUS = { clear: "cleared", more_info: "info_requested", stop: "stopped", stop_and_report: "reported" } as const;

/**
 * A compliance officer's `aml_flag` decision reaches the case and the deal (S50), inside `decideApproval`'s
 * transaction. Clear closes the case and returns the deal to `PARTY_CHECK`; more_info keeps the case and the hold (no
 * message goes to anyone: compliance records the request, a new screening opens a new round); stop and stop-and-report
 * close the case and cancel the deal. An approval with no case (opened by hand) moves nothing.
 */
export async function applyAmlDecision(
  tx: SpaTx,
  ctx: SpaContext,
  approval: typeof spaApprovals.$inferSelect,
  outcome: Outcome,
  actor: SpaActor,
): Promise<void> {
  const [c] = await tx.db.select().from(amlCases).where(eq(amlCases.approvalId, approval.id)).for("update");
  if (!c) return;
  await tx.db
    .update(amlCases)
    .set({ status: STATUS[outcome], closedAt: outcome === "more_info" ? null : ctx.clock.now() })
    .where(eq(amlCases.id, c.id));
  if (outcome === "more_info") return;
  const [deal] = await tx.db.select({ state: deals.state }).from(deals).where(eq(deals.id, c.dealId));
  if (deal?.state !== "AML_HOLD") return;
  await advance(ctx, { kind: "deal", id: c.dealId }, outcome === "clear" ? "AML_CLEARED" : "AML_STOPPED", {
    actor,
    approvalId: approval.id,
    tx,
  });
}
