import { addYears, type CalendarDate, type ContractFields, diffDays } from "@leasing/core";
import { fixedValueKinds } from "../contract-structure/filled.ts";
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
  return checks;
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
const TOKENS = /\{\{b\d+\}\}/g;

/** Every number a text states, with where it is: digits ("1,250", "2nd"), words ("four", "twenty-five", "third"). */
function numbersIn(text: string): { value: number; end: number }[] {
  const t = text.replace(TOKENS, " ");
  const out: { value: number; end: number }[] = [];
  for (const m of t.matchAll(/\d[\d,]*(?:\.\d+)?(?:st|nd|rd|th)?/g))
    out.push({ value: Number(m[0].replace(/,|st|nd|rd|th/g, "")), end: m.index + m[0].length });
  for (const m of t.matchAll(NUMBER_WORDS)) {
    const value = m[1]
      ? WORD_VALUE.get(m[1].toLowerCase())! + WORD_VALUE.get(m[2]!.toLowerCase())!
      : WORD_VALUE.get(m[3]!.toLowerCase())!;
    out.push({ value, end: m.index + m[0].length });
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
const LEGAL_WORDS =
  /\b(?:rent|deposit|cheques?|payments?|pay|fees?|commission|aed|dirhams?|terminat\w*|notice|evict\w*|vacat\w*|renew\w*|law|legal|ejari|rera|penalt\w*|fines?|liab\w*|indemn\w*|breach|dispute|court|insur\w*|sub-?let\w*|assign\w*|shall|must|oblig\w*|responsib\w*|period|term|months?|years?|days?|no|not|never|without|except|unless|only|may|allowed|permitted|prohibit\w*|forbid\w*|pets?|tenant|landlord|lessee|lessor|use|used|maintain\w*|maintenance|repair\w*|damage\w*|smok\w*|visitors?|guests?|occup\w*|residential|commercial)\b|n't\b/i;
/** Words of a paragraph that describes the unit (its type, rooms, size and features). */
const UNIT_WORDS =
  /\b(?:bed(?:room)?s?|bath(?:room)?s?|villa|apartment|flat|studio|penthouse|townhouse|duplex|office|shop|retail|warehouse|garden|pool|balcony|terrace|maid'?s?|garage|parking|furnish(?:ed|ing)?|unfurnished|sq\.?\s*f(?:ee)?t|square\s+(?:feet|foot|metres?|meters?)|floor|view|kitchen|storey|description|premises\s+(?:consist|compris))/i;

/** D64: only a paragraph about the unit, with no legal, money, permission or negation words, may be reworded. */
export const describesUnit = (text: string): boolean => {
  const t = text.replace(TOKENS, " ");
  return UNIT_WORDS.test(t) && !LEGAL_WORDS.test(t);
};

const tokensOf = (s: string) => [...s.matchAll(TOKENS)].map((m) => m[0]).sort();

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
  if (!p.rewritable)
    return {
      before: p.text,
      problems: [`${r.key}: this paragraph can't be reworded (a heading, title or company clause)`],
    };
  if (!describesUnit(p.text))
    return { before: p.text, problems: [`${r.key}: only a paragraph that describes the unit may be reworded`] };
  const problems: string[] = [];
  const text = r.text.trim();
  const plain = text.replace(TOKENS, " ");
  if (!text) problems.push(`${r.key}: the new wording is empty`);
  if (tokensOf(text).join() !== tokensOf(p.text).join())
    problems.push(`${r.key}: keep every {{bN}} blank of the paragraph exactly once and add none`);
  const kinds = fixedValueKinds(text);
  if (kinds.length) problems.push(`${r.key}: the new wording contains ${kinds.join(", ")}`);
  if (LEGAL_WORDS.test(plain))
    problems.push(`${r.key}: the new wording adds legal, money, permission or negation words; describe the unit only`);
  const f = c.unitFacts;
  for (const n of numbersIn(text)) {
    const after = plain.slice(n.end, n.end + 30);
    const counted = COUNTED.find(([re]) => re.test(after))?.[1];
    if (!counted)
      problems.push(`${r.key}: ${n.value} does not say what it counts (bedrooms, bathrooms, parking, area, floor)`);
    else if (!f || f[counted] !== n.value)
      problems.push(`${r.key}: ${n.value} ${counted} is not what the unit's record says (${f?.[counted] ?? "none"})`);
  }
  const description = (f?.description ?? "").toLowerCase();
  const unlisted = [...new Set([...plain.matchAll(FEATURES)].map((m) => m[1]!.toLowerCase()))].filter(
    (w) => !description.includes(w.replace(/'?s$/, "").replace(/ies$/, "y")),
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
