/** Shapes and helpers for the public listings (engine `/public/units`). Safe to import from client code. */
export interface PublicUnitSummary {
  id: string;
  code: string;
  building: string;
  community: string;
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnished: boolean;
  rent: string;
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

export const bedsLabel = (b: number | null) => (b === null ? null : b === 0 ? "Studio" : `${b} bed`);

export function factsList(u: {
  bedrooms: number | null;
  bathrooms: number | null;
  areaSqft: number | null;
  furnished: boolean | null;
}) {
  return [
    bedsLabel(u.bedrooms),
    u.bathrooms === null ? null : `${u.bathrooms} bath`,
    u.areaSqft === null ? null : `${Math.round(u.areaSqft).toLocaleString("en")} sqft`,
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

const hue = (s: string) => {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) % 360;
  return h;
};

/** P8: a generated placeholder (never a stock image): a gradient in the brand's green–slate range. */
export function placeholderStyle(seed: string) {
  const h = 140 + (hue(seed) % 90); // 140–230: green through teal to slate blue
  return {
    background: `radial-gradient(120% 90% at 85% 8%, hsl(${h + 25} 28% 62% / 0.55), transparent 60%), linear-gradient(165deg, hsl(${h} 30% 30%), hsl(${h + 20} 34% 14%))`,
  };
}
