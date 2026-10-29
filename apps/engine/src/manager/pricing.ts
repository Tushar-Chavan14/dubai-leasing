import {
  allowedAskingRange,
  applyContractRule,
  type CalendarDate,
  type CompanyPolicy,
  type PriceRange,
  type SriBasis,
} from "@leasing/core";
import { contractRules, rentRules, sriAverages, type Tx, units } from "@leasing/db";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import { getCompanyPolicy } from "./events.ts";

export type UnitRow = typeof units.$inferSelect;
export type RentRuleRow = typeof rentRules.$inferSelect;
export type ContractRuleRow = typeof contractRules.$inferSelect;

/** The fields of a unit that decide which rules and SRI row apply. */
export type PricingUnit = Pick<
  UnitRow,
  "companyId" | "category" | "subtype" | "community" | "emirate" | "areaSqft" | "bedrooms"
>;

const newestFirst = <T extends { createdAt: Date; id: string }>(a: T, b: T) =>
  b.createdAt.getTime() - a.createdAt.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

/**
 * The active rent rule for the unit's company, category and emirate. A rule may name a subtype
 * and a community; those must match the unit. Most specific wins (community, then subtype),
 * then the newest.
 */
export async function findRentRule(tx: Tx, unit: PricingUnit): Promise<RentRuleRow | null> {
  const rows = await tx.db
    .select()
    .from(rentRules)
    .where(
      and(
        eq(rentRules.companyId, unit.companyId),
        eq(rentRules.category, unit.category),
        eq(rentRules.emirate, unit.emirate),
        eq(rentRules.active, true),
      ),
    );
  const fits = rows.filter(
    (r) =>
      (r.subtype === null || r.subtype === unit.subtype) && (r.community === null || r.community === unit.community),
  );
  const rank = (r: RentRuleRow) => (r.community !== null ? 2 : 0) + (r.subtype !== null ? 1 : 0);
  fits.sort((a, b) => rank(b) - rank(a) || newestFirst(a, b));
  return fits[0] ?? null;
}

/** Latest SRI row in effect on `today` for the unit's community, category and bedrooms (residential only). */
export async function findSri(
  tx: Tx,
  unit: Pick<PricingUnit, "community" | "category" | "bedrooms">,
  today: CalendarDate,
): Promise<(SriBasis & { id: string }) | null> {
  if (unit.category === "residential" && unit.bedrooms === null) return null;
  const [row] = await tx.db
    .select()
    .from(sriAverages)
    .where(
      and(
        eq(sriAverages.community, unit.community),
        eq(sriAverages.category, unit.category),
        unit.category === "residential" ? eq(sriAverages.bedrooms, unit.bedrooms!) : isNull(sriAverages.bedrooms),
        lte(sriAverages.effectiveFrom, today),
      ),
    )
    .orderBy(desc(sriAverages.effectiveFrom), desc(sriAverages.createdAt))
    .limit(1);
  if (!row) return null;
  const what =
    unit.category === "residential" ? (unit.bedrooms === 0 ? "studio" : `${unit.bedrooms}-bed`) : unit.category;
  return {
    id: row.id,
    avgAnnualRentFils: row.avgAnnualRentFils,
    avgAnnualRentPerSqftFils: row.avgAnnualRentPerSqftFils,
    label: `SRI ${unit.community} ${what}`,
  };
}

export interface PriceRangeResult {
  range: PriceRange | null;
  ruleId: string | null;
  sriId: string | null;
  sriLabel: string | null;
}

/** The allowed asking-rent range for a unit: the company rent rule applied to the SRI. */
export async function priceRangeFor(tx: Tx, unit: PricingUnit, today: CalendarDate): Promise<PriceRangeResult> {
  const rule = await findRentRule(tx, unit);
  const sri = await findSri(tx, unit, today);
  return {
    range: allowedAskingRange(unit, sri, rule),
    ruleId: rule?.id ?? null,
    sriId: sri?.id ?? null,
    sriLabel: sri?.label ?? null,
  };
}

/** The unit's asking rent is set and inside the range, or a manager approved it. */
export async function priceSettledFor(tx: Tx, unit: UnitRow, today: CalendarDate): Promise<boolean> {
  if (unit.askingRentFils === null) return false;
  if (unit.priceApprovedAt !== null) return true;
  const { range } = await priceRangeFor(tx, unit, today);
  return range !== null && unit.askingRentFils >= range.min && unit.askingRentFils <= range.max;
}

/** The active contract rule for the unit's company and category (a subtype match wins, then the newest). */
export async function matchContractRule(tx: Pick<Tx, "db">, unit: PricingUnit): Promise<ContractRuleRow | null> {
  const rows = await tx.db
    .select()
    .from(contractRules)
    .where(
      and(
        eq(contractRules.companyId, unit.companyId),
        eq(contractRules.category, unit.category),
        eq(contractRules.active, true),
      ),
    );
  const fits = rows.filter((r) => r.subtype === null || r.subtype === unit.subtype);
  fits.sort((a, b) => Number(b.subtype !== null) - Number(a.subtype !== null) || newestFirst(a, b));
  return fits[0] ?? null;
}

/** Company policy with the cheque range of the matching active contract rule. */
export async function offerPolicyAndRuleFor(
  tx: Tx,
  unit: PricingUnit,
  today: CalendarDate,
): Promise<{ policy: CompanyPolicy; contractRuleId: string | null }> {
  const policy = await getCompanyPolicy(tx, today);
  const rule = await matchContractRule(tx, unit);
  return { policy: applyContractRule(policy, rule), contractRuleId: rule?.id ?? null };
}

/** Says so when the cheque limits are the company defaults because no contract rule matched. */
export function noteDefaultLimits(problems: string[], contractRuleId: string | null): string[] {
  if (contractRuleId !== null) return problems;
  return problems.map((p) =>
    p.includes("cheques is outside") ? `${p} (company default limits; no contract rule for this unit)` : p,
  );
}

export async function offerPolicyFor(tx: Tx, unit: PricingUnit, today: CalendarDate): Promise<CompanyPolicy> {
  return (await offerPolicyAndRuleFor(tx, unit, today)).policy;
}
