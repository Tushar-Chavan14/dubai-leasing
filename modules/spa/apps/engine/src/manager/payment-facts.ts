import { paymentPlanRows, payments, type SpaDb, type SpaTx } from "@spa/db";
import { and, asc, eq } from "drizzle-orm";
import type { DealRow } from "./facts.ts";

export interface RowCoverage {
  seq: number;
  label: string;
  dueOn: string | null;
  milestone: string | null;
  amountFils: number;
  /** The sum of this row's counted payments, in fils: only a finance-confirmed amount, only into the escrow account. */
  paidFils: number;
}

/** Each plan row with what counted payments cover of it. A read amount, an unconfirmed row or a non-escrow one adds nothing. */
export async function planCoverage(db: SpaDb, dealId: string): Promise<RowCoverage[]> {
  const rows = await db
    .select()
    .from(paymentPlanRows)
    .where(eq(paymentPlanRows.dealId, dealId))
    .orderBy(asc(paymentPlanRows.seq));
  const counted = await db
    .select({ seq: payments.seq, amountFils: payments.amountFils })
    .from(payments)
    .where(and(eq(payments.dealId, dealId), eq(payments.status, "counted")));
  return rows.map((r) => ({
    seq: r.seq,
    label: r.label,
    dueOn: r.dueOn,
    milestone: r.milestone,
    amountFils: r.amountFils,
    paidFils: counted.filter((p) => p.seq === r.seq).reduce((sum, p) => sum + (p.amountFils ?? 0), 0),
  }));
}

/** A primary deal pays its plan; an off-plan resale pays it only when the buyer took the plan over. */
export const hasInstalmentPlan = (d: Pick<DealRow, "dealType" | "planTakenOver">): boolean =>
  d.dealType === "primary_offplan" || (d.dealType === "resale_offplan" && d.planTakenOver);

/**
 * The `instalmentsPaid` fact (S55), real and fail-closed: the deal has a plan to pay (a primary deal, or an off-plan
 * resale that took one over), the plan has rows, and every row is covered by counted payments in integer fils. A ready
 * resale, a resale with no plan and a deal with no rows are false. The handover is not part of this fact.
 */
export async function instalmentsPaidFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  if (!hasInstalmentPlan(deal)) return false;
  const rows = await planCoverage(tx.db, deal.id);
  return rows.length > 0 && rows.every((r) => r.paidFils >= r.amountFils);
}
