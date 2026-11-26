import { addYears, type CalendarDate, type ContractFields, diffDays } from "@leasing/core";
import { fixedValueKinds } from "../contract-structure/filled.ts";
import {
  emirateWordingProblems,
  legalPeriodProblems,
  type KeyedProblem,
  sampleValueProblems,
} from "../contract-structure/legal-wording.ts";
import { formatCalendarDate, formatMoneyFils } from "@platform/readers/structure/format";
import { VALUE_PATTERNS } from "@platform/readers/structure/values";
import { unprintable } from "../contract-structure/render.ts";
import type { BlankFill, ContractAgentContext, TermCheck, ContractUnitFacts } from "./schema.ts";

const aed = (fils: number) => `AED ${(fils / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/**
 * The contract's terms checked against the company's contract config, in code. The agent may read these but its
 * own view of them is never used: the Manager recomputes them after the loop.
 */
export function checkContractTerms(
  c: ContractAgentContext,
  fields: ContractFields,
  blanks: BlankFill | null,
): TermCheck[] {
  const { lease } = c.contract;
  // A term of a year or more (start + 1 year - 1 day, or longer) is annual; anything shorter is short term.
  const annual = diffDays(lease.endOn as CalendarDate, addYears(lease.startOn as CalendarDate, 1)) <= 1;
  const tenure = annual ? "annual" : "short_term";
  const checks: TermCheck[] = [];
  checks.push(
    !c.rule
      ? { id: "tenure", ok: true, reason: "Tenure: no contract rule, company defaults apply" }
      : c.rule.tenures.includes(tenure)
        ? { id: "tenure", ok: true, reason: `Tenure: ${tenure.replace("_", " ")} allowed by the rule` }
        : {
            id: "tenure",
            ok: false,
            reason: `Tenure: ${tenure.replace("_", " ")} is not allowed by the contract rule`,
          },
  );
  checks.push(
    !c.rule
      ? { id: "cheques", ok: true, reason: "Cheques: no contract rule, company defaults apply" }
      : lease.cheques >= c.rule.minCheques && lease.cheques <= c.rule.maxCheques
        ? {
            id: "cheques",
            ok: true,
            reason: `Cheques: ${lease.cheques} within ${c.rule.minCheques}–${c.rule.maxCheques}`,
          }
        : {
            id: "cheques",
            ok: false,
            reason: `Cheques: ${lease.cheques} is outside the rule's ${c.rule.minCheques}–${c.rule.maxCheques}`,
          },
  );
  checks.push(
    !c.rentBand
      ? { id: "rent_band", ok: true, reason: "Rent: no rent rule band for this unit" }
      : lease.annualRentFils >= c.rentBand.minFils && lease.annualRentFils <= c.rentBand.maxFils
        ? {
            id: "rent_band",
            ok: true,
            reason: `Rent: ${aed(lease.annualRentFils)} within ${aed(c.rentBand.minFils)}–${aed(c.rentBand.maxFils)}`,
          }
        : {
            id: "rent_band",
            ok: false,
            reason: `Rent: ${aed(lease.annualRentFils)} is outside the allowed ${aed(c.rentBand.minFils)}–${aed(c.rentBand.maxFils)}`,
          },
  );
  checks.push(
    lease.depositFils <= c.depositMaxFils
      ? {
          id: "deposit",
          ok: true,
          reason: `Deposit: ${aed(lease.depositFils)} within the ${aed(c.depositMaxFils)} limit`,
        }
      : {
          id: "deposit",
          ok: false,
          reason: `Deposit: ${aed(lease.depositFils)} is above the ${aed(c.depositMaxFils)} limit`,
        },
  );
  checks.push(
    c.landlordGaps.length
      ? { id: "landlord", ok: false, reason: `Landlord details missing: ${c.landlordGaps.join(", ")}` }
      : { id: "landlord", ok: true, reason: "Landlord: legal details and signatory complete" },
  );
  checks.push(
    fields.dldPropertyNo && fields.tenantNameEn && fields.landlordNameEn
      ? { id: "required_terms", ok: true, reason: "Required terms: present" }
      : { id: "required_terms", ok: false, reason: "Required terms: property number or party names missing" },
  );
  checks.push(
    !blanks
      ? { id: "blanks", ok: true, reason: "Blanks: standard contract, no template blanks" }
      : blanks.missingCore.length
        ? { id: "blanks", ok: false, reason: `Blanks with no value: ${blanks.missingCore.join(", ")}` }
        : {
            id: "blanks",
            ok: true,
            reason: blanks.leftEmpty.length
              ? `Blanks: all legal and money blanks filled; left empty for hand-filling: ${blanks.leftEmpty.join(", ")}`
              : "Blanks: every template blank filled from the records",
          },
  );
  checks.push(...legalWordingChecks(c, fields));
  return checks;
}

const SHORT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** A record value in every way the contract prints it: dates as ISO, "12 November 2026", "12 Nov 2026"; money as "AED 50,000". */
function printedForms(v: string): string[] {
  const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  if (d) {
    const long = formatCalendarDate(v);
    const mon = SHORT_MONTHS[Number(d[2]) - 1];
    return [v, ...(long ? [long] : []), ...(mon ? [`${Number(d[3])} ${mon} ${d[1]}`, `${d[3]}/${d[2]}/${d[1]}`] : [])];
  }
  const m = /^\d{3,}$/.test(v) ? Number(v) : NaN;
  return Number.isSafeInteger(m) ? [v, formatMoneyFils(m * 100), `AED ${m.toLocaleString("en-US")}`] : [v];
}

const listed = (ps: KeyedProblem[]) =>
  [...new Set(ps.map((p) => p.problem))].slice(0, 3).join(" ") + (ps.length > 3 ? ` (and ${ps.length - 3} more)` : "");

/**
 * D70: the template's printed fixed wording against this lease's own records, rulebook version and emirate. Without a
 * template (standard contract) there is no fixed wording to check.
 */
function legalWordingChecks(c: ContractAgentContext, fields: ContractFields): TermCheck[] {
  const ids = ["sample_values", "legal_periods", "emirate_wording"] as const;
  if (!c.template || !c.legal)
    return ids.map((id) => ({ id, ok: true, reason: "Fixed wording: standard contract, no template wording" }));
  const texts = [
    ...c.legal.headings.map((text, i) => ({ key: `heading ${i + 1}`, text })),
    ...c.template.paragraphs.filter((p) => !p.heading).map((p) => ({ key: p.key, text: p.text })),
  ];
  const own = [
    ...c.legal.ownValues,
    ...Object.values(fields).flatMap((v) => (typeof v === "string" && v.length > 0 ? printedForms(v) : [])),
  ];
  const run = (id: (typeof ids)[number], label: string, ps: KeyedProblem[]): TermCheck =>
    ps.length
      ? { id, ok: false, reason: `${label}: ${listed(ps)}` }
      : { id, ok: true, reason: `${label}: nothing wrong found in the template's fixed wording` };
  return [
    run("sample_values", "Sample values", sampleValueProblems(texts, own)),
    run("legal_periods", "Legal periods", legalPeriodProblems(texts, c.legal.rules)),
    run("emirate_wording", "Emirate wording", emirateWordingProblems(texts, c.legal.emirate)),
  ];
}

const UNITS = [
  "zero",
  "one",
  "two",
  "three",
  "four",
  "five",
  "six",
  "seven",
  "eight",
  "nine",
  "ten",
  "eleven",
  "twelve",
  "thirteen",
  "fourteen",
  "fifteen",
  "sixteen",
  "seventeen",
  "eighteen",
  "nineteen",
];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const ORDINALS = [
  "ground",
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
  "thirteenth",
  "fourteenth",
  "fifteenth",
  "sixteenth",
  "seventeenth",
  "eighteenth",
  "nineteenth",
  "twentieth",
];
const WORD_VALUE = new Map<string, number>([
  ...UNITS.map((w, i) => [w, i] as [string, number]),
  ...TENS.flatMap((w, i) => (w ? [[w, i * 10] as [string, number]] : [])),
  ...ORDINALS.map((w, i) => [w, i] as [string, number]),
  ["single", 1],
  ["double", 2],
  ["twin", 2],
  ["triple", 3],
  ["once", 1],
  ["twice", 2],
  ["pair", 2],
  ["couple", 2],
  ["dozen", 12],
  ["half", 0.5],
  ["hundred", 100],
  ["thousand", 1000],
]);
const NUMBER_WORDS = new RegExp(
  `\\b(?:(${TENS.filter(Boolean).join("|")})[-\\s](${UNITS.slice(1, 10).join("|")})|(${[...WORD_VALUE.keys()].join("|")}))\\b`,
  "gi",
);
export const TOKENS = /\{\{b\d+\}\}/g;

/** Every number a text states, with where it is: digits ("1,250", "2nd"), words ("four", "twenty-five", "third"). */
function numbersIn(text: string): { value: number; start: number; end: number }[] {
  const t = text.replace(TOKENS, " ");
  const out: { value: number; start: number; end: number }[] = [];
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th)?/g))
    out.push({ value: Number(m[0].replace(/,|st|nd|rd|th/g, "")), start: m.index, end: m.index + m[0].length });
  for (const m of t.matchAll(NUMBER_WORDS)) {
    const value = m[1]
      ? WORD_VALUE.get(m[1].toLowerCase())! + WORD_VALUE.get(m[2]!.toLowerCase())!
      : WORD_VALUE.get(m[3]!.toLowerCase())!;
    out.push({ value, start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** Every number a text states, in digits or words. */
export const statedNumbers = (text: string): number[] => numbersIn(text).map((n) => n.value);

type FactKey = "bedrooms" | "bathrooms" | "parkingSpaces" | "areaSqft" | "floor";
/** What a number counts, from the words right after it ("two-car garage" counts parking, "3rd floor" the floor). */
const COUNTED: [RegExp, FactKey][] = [
  [/^[\s-]*(?:bed(?:room)?s?|br)\b/i, "bedrooms"],
  [/^[\s-]*bath(?:room)?s?\b/i, "bathrooms"],
  [/^[\s-]*(?:(?:covered\s+|car\s+)?(?:car|parking|space|bay|garage)s?)\b/i, "parkingSpaces"],
  [/^[\s-]*(?:sq\.?\s*f(?:ee)?t|square\s+f(?:ee|oo)t|sqft)\b/i, "areaSqft"],
  [/^[\s-]*(?:floor|storey|level)\b/i, "floor"],
];

const COUNT_LABEL: Record<FactKey, string> = {
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  parkingSpaces: "parking spaces",
  areaSqft: "sq ft",
  floor: "floor",
};

/** Kept for callers that list the unit's numbers. */
export function factNumbers(f: ContractUnitFacts): Set<number> {
  return new Set(
    [f.bedrooms, f.bathrooms, f.areaSqft, f.parkingSpaces, f.floor].filter((x): x is number => x !== null),
  );
}

/** Features a description may name; a rewording may name one only when the unit's own description does. */
const FEATURES =
  /\b(pool|garden|balcon(?:y|ies)|terrace|maid'?s?|garage|view|gym|study|laundry|storage|roof|jacuzzi|bbq|barbecue|playroom|driver'?s?|courtyard|yard|lawn|annex|sauna|elevator|lift|concierge|beach|sea|marina|park|lake|golf|canal)\b/gi;
/** Words of legal or money terms: a paragraph with any of them is never reworded, and a rewording never adds one. */
export const LEGAL_WORDS =
  /\b(?:rent|deposit|cheques?|payments?|pay|fees?|commission|aed|dirhams?|terminat\w*|notice|evict\w*|vacat\w*|renew\w*|law|legal|ejari|rera|penalt\w*|fines?|liab\w*|indemn\w*|breach|dispute|court|insur\w*|sub-?let\w*|assign\w*|shall|must|oblig\w*|responsib\w*|period|term|months?|years?|days?|no|not|never|without|except|unless|only|may|allowed|permitted|prohibit\w*|forbid\w*|pets?|tenant|landlord|lessee|lessor|use|used|maintain\w*|maintenance|repair\w*|damage\w*|smok\w*|visitors?|guests?|occup\w*|residential|commercial)\b|n't\b/i;
/** Words of a paragraph that describes the unit (its type, rooms, size and features). */
const UNIT_WORDS =
  /\b(?:bed(?:room)?s?|bath(?:room)?s?|villa|apartment|flat|studio|penthouse|townhouse|duplex|office|shop|retail|warehouse|garden|pool|balcony|terrace|maid'?s?|garage|parking|furnish(?:ed|ing)?|unfurnished|sq\.?\s*f(?:ee)?t|square\s+(?:feet|foot|metres?|meters?)|floor|view|kitchen|storey|description|premises\s+(?:consist|compris))/i;

/** D64: only a paragraph about the unit, with no legal, money, permission or negation words, may be reworded. */
export const describesUnit = (text: string): boolean => {
  const t = text.replace(TOKENS, " ");
  return UNIT_WORDS.test(t) && !LEGAL_WORDS.test(t);
};

export const tokensOf = (s: string) => [...s.matchAll(TOKENS)].map((m) => m[0]).sort();

/**
 * D64: a reworded template paragraph is used only when code finds nothing wrong with it. The original must be a body
 * paragraph about the unit the Manager marked rewritable; the new wording keeps exactly the same blanks, states no
 * amount, date, ID, phone or email, adds no legal, permission or negation word, names a feature only when the unit's
 * description does, and every number counts something (bedrooms, bathrooms, parking, area, floor) and equals the
 * unit record's value for it. Returns the problems (empty: accepted).
 */
export function checkRewrite(
  c: ContractAgentContext,
  r: { key: string; text: string },
): { before: string | null; problems: string[] } {
  const p = c.template?.paragraphs.find((x) => x.key === r.key);
  if (!p) return { before: null, problems: [`${r.key}: there is no template paragraph with this key`] };
  // D78: a particulars line (type, rooms, use; no obligation) may be reworded too, under the use checks below.
  const particulars = (p.particulars === true || p.heading === true) && !p.rewritable;
  if (!p.rewritable && !particulars)
    return {
      before: p.text,
      problems: [`${r.key}: this paragraph can't be reworded (a heading, title or company clause)`],
    };
  if (p.heading ? !headingWithUse(p.text) : particulars ? !unitParticulars(p.text) : !describesUnit(p.text))
    return { before: p.text, problems: [`${r.key}: only a paragraph that describes the unit may be reworded`] };
  const problems: string[] = [];
  const text = normalizeRewrite(c, r.text);
  const plain = text.replace(TOKENS, " ");
  if (!text) problems.push(`${r.key}: the new wording is empty`);
  if (tokensOf(text).join() !== tokensOf(p.text).join())
    problems.push(`${r.key}: keep every {{bN}} blank of the paragraph exactly once and add none`);
  // A value (date, ID, phone, email, number) is allowed only when the very same value is in the original wording.
  const kinds = particulars ? newValueKinds(p.text, text) : fixedValueKinds(text);
  if (kinds.length) problems.push(`${r.key}: the new wording contains ${kinds.join(", ")}`);
  if (particulars) {
    // D78: a particulars line changes only its type, use and counted words; every other word stays as it was.
    problems.push(...particularsDiffProblems(r.key, dropLeftoverType(c, p.text), text));
    // A title or heading changes its use word only (no type word or number swaps).
    if (p.heading && p.text.replace(USE_ANY_G, "_") !== text.replace(USE_ANY_G, "_"))
      problems.push(`${r.key}: a title or heading may change only its use word`);
    problems.push(...useProblems(c, r.key, p.text, text));
  } else if (LEGAL_WORDS.test(plain))
    problems.push(`${r.key}: the new wording adds legal, money, permission or negation words; describe the unit only`);
  problems.push(...typeProblems(c, r.key, text));
  // D78: the rewording must fix what disagreed (a no-op or partial rewording is not a fix).
  const left = paragraphDisagreements(c, { ...p, text });
  if (left.length)
    problems.push(
      `${r.key}: still disagrees with the unit record: ${left.map((d) => `"${d.said}" (record: ${d.record})`).join(", ")}`,
    );
  const f = c.unitFacts;
  // A particulars line may keep the numbers it had (the word-by-word check holds them in place): only new ones count.
  const kept = particulars ? numbersIn(p.text).map((n) => n.value) : [];
  for (const n of numbersIn(text)) {
    const at = kept.indexOf(n.value);
    if (at >= 0) {
      kept.splice(at, 1);
      continue;
    }
    const after = plain.slice(n.end, n.end + 30);
    const counted = COUNTED.find(([re]) => re.test(after))?.[1];
    if (!counted)
      problems.push(`${r.key}: ${n.value} does not say what it counts (bedrooms, bathrooms, parking, area, floor)`);
    else if (!f || f[counted] !== n.value)
      problems.push(`${r.key}: ${n.value} ${counted} is not what the unit's record says (${f?.[counted] ?? "none"})`);
  }
  const description = (f?.description ?? "").toLowerCase();
  // A label the particulars line already had ("Balcony", "Parking") is not a new feature.
  const had = particulars ? p.text.toLowerCase() : "";
  const unlisted = [...new Set([...plain.matchAll(FEATURES)].map((m) => m[1]!.toLowerCase()))].filter(
    (w) => !description.includes(w.replace(/'?s$/, "").replace(/ies$/, "y")) && !had.includes(w),
  );
  if (unlisted.length) problems.push(`${r.key}: ${unlisted.join(", ")} is not in the unit's description`);
  if (text.length > Math.max(p.text.length * 1.5, p.text.length + 80))
    problems.push(`${r.key}: the new wording is too long`);
  if (unprintable(text)) problems.push(`${r.key}: the new wording has characters the contract PDF can't print`);
  return { before: p.text, problems };
}

/** The model's reason for a rewording, shown to the approver only when it holds no value code can't vouch for. */
export const safeReason = (reason: string): string =>
  fixedValueKinds(reason).length ? "Matches the unit's record" : reason;

/** Words a particulars line may hold that `LEGAL_WORDS` lists: the use it prints ("Permitted Use Residential use only"). */
const USE_LINE_WORDS = new Set(["use", "used", "only", "permitted", "residential", "commercial"]);
/** Extra money words a particulars line never holds. */
const MONEY_WORDS = /\b(?:price|amount|charges?|costs?|total|security|annual|monthly|utilit(?:y|ies))\b/i;

/**
 * A template paragraph that lists the unit's particulars (type, rooms, size, use) and holds no other legal, money,
 * permission or negation word (`LEGAL_WORDS` less the use words). "No." as in "Unit No." is a label, not a negation.
 * Code may copy the unit's type and use into it from the record (`codeUnitRewrite`).
 */
export const unitParticulars = (text: string): boolean =>
  UNIT_WORDS.test(text.replace(TOKENS, " ")) && !beyondUseLine(text);

/** A legal, money, permission or negation word other than the use words of a particulars line. */
function beyondUseLine(text: string): boolean {
  const t = text.replace(TOKENS, " ").replace(/\bNo\.(?=\s)/g, " ");
  if (MONEY_WORDS.test(t)) return true;
  const legal = new RegExp(LEGAL_WORDS.source, "gi");
  return [...t.matchAll(legal)].some((m) => !USE_LINE_WORDS.has(m[0].toLowerCase()));
}

/** Unit type words a template may print, and what each means. */
const TYPES = [
  "apartment",
  "flat",
  "villa",
  "townhouse",
  "penthouse",
  "duplex",
  "studio",
  "office",
  "shop",
  "warehouse",
];
const TYPE_WORD = new RegExp(`\\b(?:${TYPES.join("|")})\\b`, "gi");
const TYPE_OF: Record<string, string> = { flat: "apartment" };
/** "Residential use", "commercial purposes": the use the template prints. */
const USE_WORD = /\b(residential|commercial)(?=\s+(?:use|purposes?)\b)/gi;
const USE_PHRASE = /\b(?:residential|commercial)\s+(?:use|purposes?)\b/gi;
/** Two types or two uses side by side ("studio apartment", "residential or commercial use"): code leaves it alone. */
const JOINED_TYPES = new RegExp(
  `\\b(?:${TYPES.join("|")})(?:\\s+(?:or|and|/)\\s+|[\\s/-]+)(?:${TYPES.join("|")})\\b`,
  "i",
);
const JOINED_USES = /\b(?:residential|commercial)\s*(?:or|and|\/|,)\s*(?:residential|commercial)\b/i;
/** A negated use ("non-residential", "no commercial use", "not for residential"): code leaves it alone. */
const NEGATED_USE = /\b(?:non|not|no)\b[\s-]+(?:for\s+)?(?:residential|commercial)\b/i;

const sameCase = (model: string, word: string) =>
  model === model.toUpperCase()
    ? word.toUpperCase()
    : /^[A-Z]/.test(model)
      ? word[0]!.toUpperCase() + word.slice(1)
      : word;

/**
 * The unit's particulars paragraph with its type and use words copied from the unit's record (no model): "Apartment"
 * becomes "Shop" when the record says shop, "Residential use" becomes "Commercial use" when the unit is commercial,
 * with "a"/"an" kept right. Nothing else changes; blanks stay. Null when nothing disagrees, the subtype or use is not
 * known, or the wording is one code must not touch (joined types or uses, a negated use).
 */
export function codeUnitRewrite(
  c: ContractAgentContext,
  text: string,
  usage: "residential" | "commercial" | null,
  heading = false,
): string | null {
  const subtype = c.unitFacts?.subtype?.trim().toLowerCase() ?? "";
  const want = TYPE_OF[subtype] ?? subtype;
  const original = text;
  // D79: a title or heading changes only its use word.
  if (heading) {
    if (!usage || !headingWithUse(text)) return null;
    const out = text.replace(USE_ANY_G, (m) => (m.toLowerCase() === usage ? m : sameCase(m, usage)));
    return out === text ? null : out;
  }
  text = dropLeftoverType(c, text);
  const plain = text.replace(TOKENS, " ");
  let out = text;
  if (TYPES.includes(subtype) && !JOINED_TYPES.test(plain)) {
    out = out.replace(TYPE_WORD, (m) =>
      (TYPE_OF[m.toLowerCase()] ?? m.toLowerCase()) === want ? m : sameCase(m, subtype),
    );
    // "a apartment" → "an apartment", "an shop" → "a shop" (only when a type word changed).
    if (out !== text)
      out = out.replace(
        new RegExp(`\\b(a|an)(\\s+)(${TYPES.join("|")})\\b`, "gi"),
        (m, art: string, sp: string, w: string) => {
          const an = /^[aeiou]/i.test(w);
          const fixed = an ? (art[0] === "A" ? "An" : "an") : art[0] === "A" ? "A" : "a";
          return `${fixed}${sp}${w}`;
        },
      );
  }
  if (usage && !JOINED_USES.test(plain) && !NEGATED_USE.test(plain))
    out = out.replace(USE_WORD, (m) => (m.toLowerCase() === usage ? m : sameCase(m, usage)));
  if (out === original || tokensOf(out).join() !== tokensOf(original).join()) return null;
  return out;
}

/** The words `codeUnitRewrite` changed (lower case), to tell which conflict flags it resolved. */
export function changedWords(before: string, after: string): string[] {
  const a = before.split(/(\s+)/);
  const b = after.split(/(\s+)/);
  if (a.length !== b.length) return [];
  return a.flatMap((w, i) => (w !== b[i] ? [w.replace(/[^\p{L}-]/gu, "").toLowerCase()] : [])).filter(Boolean);
}

/** The unit's use from the contract records ("commercial" covers retail, as for Ejari). */
export const unitUsage = (c: ContractAgentContext): "residential" | "commercial" => c.contract.unit.kind;

/** D78: a reworded particulars line states the record's use, never another or a negated one, and never drops it. */
function useProblems(c: ContractAgentContext, key: string, before: string, after: string): string[] {
  const usage = unitUsage(c);
  const out: string[] = [];
  const t = after.replace(TOKENS, " ");
  if (/\bnon[\s-]/i.test(t)) out.push(`${key}: the new wording negates the use; state the unit's use only`);
  const said = [...t.matchAll(/\b(residential|commercial)\b/gi)].map((m) => m[1]!.toLowerCase());
  const wrong = [...new Set(said.filter((u) => u !== usage))];
  if (wrong.length) out.push(`${key}: the unit's use is ${usage} in its record, not ${wrong.join(", ")}`);
  if (/\b(?:residential|commercial)\b/i.test(before.replace(TOKENS, " ")) && !said.includes(usage))
    out.push(`${key}: keep the use, stated as in the record (${usage} use)`);
  return out;
}

/** D78: a type word in reworded wording must be the unit's type (flat = apartment). */
function typeProblems(c: ContractAgentContext, key: string, after: string): string[] {
  const subtype = c.unitFacts?.subtype?.trim().toLowerCase() ?? "";
  if (!TYPES.includes(subtype)) return [];
  const want = TYPE_OF[subtype] ?? subtype;
  const wrong = [
    ...new Set(
      [...after.replace(TOKENS, " ").matchAll(TYPE_WORD)]
        .map((m) => m[0].toLowerCase())
        .filter((w) => (TYPE_OF[w] ?? w) !== want),
    ),
  ];
  return wrong.length ? [`${key}: the unit is a ${subtype} in its record, not ${wrong.join(", ")}`] : [];
}

/** A template line that disagrees with the unit's record, found by code (D78). */
export interface UnitDisagreement {
  key: string;
  what: "type" | "use" | "count" | "feature";
  /** The template's words. */
  said: string;
  /** What the record says. */
  record: string;
}

/**
 * D78: every place a rewordable template paragraph (rewritable or particulars) disagrees with the unit's record: a
 * type word that isn't the unit's type, a use that isn't the unit's use, a count (bedrooms, bathrooms, parking, area,
 * floor) that isn't the record's. Joined and negated wording is left out (code can't tell what it means). This is the
 * checklist the model is given and scored on.
 */
export function unitDisagreements(c: ContractAgentContext): UnitDisagreement[] {
  return (c.template?.paragraphs ?? []).flatMap((p) => paragraphDisagreements(c, p));
}

/** The disagreements of one rewordable paragraph (its text as given: the template's, or a rewording of it). */
export function paragraphDisagreements(
  c: ContractAgentContext,
  p: {
    key: string;
    text: string;
    rewritable?: boolean | undefined;
    particulars?: boolean | undefined;
    heading?: boolean | undefined;
  },
): UnitDisagreement[] {
  if (!p.rewritable && !p.particulars && !p.heading) return [];
  const out: UnitDisagreement[] = [];
  const subtype = c.unitFacts?.subtype?.trim().toLowerCase() ?? "";
  const want = TYPE_OF[subtype] ?? subtype;
  const usage = unitUsage(c);
  if (p.heading) {
    const t = p.text.replace(TOKENS, " ");
    if (JOINED_USES.test(t) || NEGATED_USE.test(t)) return [];
    for (const w of new Set([...t.matchAll(USE_ANY_G)].map((m) => m[0])))
      if (w.toLowerCase() !== usage) out.push({ key: p.key, what: "use", said: w, record: usage });
    return out;
  }
  // A type word the sample left after the type blank: the blank already prints the type, so the word goes.
  for (const w of leftoverTypes(c, p.text))
    out.push({ key: p.key, what: "type", said: w, record: "printed by the blank before it: leave the word out" });
  const plain = dropLeftoverType(c, p.text).replace(TOKENS, " ");
  if (TYPES.includes(subtype) && !JOINED_TYPES.test(plain))
    for (const w of new Set([...plain.matchAll(TYPE_WORD)].map((m) => m[0])))
      if ((TYPE_OF[w.toLowerCase()] ?? w.toLowerCase()) !== want)
        out.push({ key: p.key, what: "type", said: w, record: subtype });
  if (!JOINED_USES.test(plain) && !NEGATED_USE.test(plain))
    for (const m of new Set([...plain.matchAll(USE_PHRASE)].map((x) => x[0])))
      if (m.split(/\s+/)[0]!.toLowerCase() !== usage)
        out.push({ key: p.key, what: "use", said: m, record: `${usage} use` });
  const f = c.unitFacts;
  // A feature a description names that the unit's own description doesn't (labels of a particulars line aside).
  if (p.rewritable && !p.particulars) {
    const description = (f?.description ?? "").toLowerCase();
    for (const w of new Set([...plain.matchAll(FEATURES)].map((m) => m[1]!)))
      if (!description.includes(w.toLowerCase().replace(/'?s$/, "").replace(/ies$/, "y")))
        out.push({ key: p.key, what: "feature", said: w, record: "not in the unit's description" });
  }
  if (f)
    for (const n of numbersIn(p.text)) {
      const after = plain.slice(n.end, n.end + 30);
      const hit = COUNTED.find(([re]) => re.test(after));
      const counted = hit?.[1];
      if (hit && counted && f[counted] !== null && f[counted] !== n.value) {
        // The template's own words ("Four-bedroom", "two-car garage"), so the approver can find them.
        const said = plain.slice(n.start, n.end + after.match(hit[0])![0].length).trim();
        out.push({ key: p.key, what: "count", said, record: `${f[counted]} ${COUNT_LABEL[counted]}` });
      }
    }
  return out;
}

/** Value kinds in `after` that bring a value the original doesn't hold verbatim (D78: never swap one for another). */
function newValueKinds(before: string, after: string): string[] {
  const strip = (t: string) => t.replace(TOKENS, " ");
  const out: string[] = [];
  for (const { kind, re } of VALUE_PATTERNS) {
    const all = new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
    const had = new Set([...strip(before).matchAll(all)].map((m) => m[0]));
    if ([...strip(after).matchAll(all)].some((m) => !had.has(m[0]))) out.push(kind);
  }
  return out;
}

const ARTICLES = new Set(["a", "an"]);
const isNumberWord = (w: string) => /^\d[\d,]*(?:\.\d+)?$/.test(w) || statedNumbers(w).length > 0;

/**
 * D78: a reworded particulars line keeps every word of the original in place; a word may change only to another of
 * the same class: a type word, a use word (residential, commercial), a number (a count, checked against the record),
 * or the article "a"/"an". Punctuation around a word stays. "only" and every label therefore survive.
 */
function particularsDiffProblems(key: string, before: string, after: string): string[] {
  const words = (t: string) => t.trim().split(/\s+/);
  const a = words(before);
  const b = words(after);
  if (a.length !== b.length)
    return [`${key}: keep the line's words as they are and change only the type, use or count that disagrees`];
  const core = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  const edge = (w: string) => w.replace(core(w), "\u0000");
  const bad: string[] = [];
  a.forEach((w, i) => {
    const v = b[i]!;
    if (w === v) return;
    const x = core(w).toLowerCase();
    const y = core(v).toLowerCase();
    // The same word with another case or trailing full stop/comma ("only" -> "only.") is not a change.
    const tail = (t: string) => t.replace(/[.,;:]+$/, "");
    if (x === y && tail(edge(w)) === tail(edge(v))) return;
    const sameClass =
      edge(w) === edge(v) &&
      ((TYPES.includes(x) && TYPES.includes(y)) ||
        (["residential", "commercial"].includes(x) && ["residential", "commercial"].includes(y)) ||
        (isNumberWord(x) && isNumberWord(y)) ||
        (ARTICLES.has(x) && ARTICLES.has(y)));
    if (!sameClass) bad.push(`"${w}" -> "${v}"`);
  });
  return bad.length
    ? [`${key}: only the type, use or count may change in this line, not ${bad.slice(0, 3).join(", ")}`]
    : [];
}

/** "RESIDENTIAL LEASE CONTRACT": a title or heading stating a use, with no other legal, money or negation word (D79). */
export const headingWithUse = (text: string): boolean => {
  const t = text.replace(TOKENS, " ");
  return USE_ANY.test(t) && !JOINED_USES.test(t) && !NEGATED_USE.test(t) && !beyondUseLine(text);
};
const USE_ANY = /\b(?:residential|commercial)\b/i;
const USE_ANY_G = /\b(?:residential|commercial)\b/gi;

/**
 * D79: a type word right after a blank that prints the unit's type is a value the sample left behind ("Property Type
 * {{b30}} Apartment"): the line reads correctly only without it. Returns the text with such words removed.
 */
export function dropLeftoverType(c: ContractAgentContext, text: string): string {
  const re = leftoverRe(c);
  return re ? text.replace(re, "$1") : text;
}

/**
 * A type word right after a type blank, standing alone: followed by punctuation, another blank or the end ("{{b30}}
 * Apartment (" yes; "{{b30}} Apartment Building" or "{{b30}} flat fee" no). None when the record has no type, since
 * the blank would then print nothing.
 */
function leftoverRe(c: ContractAgentContext): RegExp | null {
  const blanks = c.template?.typeBlanks ?? [];
  if (!blanks.length || !c.unitFacts?.subtype?.trim()) return null;
  const tokens = blanks.map((b) => b.replace(/[{}]/g, "\\$&")).join("|");
  return new RegExp(`(${tokens})\\s+(${TYPES.join("|")})\\b(?=\\s*(?:[(),.;:/]|\\{\\{|$))`, "gi");
}

/** The leftover type words `dropLeftoverType` would remove, as written in the template. */
function leftoverTypes(c: ContractAgentContext, text: string): string[] {
  const re = leftoverRe(c);
  return re ? [...text.matchAll(re)].map((m) => m[2]!) : [];
}

/**
 * D79: the rewording as it will print: trimmed, with any type word right after a type blank removed (the blank prints
 * the type; a word there is the sample's value, which never prints, D70). Checks and storage both use this text.
 */
export const normalizeRewrite = (c: ContractAgentContext, text: string): string => dropLeftoverType(c, text.trim());
