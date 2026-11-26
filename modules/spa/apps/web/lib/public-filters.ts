import { CatalogueQuery, type PublicProperty, UNIT_TYPES, UNIT_TYPE_LABELS } from "@spa/core";

/**
 * The public site's filters in the address and its words (S78). Pure: no engine address or server setting, so the
 * client finder can import it.
 */

/** A photo's address on this site (the engine serves it only while its owner is public). */
export const photoSrc = (id: string | null | undefined): string | undefined => (id ? `/photos/${id}` : undefined);

// ---- filters in the URL --------------------------------------------------------------------

export const SOURCES = [
  { key: "resale", label: "Resale", engine: "listing" },
  { key: "developer", label: "New from developer", engine: "developer" },
] as const;
export const PRICE_BANDS = [
  { key: "u1", label: "Under AED 1M", max: 100_000_000 },
  { key: "1-2", label: "AED 1M to 2M", min: 100_000_000, max: 200_000_000 },
  { key: "2-5", label: "AED 2M to 5M", min: 200_000_000, max: 500_000_000 },
  { key: "5p", label: "AED 5M and above", min: 500_000_000 },
] as const;
export const SORTS = [
  { key: "newest", label: "Newest" },
  { key: "price_asc", label: "Price, low to high" },
  { key: "price_desc", label: "Price, high to low" },
] as const;

export interface Filters {
  source: "resale" | "developer" | null;
  community: string | null;
  type: (typeof UNIT_TYPES)[number] | null;
  beds: number | null;
  price: (typeof PRICE_BANDS)[number]["key"] | null;
  sort: (typeof SORTS)[number]["key"];
}
export const NO_FILTERS: Filters = {
  source: null,
  community: null,
  type: null,
  beds: null,
  price: null,
  sort: "newest",
};

type Params = Record<string, string | string[] | undefined>;
const one = (p: Params, k: string): string | undefined => {
  const v = p[k];
  return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
};

/** Reads the address; anything unknown is dropped, never an error. */
export function fromParams(p: Params): Filters {
  const source = SOURCES.find((s) => s.key === one(p, "source"))?.key ?? null;
  const type = UNIT_TYPES.find((t) => t === one(p, "type")) ?? null;
  const beds = one(p, "beds");
  const price = PRICE_BANDS.find((b) => b.key === one(p, "price"))?.key ?? null;
  const sort = SORTS.find((s) => s.key === one(p, "sort"))?.key ?? "newest";
  const n = beds !== undefined && /^\d{1,2}$/.test(beds) ? Math.min(Number(beds), 4) : null;
  return { source, community: one(p, "community")?.slice(0, 120) ?? null, type, beds: n, price, sort };
}

/** The page's own query string (no leading `?`), only what differs from the default. */
export function toQuery(f: Filters): string {
  const q = new URLSearchParams();
  if (f.source) q.set("source", f.source);
  if (f.community) q.set("community", f.community);
  if (f.type) q.set("type", f.type);
  if (f.beds !== null) q.set("beds", String(f.beds));
  if (f.price) q.set("price", f.price);
  if (f.sort !== "newest") q.set("sort", f.sort);
  return q.toString();
}

/** The engine's query for a set of filters. */
export function toEngineQuery(f: Filters): string {
  const band = PRICE_BANDS.find((b) => b.key === f.price);
  const raw = {
    source: SOURCES.find((s) => s.key === f.source)?.engine,
    community: f.community ?? undefined,
    type: f.type ?? undefined,
    beds: f.beds ?? undefined,
    min: band && "min" in band ? band.min : undefined,
    max: band && "max" in band ? band.max : undefined,
    sort: f.sort,
  };
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(raw)) if (v !== undefined) q.set(k, String(v));
  // Keep the engine's own parser the judge of what is valid.
  CatalogueQuery.parse(Object.fromEntries(q));
  return q.toString();
}

export const isActive = (f: Filters): boolean => toQuery({ ...f, sort: "newest" }) !== "";

// ---- words ------------------------------------------------------------------------------------

/** "AED 1,750,000": whole dirhams unless fils matter (design.md §8). */
export const aed = (fils: number): string => {
  const whole = Math.floor(fils / 100).toLocaleString("en-US");
  return fils % 100 ? `AED ${whole}.${String(fils % 100).padStart(2, "0")}` : `AED ${whole}`;
};
export const bedsShort = (n: number): string => (n === 0 ? "Studio" : `${n} bed`);
export const bedsOption = (n: number): string =>
  n === 0 ? "Studio" : n >= 4 ? "4+ bedrooms" : n === 1 ? "1 bedroom" : `${n} bedrooms`;
export const typeOption = (t: string): string => UNIT_TYPE_LABELS[t as keyof typeof UNIT_TYPE_LABELS] ?? t;

/** The facts on a card: beds, type, size. */
export function cardFacts(p: PublicProperty): string[] {
  return [
    p.bedrooms === null ? null : bedsShort(p.bedrooms),
    p.unitTypeLabel,
    p.sizeSqft === null ? null : `${p.sizeSqft.toLocaleString("en-US")} sq ft`,
  ].filter((x): x is string => !!x);
}
/** "Community · Project" for a card's second line. */
export const placeLine = (p: PublicProperty): string =>
  [p.community, p.projectName].filter((x): x is string => !!x).join(" · ");
