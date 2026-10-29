import type { CalendarDate, CompanyPolicy, PropertyCategory } from "@leasing/core";
import { applications, companies, type Tx, units } from "@leasing/db";
import { and, asc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import { unitHasContractedLease } from "./advance.ts";
import { priceSettledFor } from "./pricing.ts";
import { freeViewingSlots } from "./viewing-slots.ts";

/**
 * Which units can be booked for a viewing, and when. One rule for every channel that books:
 * the Telegram bot and the staff copilot.
 */

type UnitRow = typeof units.$inferSelect;
export type Filters = {
  bedrooms?: number | undefined;
  community?: string | undefined;
  /** Only this company's units. */
  companyId?: string | undefined;
  /** Furnished or not (unknown counts as not furnished). */
  furnished?: boolean | undefined;
  /** Annual asking rent at most this (fils). */
  maxRentFils?: number | undefined;
  /** Default (unset) is residential only, for Telegram and staff; the web chat passes a category or "all". */
  category?: PropertyCategory | "all" | undefined;
  emirate?: string | undefined;
  /** Floor area bounds, sq ft (a unit without an area never matches a bound). */
  minAreaSqft?: number | undefined;
  maxAreaSqft?: number | undefined;
  /** One unit by its code (exact, ignoring case). */
  code?: string | undefined;
};

/**
 * The unit's asking rent is settled: set, and inside the allowed range (company rent rule and SRI)
 * or approved by a manager (the same rule as MARK_READY; `price_approved_at` exists only for
 * out-of-range prices).
 */
export const priceSettled = (tx: Tx, u: UnitRow, today: CalendarDate) => priceSettledFor(tx, u, today);

/** Residential units staff have listed with a settled price, and no lease being signed; cheapest first. */
export async function listedUnits(tx: Tx, today: CalendarDate, f: Filters, max = 5): Promise<UnitRow[]> {
  const rows = await tx.db
    .select()
    .from(units)
    .where(
      and(
        eq(units.state, "LISTED"),
        ...(f.category === "all" ? [] : [eq(units.category, f.category ?? "residential")]),
        ...(f.emirate ? [eq(units.emirate, f.emirate)] : []),
        ...(f.minAreaSqft !== undefined ? [gte(units.areaSqft, f.minAreaSqft)] : []),
        ...(f.maxAreaSqft !== undefined ? [lte(units.areaSqft, f.maxAreaSqft)] : []),
        isNotNull(units.askingRentFils),
        ...(f.community ? [eq(units.community, f.community)] : []),
        ...(f.companyId ? [eq(units.companyId, f.companyId)] : []),
        ...(f.maxRentFils !== undefined ? [lte(units.askingRentFils, f.maxRentFils)] : []),
        ...(f.code ? [sql`lower(${units.code}) = lower(${f.code})`] : []),
      ),
    )
    .orderBy(asc(units.askingRentFils), asc(units.code));
  const wanted = rows.filter(
    (u) =>
      (f.furnished === undefined || (u.furnished ?? false) === f.furnished) &&
      (f.bedrooms === undefined ? true : f.bedrooms >= 4 ? (u.bedrooms ?? 0) >= 4 : u.bedrooms === f.bedrooms),
  );
  const out: UnitRow[] = [];
  for (const u of wanted) {
    if (out.length >= max) break;
    if ((await priceSettled(tx, u, today)) && !(await unitHasContractedLease(tx, u.id))) out.push(u);
  }
  return out;
}

export async function listedUnit(
  tx: Tx,
  today: CalendarDate,
  unitId: string,
  anyCategory = false,
): Promise<UnitRow | null> {
  const [u] = await tx.db.select().from(units).where(eq(units.id, unitId));
  if (
    !u ||
    u.state !== "LISTED" ||
    (!anyCategory && u.category !== "residential") ||
    !(await priceSettled(tx, u, today))
  )
    return null;
  return (await unitHasContractedLease(tx, u.id)) ? null : u;
}

/**
 * The areas and bedroom counts the web chat may offer: only what a customer can actually book
 * (the same filter as `listedUnits`), so a button never leads to "nothing matches".
 * `bedrooms` is bucketed like the filter: 4 stands for 4 or more.
 */
export async function bookableFacets(
  tx: Tx,
  today: CalendarDate,
  f: Filters = {},
): Promise<{
  communities: string[];
  bedrooms: number[];
  categories: PropertyCategory[];
  rents: number[];
  areas: number[];
}> {
  const rows = await listedUnits(tx, today, f, 500);
  return {
    categories: [...new Set(rows.map((u) => u.category))],
    areas: rows.flatMap((u) => (u.areaSqft === null ? [] : [u.areaSqft])),
    rents: rows.map((u) => u.askingRentFils!).toSorted((a, b) => a - b),
    communities: [...new Set(rows.map((u) => u.community))].sort(),
    bedrooms: [...new Set(rows.map((u) => Math.min(u.bedrooms ?? 0, 4)))].sort((a, b) => a - b),
  };
}

export async function listedCommunities(tx: Tx, anyCategory = false): Promise<string[]> {
  const rows = await tx.db
    .selectDistinct({ community: units.community })
    .from(units)
    .where(and(eq(units.state, "LISTED"), ...(anyCategory ? [] : [eq(units.category, "residential")])))
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
  today: CalendarDate,
  policy: CompanyPolicy,
  f: Filters,
  opts: { units: number; slotsPerUnit: number },
): Promise<{ unit: UnitRow; slots: Date[] }[]> {
  const found = await listedUnits(tx, today, f, opts.units);
  const out: { unit: UnitRow; slots: Date[] }[] = [];
  for (const unit of found) {
    out.push({ unit, slots: freeViewingSlots(now, policy, await takenViewings(tx, unit.id), opts.slotsPerUnit) });
  }
  return out;
}

const budgetStep = (v: number) => (v < 60_000 ? 5_000 : v < 200_000 ? 10_000 : v < 1_000_000 ? 50_000 : 100_000);

/**
 * Budget chips for the web chat: up to two yearly-rent ceilings (AED) at the lower and middle
 * third of the matching units' asking rents, rounded up to a friendly step. Empty when every
 * unit already falls under the first one (nothing to choose). `rentsFils` is sorted ascending.
 */
export function budgetBands(rentsFils: number[]): number[] {
  const n = rentsFils.length;
  if (n < 2) return [];
  const aed = rentsFils.map((r) => Math.ceil(r / 100));
  const up = (v: number) => Math.ceil(v / budgetStep(v)) * budgetStep(v);
  const top = up(aed[n - 1]!);
  const cuts = [aed[Math.ceil(n / 3) - 1]!, aed[Math.ceil((2 * n) / 3) - 1]!].map(up);
  return [...new Set(cuts)].filter((v) => v < top);
}

/**
 * A company by name or slug: exact match first, else a unique partial match (two or more letters).
 * `ambiguous` and `unknown` carry the names the caller can offer (unknown: only companies with listings).
 * One rule for the public chat agent and the staff copilot.
 */
export async function resolveCompany(
  tx: Tx,
  today: CalendarDate,
  text: string,
): Promise<{ ok: true; id: string; name: string } | { ok: false; reason: "ambiguous" | "unknown"; names: string[] }> {
  const q = text.trim().toLowerCase();
  const active = await tx.db
    .select({ id: companies.id, name: companies.name, slug: companies.slug })
    .from(companies)
    .where(eq(companies.active, true));
  const exact = active.filter((k) => k.name.toLowerCase() === q || k.slug.toLowerCase() === q);
  const hits = exact.length
    ? exact
    : q.length >= 2
      ? active.filter((k) => k.name.toLowerCase().includes(q) || k.slug.toLowerCase().includes(q))
      : [];
  if (hits.length > 1) return { ok: false, reason: "ambiguous", names: hits.map((k) => k.name) };
  if (!hits.length) {
    const listed = await listedUnits(tx, today, { category: "all" }, 500);
    const ids = new Set(listed.map((u) => u.companyId));
    return { ok: false, reason: "unknown", names: active.filter((k) => ids.has(k.id)).map((k) => k.name) };
  }
  return { ok: true, id: hits[0]!.id, name: hits[0]!.name };
}
