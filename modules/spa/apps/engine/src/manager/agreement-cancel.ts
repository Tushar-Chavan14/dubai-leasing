import type { SpaActor } from "@spa/core";
import { agreements, deals, spaApprovals, type SpaTx } from "@spa/db";
import { and, eq, ne } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { supersedeEnvelopes } from "./signing.ts";
import { appendDealEvent } from "./events.ts";

/**
 * A cancelled deal's live agreement is superseded and its pending `agreement_approval` cancelled (C20, closing the S51
 * known gap), the same way the settlement statement is (S48): nobody should approve what no longer holds.
 */
export async function supersedeAgreementOnCancel(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  actor: SpaActor,
): Promise<void> {
  const live = await tx.db
    .select()
    .from(agreements)
    .where(and(eq(agreements.dealId, dealId), ne(agreements.status, "superseded")));
  const [d] = await tx.db.select({ v: deals.rulesVersion }).from(deals).where(eq(deals.id, dealId));
  await supersedeEnvelopes(
    ctx,
    tx,
    dealId,
    live.map((a) => a.id),
    actor,
    d?.v ?? null,
  );
  for (const a of live) {
    await tx.db.update(agreements).set({ status: "superseded" }).where(eq(agreements.id, a.id));
    if (a.approvalId)
      await tx.db
        .update(spaApprovals)
        .set({ status: "cancelled" })
        .where(and(eq(spaApprovals.id, a.approvalId), eq(spaApprovals.status, "pending")));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "AGREEMENT_SUPERSEDED",
      actor,
      rulesVersion: d?.v ?? null,
      payload: { agreementId: a.id, version: a.version, reason: "deal cancelled" },
    });
  }
}
