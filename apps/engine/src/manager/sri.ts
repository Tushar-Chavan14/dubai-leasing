import type { CalendarDate } from "@leasing/core";
import { leases, sriAverages, sriOverrides, type Tx, units } from "@leasing/db";
import { and, desc, eq, lte } from "drizzle-orm";

const bedroomsName = (n: number) => (n === 0 ? "studio" : `${n}-bed`);

export interface SriValue {
  avgAnnualRentFils: number;
  source: "override" | "table";
  label: string;
  /** Override only: the staff actor who entered it. */
  enteredBy?: string;
}

/**
 * The SRI value for a lease's renewal: a staff override entered for this term wins; otherwise
 * the latest table value for the unit's community and bedroom count in effect on `today`.
 */
export async function lookupSri(
  tx: Tx,
  lease: { id: string; endOn: CalendarDate },
  today: CalendarDate,
): Promise<SriValue | null> {
  const leaseId = lease.id;
  const [override] = await tx.db
    .select()
    .from(sriOverrides)
    .where(and(eq(sriOverrides.leaseId, leaseId), eq(sriOverrides.leaseEndOn, lease.endOn)))
    .orderBy(desc(sriOverrides.at))
    .limit(1);
  if (override) {
    return {
      avgAnnualRentFils: override.avgAnnualRentFils,
      source: "override",
      label: `Entered by staff: ${override.reason}`,
      enteredBy: override.enteredBy,
    };
  }
  const [row] = await tx.db
    .select({ community: units.community, bedrooms: units.bedrooms })
    .from(leases)
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(eq(leases.id, leaseId));
  if (!row || row.bedrooms === null) return null;
  const [avg] = await tx.db
    .select()
    .from(sriAverages)
    .where(
      and(
        eq(sriAverages.community, row.community),
        eq(sriAverages.bedrooms, row.bedrooms),
        lte(sriAverages.effectiveFrom, today),
      ),
    )
    .orderBy(desc(sriAverages.effectiveFrom))
    .limit(1);
  if (!avg) return null;
  return {
    avgAnnualRentFils: avg.avgAnnualRentFils,
    source: "table",
    label: `${row.community}, ${bedroomsName(row.bedrooms)} (${avg.source === "mock" ? "demo SRI table" : "SRI table"}, from ${avg.effectiveFrom})`,
  };
}
