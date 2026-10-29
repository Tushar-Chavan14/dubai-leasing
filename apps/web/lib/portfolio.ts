import { SUBTYPES_BY_CATEGORY } from "@leasing/core";
import type { EngineResult } from "./engine";

export type Category = "residential" | "commercial" | "retail";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "retail", label: "Retail" },
];

export const categoryOf = (raw: string | undefined): Category =>
  CATEGORIES.find((c) => c.value === raw)?.value ?? "residential";

const SUBTYPE_LABEL: Record<string, string> = {
  apartment: "Apartment",
  villa: "Villa",
  townhouse: "Townhouse",
  penthouse: "Penthouse",
  office: "Office",
  shop: "Shop",
  showroom: "Showroom",
  warehouse: "Warehouse",
};
export const subtypeLabel = (s: string | null | undefined) => (s ? (SUBTYPE_LABEL[s] ?? s) : "All types");
export const subtypesFor = (c: Category): { value: string; label: string }[] =>
  SUBTYPES_BY_CATEGORY[c].map((value) => ({ value, label: subtypeLabel(value) }));

export const KIND_LABEL: Record<string, string> = { developer: "Developer", realty: "Realty", owner: "Owner" };
export const TENURE_LABEL: Record<string, string> = { annual: "Annual", short_term: "Short term" };

/** Basis points as a percent with at most one decimal, with a real minus sign: "−5%", "+7.5%". */
export function pctLabel(bp: number): string {
  const n = Math.abs(bp) / 100;
  const text = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
  return `${bp < 0 ? "−" : bp > 0 ? "+" : ""}${text}%`;
}

/** Basis points back to the text of an input: -500 becomes "-5", 750 becomes "7.5". */
export function pctInput(bp: number): string {
  const n = bp / 100;
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, "");
}

/** "-5", "+7.5", "10%" to basis points; null when it isn't a whole or one-decimal percent. */
export function parsePctBp(raw: string): number | null {
  const m = /^([+-]?)(\d{1,3})(?:\.(\d))?\s*%?$/.exec(raw.trim());
  if (!m) return null;
  const bp = Math.round(Number(`${m[2]}.${m[3] ?? "0"}`) * 100);
  return m[1] === "-" ? -bp : bp;
}

/** Whole dirhams ("80,000") to fils; empty is no limit (null); anything else is NaN. */
export function parseWholeAedFils(raw: string): number | null {
  const t = raw.trim().replace(/^AED\s*/i, "");
  if (t === "") return null;
  if (!/^(\d{1,3}(,\d{3})+|\d+)$/.test(t)) return Number.NaN;
  return Number(t.replaceAll(",", "")) * 100;
}

export const aedInput = (fils: number | null) => (fils === null ? "" : String(Math.round(fils / 100)));

const dirhams = (fils: number) => Math.round(fils / 100).toLocaleString("en-US");

/** "AED 80,000 to 140,000", "AED 80,000 or more", "Up to AED 140,000", "No AED limits". */
export function aedLimitsLabel(min: number | null, max: number | null): string {
  if (min !== null && max !== null) return `AED ${dirhams(min)} to ${dirhams(max)}`;
  if (min !== null) return `AED ${dirhams(min)} or more`;
  if (max !== null) return `Up to AED ${dirhams(max)}`;
  return "No AED limits";
}

export interface RuleResult {
  ok?: boolean;
  error?: string;
  reasons?: string[];
  /** Field name from the engine ("minPctBp: ...") to message. */
  fieldErrors?: Record<string, string>;
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Engine error into a form result: Zod "field: message" reasons become field errors. */
export function ruleError(r: EngineResult<unknown>): RuleResult {
  const fieldErrors: Record<string, string> = {};
  const reasons: string[] = [];
  for (const reason of r.error?.reasons ?? []) {
    const m = /^([a-zA-Z]+): (.+)$/.exec(reason);
    if (m?.[1] && m[2]) fieldErrors[m[1]] = cap(m[2]);
    else reasons.push(cap(reason));
  }
  if (r.status === 400) return { error: "Some fields need attention.", reasons, fieldErrors };
  if (r.error?.code === "rule_inactive")
    return { error: "This rule was already replaced or removed. Reload the page to see the current rules." };
  if (r.error?.code === "slug_taken")
    return { error: "Some fields need attention.", fieldErrors: { name: "A company with this name already exists." } };
  return { error: cap(r.error?.error ?? `Engine returned ${r.status}`), reasons };
}

export const COMMUNITIES = [
  "Dubai Marina",
  "Jumeirah Village Circle",
  "Downtown Dubai",
  "Business Bay",
  "Dubai Creek Harbour",
  "Jumeirah Lake Towers",
  "Dubai Hills Estate",
  "Arabian Ranches",
  "Al Barsha",
  "Palm Jumeirah",
];
