import { EMIRATE_LABELS, type Emirate } from "@leasing/core";
import { REFERENCE_CODE_RE, VALUE_PATTERNS } from "./filled.ts";

/**
 * D70: a template's fixed wording is checked by code against the lease's own rulebook, emirate and records. A legal
 * period printed as written that disagrees with the rulebook, wording that cites another emirate's law, or a value
 * left over from the sample contract is a problem; nothing here asks a model.
 */

export interface LegalRules {
  renewalNoticeDays: number;
  repossessionNoticeMonths: number;
  lateRentDaysAfterFormalReminder: number;
}
export interface KeyedText {
  key: string;
  text: string;
}
export interface KeyedProblem {
  key: string;
  problem: string;
}

const TOKENS = /\{\{b\d+\}\}/g;
const UNITS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen";
const TENS = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety";
const WORDS: Record<string, number> = Object.fromEntries([
  ...UNITS.split("|").map((w, i) => [w, i + 1] as const),
  ...TENS.split("|").map((w, i) => [w, (i + 2) * 10] as const),
]);
const NUM = `(?:\\d+|(?:${TENS})(?:[-\\s](?:${UNITS}))?|${UNITS}|${TENS})`;
const PERIOD = new RegExp(
  `\\b(${NUM})(?:\\s*\\((\\d+)\\))?[\\s-]*(?:(?:calendar|clear|working|business|full)\\s+)?(days?|months?)\\b`,
  "gi",
);

function numberOf(s: string): number {
  if (/^\d+$/.test(s)) return Number(s);
  return s
    .toLowerCase()
    .split(/[-\s]+/)
    .reduce((sum, w) => sum + (WORDS[w] ?? 0), 0);
}

/** Every "N days" / "N months" a sentence states (digits, words, or "ninety (90) days"). */
function periodsIn(sentence: string): { value: number; unit: "day" | "month" }[] {
  const out: { value: number; unit: "day" | "month" }[] = [];
  for (const m of sentence.matchAll(PERIOD))
    out.push({
      value: m[2] ? Number(m[2]) : numberOf(m[1]!),
      unit: m[3]!.toLowerCase().startsWith("day") ? "day" : "month",
    });
  return out;
}

const sentencesOf = (text: string): string[] =>
  text
    .replace(TOKENS, " ")
    .split(/(?<=[.;!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

const NOTICE = /\bnotice\b|\breminder\b|\bnotif(?:y|ied|ication)\b/i;
const REPOSSESSION =
  /\b(?:repossess\w*|evict\w*|vacat\w*|notary|registered mail|own use|demolition|major (?:works|renovation)s?|sale of the (?:property|unit|premises))\b/i;
/** The period after a formal reminder or notice, before eviction or termination proceedings. */
const AFTER_REMINDER =
  /\bafter\s+(?:a\s+|the\s+|any\s+)?(?:formal\s+)?(?:reminder|(?:formal\s+)?notice|warning)\b|\bformal\s+(?:reminder|notice)\b[^.;]*\b(?:evict\w*|terminat\w*|proceedings)\b/i;
const RENEWAL =
  /\b(?:rent (?:increase|change|adjustment|review)|increase (?:in |of )?(?:the )?rent|(?:increase|change|vary|amend|modify)\w*\s+(?:the\s+)?(?:rent|terms)|renew\w*|non-?renewal)\b/i;

/**
 * A number counts only when it is tied to a notice in the same sentence. A rent increase or renewal notice stating
 * days must state the rulebook's days; repossession, eviction or vacate notice stating months must state the
 * rulebook's months; the period after a formal reminder or notice stating days must state the rulebook's days.
 * Fees, deposit refunds and other periods are not rulebook values.
 */
export function legalPeriodProblems(texts: KeyedText[], rules: LegalRules): KeyedProblem[] {
  const out: KeyedProblem[] = [];
  for (const { key, text } of texts) {
    for (const s of sentencesOf(text)) {
      const periods = periodsIn(s);
      if (!periods.length || !NOTICE.test(s)) continue;
      const repo = REPOSSESSION.test(s);
      const late = AFTER_REMINDER.test(s);
      const renewal = RENEWAL.test(s);
      for (const p of periods) {
        if (p.unit === "month" && repo && p.value !== rules.repossessionNoticeMonths)
          out.push({
            key,
            problem: `${key}: states ${p.value} months' notice to vacate or repossess; the rulebook says ${rules.repossessionNoticeMonths} months.`,
          });
        else if (p.unit === "day" && late && p.value !== rules.lateRentDaysAfterFormalReminder)
          out.push({
            key,
            problem: `${key}: states ${p.value} days after a formal reminder; the rulebook says ${rules.lateRentDaysAfterFormalReminder} days.`,
          });
        else if (p.unit === "day" && !late && !repo && renewal && p.value !== rules.renewalNoticeDays)
          out.push({
            key,
            problem: `${key}: states ${p.value} days' notice of a rent change or renewal; the rulebook says ${rules.renewalNoticeDays} days.`,
          });
      }
    }
  }
  return out;
}

export type RulebookPeriodKind = "repossession" | "after_reminder" | "renewal";

/** The periods stated in sentences this file treats as rulebook-period statements, with which rule each belongs to. */
export function rulebookPeriodsIn(text: string): { kind: RulebookPeriodKind; value: number }[] {
  const out: { kind: RulebookPeriodKind; value: number }[] = [];
  for (const s of sentencesOf(text)) {
    const periods = periodsIn(s);
    if (!periods.length || !NOTICE.test(s)) continue;
    const repo = REPOSSESSION.test(s);
    const late = AFTER_REMINDER.test(s);
    const renewal = RENEWAL.test(s);
    for (const p of periods) {
      if (p.unit === "month" && repo) out.push({ kind: "repossession", value: p.value });
      else if (p.unit === "day" && late) out.push({ kind: "after_reminder", value: p.value });
      else if (p.unit === "day" && !late && !repo && renewal) out.push({ kind: "renewal", value: p.value });
    }
  }
  return out;
}

/** Words that name an emirate's own law or authorities, per emirate. */
const MARKERS: Record<Emirate, RegExp> = {
  dubai:
    /\bDubai\b|\bDEWA\b|\bRERA\b|\bDLD\b|\bEjari\b|Law\s+No\.?\s*\(?26\)?\s+of\s+2007|Law\s+No\.?\s*\(?33\)?\s+of\s+2008/gi,
  abu_dhabi: /\bAbu\s+Dhabi\b|\bADDC\b|\bADM\b|\bTawtheeq\b|\bADRA\b/gi,
  sharjah: /\bSharjah\b|\bSEWA\b/gi,
  ajman: /\bAjman\b|\bTasdeeq\b/gi,
  ras_al_khaimah: /\bRas\s+Al[\s-]+Khaimah\b|\bRAK\b/gi,
  fujairah: /\bFujairah\b|\bFEWA\b|\bEjaar\b/gi,
  umm_al_quwain: /\bUmm\s+Al[\s-]+Quwain\b|\bUAQ\b/gi,
};

function citedEmirates(text: string): Map<Emirate, string> {
  const out = new Map<Emirate, string>();
  const t = text.replace(TOKENS, " ");
  for (const [e, re] of Object.entries(MARKERS) as [Emirate, RegExp][]) {
    re.lastIndex = 0;
    const m = re.exec(t);
    if (m) out.set(e, m[0]);
  }
  return out;
}

/** Wording that names another emirate's law or authorities (Dubai's DEWA and RERA in an Abu Dhabi contract, ...). */
export function emirateWordingProblems(texts: KeyedText[], emirate: Emirate): KeyedProblem[] {
  const out: KeyedProblem[] = [];
  for (const { key, text } of texts)
    for (const [e, marker] of citedEmirates(text))
      if (e !== emirate)
        out.push({
          key,
          problem: `${key}: cites ${EMIRATE_LABELS[e]} law or authorities ("${marker}") in a contract for a unit in ${EMIRATE_LABELS[emirate]}.`,
        });
  return out;
}

/**
 * Template approval: the emirates the template covers (empty = any emirate). Wording that cites one emirate must not
 * sit in a template meant for any other.
 */
export function templateEmirateProblems(texts: KeyedText[], emirates: readonly Emirate[]): string[] {
  const out = new Set<string>();
  for (const { text } of texts)
    for (const e of citedEmirates(text).keys()) {
      const label = EMIRATE_LABELS[e];
      if (emirates.length === 0 || emirates.some((x) => x !== e))
        out.add(`This template cites ${label} law or authorities; set its emirates to ${label}.`);
    }
  return [...out];
}

/**
 * A company name: 2+ capitalised words ending in a legal-entity suffix. Authority names are never a sample company.
 */
const COMPANY_NAME = {
  kind: "a company name",
  re: /\b(?:[A-Z][a-z]+(?:\s+(?:&\s+)?)){1,4}(?:L\.?L\.?C\.?|FZ-?LLC|FZE|FZCO|PJSC|Holdings|Properties|Realty|Real Estate)\b/g,
};
const AUTHORITY =
  /\b(?:Real Estate Regulatory|Land Department|Department of|Rental Disputes|Municipality|Regulatory (?:Agency|Authority)|Dubai Real Estate|Landlord|Tenant)\b/;

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[\s,.]+/g, " ")
    .trim();

/**
 * Values printed in the fixed wording that are not this lease's own records: a code, name, number or date left over
 * from the sample contract. Blank tokens are not wording. `ownValues` are the lease's record values.
 */
export function sampleValueProblems(printed: KeyedText[], ownValues: readonly string[]): KeyedProblem[] {
  const own = ownValues.map(norm).filter(Boolean);
  const isOwn = (v: string) => {
    const n = norm(v);
    return own.some((o) => o === n || o.includes(n));
  };
  const patterns = [
    ...VALUE_PATTERNS.filter((p) => p.kind !== "a reference code"),
    { kind: "a reference code", re: REFERENCE_CODE_RE },
    COMPANY_NAME,
  ];
  const out: KeyedProblem[] = [];
  const seen = new Set<string>();
  for (const { key, text } of printed) {
    const t = text.replace(TOKENS, " ");
    for (const { kind, re } of patterns) {
      re.lastIndex = 0;
      for (const m of t.matchAll(re)) {
        const v = m[0].trim();
        if (isOwn(v) || (kind === "a company name" && AUTHORITY.test(v)) || seen.has(`${key}|${norm(v)}`)) continue;
        seen.add(`${key}|${norm(v)}`);
        out.push({ key, problem: `Fixed wording has ${kind} "${v}" that is not this lease's (${key}).` });
      }
    }
  }
  return out;
}
