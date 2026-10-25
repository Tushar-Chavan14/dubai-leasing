import { askingRentWithinRange, type CompanyPolicy } from "@leasing/core";
import { applications, type Tx, units } from "@leasing/db";
import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";
import { unitHasContractedLease } from "./advance.ts";
import { freeViewingSlots } from "./viewing-slots.ts";

/**
 * Which units can be booked for a viewing, and when. One rule for every channel that books:
 * the Telegram bot and the staff copilot.
 */

type UnitRow = typeof units.$inferSelect;
export type Filters = {
  bedrooms?: number | undefined;
  community?: string | undefined;
  /** Furnished or not (unknown counts as not furnished). */
  furnished?: boolean | undefined;
  /** Annual asking rent at most this (fils). */
  maxRentFils?: number | undefined;
  /** One unit by its code (exact, ignoring case). */
  code?: string | undefined;
};

/**
 * The unit's asking rent is settled: set, and inside the company range or approved by a manager
 * (the same rule as MARK_READY; `price_approved_at` exists only for out-of-range prices).
 */
export const priceSettled = (u: UnitRow, policy: CompanyPolicy) =>
  u.askingRentFils !== null && (u.priceApprovedAt !== null || askingRentWithinRange(u, policy));

/** Residential units staff have listed with a settled price, and no lease being signed; cheapest first. */
export async function listedUnits(tx: Tx, f: Filters, policy: CompanyPolicy, max = 5): Promise<UnitRow[]> {
  const rows = await tx.db
    .select()
    .from(units)
    .where(
      and(
        eq(units.state, "LISTED"),
        eq(units.kind, "residential"),
        isNotNull(units.askingRentFils),
        ...(f.community ? [eq(units.community, f.community)] : []),
        ...(f.maxRentFils !== undefined ? [lte(units.askingRentFils, f.maxRentFils)] : []),
        ...(f.code ? [sql`lower(${units.code}) = lower(${f.code})`] : []),
      ),
    )
    .orderBy(asc(units.askingRentFils), asc(units.code));
  const matching = rows.filter(
    (u) =>
      priceSettled(u, policy) &&
      (f.furnished === undefined || (u.furnished ?? false) === f.furnished) &&
      (f.bedrooms === undefined ? true : f.bedrooms >= 4 ? (u.bedrooms ?? 0) >= 4 : u.bedrooms === f.bedrooms),
  );
  const out: UnitRow[] = [];
  for (const u of matching) {
    if (out.length >= max) break;
    if (!(await unitHasContractedLease(tx, u.id))) out.push(u);
  }
  return out;
}

export async function listedUnit(tx: Tx, unitId: string, policy: CompanyPolicy): Promise<UnitRow | null> {
  const [u] = await tx.db.select().from(units).where(eq(units.id, unitId));
  if (!u || u.state !== "LISTED" || u.kind !== "residential" || !priceSettled(u, policy)) return null;
  return (await unitHasContractedLease(tx, u.id)) ? null : u;
}

/**
 * The areas and bedroom counts the web chat may offer: only what a customer can actually book
 * (the same filter as `listedUnits`), so a button never leads to "nothing matches".
 * `bedrooms` is bucketed like the filter: 4 stands for 4 or more.
 */
export async function bookableFacets(
  tx: Tx,
  policy: CompanyPolicy,
  f: Filters = {},
): Promise<{ communities: string[]; bedrooms: number[] }> {
  const rows = await listedUnits(tx, f, policy, 500);
  return {
    communities: [...new Set(rows.map((u) => u.community))].sort(),
    bedrooms: [...new Set(rows.map((u) => Math.min(u.bedrooms ?? 0, 4)))].sort((a, b) => a - b),
  };
}

export async function listedCommunities(tx: Tx): Promise<string[]> {
  const rows = await tx.db
    .selectDistinct({ community: units.community })
    .from(units)
    .where(and(eq(units.state, "LISTED"), eq(units.kind, "residential")))
    .orderBy(asc(units.community))
    .limit(25);
  return rows.map((r) => r.community);
}

/** Booked viewings on the unit (staff, Telegram or copilot). */
export async function takenViewings(tx: Tx, unitId: string): Promise<Date[]> {
  const rows = await tx.db
    .select({ at: applications.viewingAt })
    .from(applications)
    .where(and(eq(applications.unitId, unitId), eq(applications.state, "VIEWING"), isNotNull(applications.viewingAt)));
  return rows.map((r) => r.at!);
}

/** Bookable units with their next free viewing slots (policy hours, Asia/Dubai, from `now`). */
export async function bookableUnitsWithSlots(
  tx: Tx,
  now: Date,
  policy: CompanyPolicy,
  f: Filters,
  opts: { units: number; slotsPerUnit: number },
): Promise<{ unit: UnitRow; slots: Date[] }[]> {
  const found = await listedUnits(tx, f, policy, opts.units);
  const out: { unit: UnitRow; slots: Date[] }[] = [];
  for (const unit of found) {
    out.push({ unit, slots: freeViewingSlots(now, policy, await takenViewings(tx, unit.id), opts.slotsPerUnit) });
  }
  return out;
}
