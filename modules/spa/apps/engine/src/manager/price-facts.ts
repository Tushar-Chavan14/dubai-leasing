import { spaApprovals, type SpaTx } from "@spa/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import type { DealRow } from "./facts.ts";

/**
 * Real since M6 (S81): a price or booking amount outside policy opens a `price_out_of_range` approval whose proposal
 * names its `kind` ("price" or "booking"); a broker commission override uses the same gate with no `kind` and does not
 * count here. Cleared only when none of the deal's price or booking approvals is still pending or was refused: an
 * approved one (or one the manager edited) lets the deal take its first step.
 */
export async function priceClearedFact(tx: SpaTx, row: DealRow): Promise<boolean> {
  const open = await tx.db
    .select({ id: spaApprovals.id })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "price_out_of_range"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, row.id),
        inArray(spaApprovals.status, ["pending", "rejected"]),
        sql`${spaApprovals.proposal}->>'kind' in ('price', 'booking')`,
      ),
    )
    .limit(1);
  return open.length === 0;
}
