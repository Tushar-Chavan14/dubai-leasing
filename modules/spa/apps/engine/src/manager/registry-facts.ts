import { registrations, type SpaTx } from "@spa/db";
import { and, eq, inArray } from "drizzle-orm";
import type { DealRow } from "./facts.ts";

/** The registration kinds whose issued row counts as the transfer, per resale type: trustee for a ready one, Oqood for off-plan. */
const TRANSFER_KIND = { resale_ready: "trustee_transfer", resale_offplan: "oqood_transfer" } as const;

async function hasIssued(
  tx: SpaTx,
  dealId: string,
  kinds: readonly ("oqood_register" | "oqood_transfer" | "trustee_transfer")[],
) {
  const rows = await tx.db
    .select({ id: registrations.id })
    .from(registrations)
    .where(
      and(
        eq(registrations.dealId, dealId),
        eq(registrations.status, "issued"),
        inArray(registrations.kind, [...kinds]),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

/** The `oqoodIssued` fact (S53), real and fail-closed: the registry issued a number for this deal's Oqood registration. */
export const oqoodIssuedFact = (tx: SpaTx, deal: DealRow): Promise<boolean> =>
  deal.dealType === "primary_offplan" ? hasIssued(tx, deal.id, ["oqood_register"]) : Promise.resolve(false);

/**
 * The `transferIssued` fact (S53): an issued trustee transfer (ready resale) or an issued Oqood transfer (off-plan
 * resale). A primary deal never has one, whatever rows exist. Rejected and unavailable attempts count for nothing.
 */
export const transferIssuedFact = (tx: SpaTx, deal: DealRow): Promise<boolean> =>
  deal.dealType === "primary_offplan" ? Promise.resolve(false) : hasIssued(tx, deal.id, [TRANSFER_KIND[deal.dealType]]);
