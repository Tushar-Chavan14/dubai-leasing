import type { Emirate } from "@leasing/core";

/** Shapes and helpers for the public listings (engine `/public/units`). Safe to import from client code. */
export type PropertyCategory = "residential" | "commercial" | "retail";

export interface PublicUnitSummary {
  id: string;
  code: string;
  building: string;
  community: string;
  emirate: Emirate;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnished: boolean;
  category: PropertyCategory;
  subtype: string | null;
  rent: string;
  /** Asking rent a year, fils (the grid filters on it; the text above is the one shown). */
  rentFils: number;
  description: string | null;
  photoUrls: string[];
}

export interface PublicUnitDetail extends PublicUnitSummary {
  floor: number | null;
  parkingSpaces: number | null;
  virtualTourUrl: string | null;
}

export interface Slot {
  at: string;
  label: string;
}

const ENGINE_PHOTO = /^\/public\/units\/[0-9a-f-]{36}\/photos\/[0-9a-f-]{36}$/i;
/** Engine photo path → the web app's own proxy route, or null for anything unexpected. */
export const photoSrc = (path: string | null | undefined) => (path && ENGINE_PHOTO.test(path) ? `/api${path}` : null);

/** "AED 54,000.00" → "AED 54,000" for display (the engine formats the figure; this only drops the empty fils). */
export const rentShort = (rent: string) => rent.replace(/\.00$/, "");

export const bedsLabel = (b: number | null) => (b === null ? null : b === 0 ? "Studio" : `${b} bed`);

const sqft = (n: number) => `${Math.round(n).toLocaleString("en")} sqft`;

/** "office" → "Office". */
export const subtypeLabel = (s: string | null | undefined) => (s ? s[0]!.toUpperCase() + s.slice(1) : null);

/** The type line on a card: "Retail · Shop", or just the subtype for a home. */
export function typeLabel(u: { category?: PropertyCategory | undefined; subtype?: string | null | undefined }) {
  const sub = subtypeLabel(u.subtype);
  if (!u.category || u.category === "residential") return sub;
  return [subtypeLabel(u.category), sub].filter(Boolean).join(" · ");
}

/** Facts for a card. A commercial or retail unit shows its size, not bedrooms, baths or furnishing. */
export function factsList(u: {
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnished: boolean | null;
  category?: PropertyCategory | undefined;
}) {
  if (u.category && u.category !== "residential") return u.areaSqft === null ? [] : [sqft(u.areaSqft)];
  return [
    bedsLabel(u.bedrooms),
    u.bathrooms === null ? null : `${u.bathrooms} bath`,
    u.areaSqft === null ? null : sqft(u.areaSqft),
    u.furnished === null ? null : u.furnished ? "Furnished" : "Unfurnished",
  ].filter((x): x is string => Boolean(x));
}

export function initials(name: string): string {
  const words = name
    .replace(/[^\p{L}\p{N} ]/gu, "")
    .split(/\s+/)
    .filter(Boolean);
  return (words.length > 1 ? words.slice(0, 2).map((w) => w[0]) : [...(words[0] ?? "DL")].slice(0, 2))
    .join("")
    .toUpperCase();
}

export { hueOf, placeholderStyle } from "@platform/ui/media/hue";
