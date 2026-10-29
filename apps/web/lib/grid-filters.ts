import type { ChatFilters } from "@leasing/core";
import type { PropertyCategory, PublicUnitSummary } from "./listings";

/** What the listing grid filters on. The chat's `ChatFilters` minus the emirate (Dubai is the only one). */
export type GridFilters = Pick<ChatFilters, "community" | "category" | "bedrooms" | "sizeBand" | "maxRentFils">;
export type SizeBand = NonNullable<GridFilters["sizeBand"]>;

export const NO_FILTERS: GridFilters = {
  community: null,
  category: null,
  bedrooms: null,
  sizeBand: null,
  maxRentFils: null,
};

/** Same bands as the chat (`SIZE_BAND_LIMITS` in core), in sq ft. */
export const SIZE_BANDS: { key: SizeBand; label: string; min?: number; max?: number }[] = [
  { key: "small", label: "Up to 1,000 sqft", max: 1000 },
  { key: "medium", label: "1,001 to 3,000 sqft", min: 1001, max: 3000 },
  { key: "large", label: "Over 3,000 sqft", min: 3001 },
];

export const CATEGORY_LABEL: Record<PropertyCategory, string> = {
  residential: "Residential",
  commercial: "Commercial",
  retail: "Retail",
};

export const bedroomChipLabel = (b: number) => (b === 0 ? "Studio" : b >= 4 ? "4+ bed" : `${b} bed`);
export const aed = (fils: number) => `AED ${Math.round(fils / 100).toLocaleString("en")}`;

export const isActive = (f: GridFilters) => Object.values(f).some((v) => v !== null);
export const sameFilters = (a: GridFilters, b: GridFilters) =>
  a.community === b.community &&
  a.category === b.category &&
  a.bedrooms === b.bedrooms &&
  a.sizeBand === b.sizeBand &&
  a.maxRentFils === b.maxRentFils;

export const fromChat = (f: ChatFilters): GridFilters => ({
  community: f.community,
  category: f.category,
  bedrooms: f.bedrooms,
  sizeBand: f.sizeBand,
  maxRentFils: f.maxRentFils,
});

/** The same rules as the engine's search (`listedUnits`): a size band only applies to commercial and retail. */
export function filterUnits(units: PublicUnitSummary[], f: GridFilters): PublicUnitSummary[] {
  const band = SIZE_BANDS.find((b) => b.key === f.sizeBand);
  return units.filter((u) => {
    if (f.community && u.community !== f.community) return false;
    if (f.category && u.category !== f.category) return false;
    if (f.maxRentFils !== null && u.rentFils > f.maxRentFils) return false;
    if (f.bedrooms !== null && (f.bedrooms >= 4 ? (u.bedrooms ?? 0) < 4 : u.bedrooms !== f.bedrooms)) return false;
    if (band && f.category !== null && f.category !== "residential") {
      if (u.areaSqft === null) return false;
      if (band.min !== undefined && u.areaSqft < band.min) return false;
      if (band.max !== undefined && u.areaSqft > band.max) return false;
    }
    return true;
  });
}

/** What a chip does to the filters at once; the chat's reply then replaces it with the truth. Mirrors the engine's callbacks. */
export type Chip =
  | { kind: "community"; community: string | null }
  | { kind: "category"; category: PropertyCategory }
  | { kind: "bedrooms"; bedrooms: number }
  | { kind: "size"; size: SizeBand }
  | { kind: "budget-clear" }
  | { kind: "reset" };

export function applyChip(f: GridFilters, c: Chip): GridFilters {
  switch (c.kind) {
    case "community":
      return { ...f, community: c.community === f.community ? null : c.community };
    case "category":
      if (c.category === f.category) return { ...f, category: null, bedrooms: null, sizeBand: null };
      return {
        ...f,
        category: c.category,
        bedrooms: c.category === "residential" ? f.bedrooms : null,
        sizeBand: c.category === "residential" ? null : f.sizeBand,
      };
    case "bedrooms":
      return { ...f, category: "residential", bedrooms: c.bedrooms, sizeBand: null };
    case "size":
      return {
        ...f,
        category: f.category && f.category !== "residential" ? f.category : "commercial",
        bedrooms: null,
        sizeBand: c.size,
      };
    case "budget-clear":
      return { ...f, maxRentFils: null };
    case "reset":
      return NO_FILTERS;
  }
}

/** The URL query for the filters (shareable). Budget is whole AED. */
export function toQuery(f: GridFilters): string {
  const q = new URLSearchParams();
  if (f.community) q.set("area", f.community);
  if (f.category) q.set("type", f.category);
  if (f.bedrooms !== null) q.set("beds", String(f.bedrooms));
  if (f.sizeBand) q.set("size", f.sizeBand);
  if (f.maxRentFils !== null) q.set("budget", String(Math.round(f.maxRentFils / 100)));
  return q.toString();
}

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Read the query back; anything unknown or malformed is dropped. */
export function fromParams(p: Params, communities: string[]): GridFilters {
  const area = one(p.area);
  const type = one(p.type);
  const beds = one(p.beds);
  const size = one(p.size);
  const budget = one(p.budget);
  const category = type === "residential" || type === "commercial" || type === "retail" ? type : null;
  const bedrooms = beds !== undefined && /^[0-4]$/.test(beds) ? Number(beds) : null;
  const sizeBand = SIZE_BANDS.find((b) => b.key === size)?.key ?? null;
  const aedBudget = budget !== undefined && /^\d{1,9}$/.test(budget) ? Number(budget) : null;
  return {
    community: area && communities.includes(area) ? area : null,
    category,
    bedrooms: category === "residential" || category === null ? bedrooms : null,
    sizeBand: category === "commercial" || category === "retail" ? sizeBand : null,
    maxRentFils: aedBudget && aedBudget >= 1 ? aedBudget * 100 : null,
  };
}

/** The engine's `GET /public/units` query for the filters (category defaults to all, as the grid shows every kind). */
export function toEngineQuery(f: GridFilters): string {
  const q = new URLSearchParams({ category: f.category ?? "all" });
  if (f.community) q.set("community", f.community);
  if (f.bedrooms !== null) q.set("bedrooms", String(f.bedrooms));
  if (f.sizeBand) q.set("size", f.sizeBand);
  if (f.maxRentFils !== null) q.set("budget", String(Math.round(f.maxRentFils / 100)));
  return q.toString();
}
