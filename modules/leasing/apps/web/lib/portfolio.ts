import { EMIRATES, type Emirate, SUBTYPES_BY_CATEGORY } from "@leasing/core";
import type { EngineResult } from "./engine";
import type { CompanyRow } from "./types";
import { splitReasons } from "@platform/ui/field-errors";

export type Category = "residential" | "commercial" | "retail";

export const CATEGORIES: { value: Category; label: string }[] = [
  { value: "residential", label: "Residential" },
  { value: "commercial", label: "Commercial" },
  { value: "retail", label: "Retail" },
];

export const categoryOf = (raw: string | undefined): Category =>
  CATEGORIES.find((c) => c.value === raw)?.value ?? "residential";

/** The requested category when the company offers it, else the company's first offered one. */
export const categoryFor = (raw: string | undefined, company: CompanyRow | null | undefined): Category => {
  const offered = offeredCategories(company);
  const wanted = categoryOf(raw);
  return offered.includes(wanted) ? wanted : offered[0]!;
};

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
/** D68: the types a rule covers ("Villa, Apartment"), or "All types" for an empty list. */
export const subtypesLabel = (list: readonly string[] | null | undefined) =>
  list?.length ? list.map((s) => subtypeLabel(s)).join(", ") : "All types";
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

/** Whole dirhams to fils; text that isn't whole dirhams is returned as typed, for the engine's Zod check to refuse. */
export function aedFilsOrRaw(raw: string): number | string {
  const fils = parseWholeAedFils(raw);
  return fils === null ? "" : Number.isNaN(fils) ? raw : fils;
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
  /** D73: contract rules the approval created. */
  rulesCreated?: { category: string; emirate: string }[];
  rulesSkipped?: { category: string; emirate: string; reason: string }[];
}

const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Engine error into a form result: Zod "field: message" reasons (also nested, "legal.email: …") become field errors. */
export function ruleError(r: EngineResult<unknown>): RuleResult {
  const { fieldErrors, reasons } = splitReasons(r.error?.reasons ?? []);
  if (r.status === 400 || Object.keys(fieldErrors).length)
    return { error: "Some fields need attention.", reasons, fieldErrors };
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

/** Union of the emirates active companies operate in, in the usual order. All emirates when there is no company yet. */
export function operatedEmirates(companies: CompanyRow[] | null | undefined): Emirate[] {
  const set = new Set((companies ?? []).filter((c) => c.active).flatMap((c) => c.emirates));
  return set.size ? EMIRATES.filter((e) => set.has(e)) : [...EMIRATES];
}

const CATEGORY_ORDER: Category[] = ["residential", "commercial", "retail"];

/** Property types the company offers, in the usual order. All three when the company is unknown. */
export function offeredCategories(company: CompanyRow | null | undefined): Category[] {
  return company?.categories.length
    ? CATEGORY_ORDER.filter((c) => company.categories.includes(c))
    : [...CATEGORY_ORDER];
}

/** Union of the property types active companies offer. All three when there is no company yet. */
export function unionCategories(companies: CompanyRow[] | null | undefined): Category[] {
  const set = new Set((companies ?? []).filter((c) => c.active).flatMap((c) => c.categories));
  return set.size ? CATEGORY_ORDER.filter((c) => set.has(c)) : [...CATEGORY_ORDER];
}
