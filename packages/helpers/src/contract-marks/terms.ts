import { isCalendarDate, type TermValues } from "@leasing/core";

/**
 * D72: values written in an officer's words. A term change counts only when its value is one of these (the same idea
 * as the copilot's quote check): the model reads, code verifies. Amounts are AED (dirham, "k" = thousand) in fils;
 * cheques are "N cheques" (digits or one to twelve); dates in ISO, "1 March 2027", "March 1, 2027" or "01/03/2027"
 * (day first, as in the UAE).
 */
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"] as const;
const WORDS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
};

const pad = (n: number | string) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => {
  const s = `${y}-${pad(m)}-${pad(d)}`;
  return isCalendarDate(s) ? s : null;
};

export interface WordedValues {
  amountsFils: number[];
  cheques: number[];
  dates: string[];
}

export interface Occurrence {
  kind: "amount" | "cheques" | "date";
  value: number | string;
  /** Character range in the scanned text. */
  start: number;
  end: number;
}

function amountFils(num: string, k: string | undefined): number | null {
  const n = Number(num.replaceAll(",", ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * (k ? 1000 : 1) * 100);
}

/** Every amount, cheque count and date in the text, with where it sits. */
export function scanValues(text: string): Occurrence[] {
  const out: Occurrence[] = [];
  const AMT = "(\\d[\\d,]*(?:\\.\\d+)?)\\s*(k\\b)?";
  const CUR = "(?:aed|dhs?\\.?|dirhams?)";
  const amount = (m: RegExpMatchArray, k?: string) => {
    const v = amountFils(m[1]!, k ?? m[2]);
    if (v) out.push({ kind: "amount", value: v, start: m.index!, end: m.index! + m[0].length });
  };
  for (const m of text.matchAll(new RegExp(`${CUR}\\s*${AMT}`, "gi"))) amount(m);
  for (const m of text.matchAll(new RegExp(`${AMT}\\s*${CUR}`, "gi"))) amount(m);
  for (const m of text.matchAll(/\b(\d+(?:\.\d+)?)\s*k\b/gi)) amount(m, "k");
  for (const m of text.matchAll(
    /\b(\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)[\s-]+(?:post[\s-]?dated\s+)?(?:cheques?|checks?)\b/gi,
  )) {
    const n = /^\d/.test(m[1]!) ? Number(m[1]) : WORDS[m[1]!.toLowerCase()]!;
    if (n >= 1 && n <= 12) out.push({ kind: "cheques", value: n, start: m.index!, end: m.index! + m[0].length });
  }
  const date = (m: RegExpMatchArray, d: string | null) => {
    if (d) out.push({ kind: "date", value: d, start: m.index!, end: m.index! + m[0].length });
  };
  for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) date(m, iso(+m[1]!, +m[2]!, +m[3]!));
  for (const m of text.matchAll(/\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})\b/g)) date(m, iso(+m[3]!, +m[2]!, +m[1]!));
  const month =
    "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
  const mi = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase() as (typeof MONTHS)[number]) + 1;
  for (const m of text.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}\\.?,?\\s+(\\d{4})\\b`, "gi"),
  ))
    date(m, iso(+m[3]!, mi(m[2]!), +m[1]!));
  for (const m of text.matchAll(new RegExp(`\\b${month}\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, "gi")))
    date(m, iso(+m[3]!, mi(m[1]!), +m[2]!));
  return out;
}

export function valuesInWords(text: string): WordedValues {
  const occ = scanValues(text);
  const uniq = <T>(a: T[]) => [...new Set(a)];
  return {
    amountsFils: uniq(occ.filter((o) => o.kind === "amount").map((o) => o.value as number)),
    cheques: uniq(occ.filter((o) => o.kind === "cheques").map((o) => o.value as number)),
    dates: uniq(occ.filter((o) => o.kind === "date").map((o) => o.value as string)),
  };
}

const aed = (fils: number) => `AED ${(fils / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

type Field = "annualRentFils" | "depositFils" | "cheques" | "startOn" | "moveInOn";
/** The keyword that names each term (one word of the officer's text, punctuation dropped). */
const KEYWORDS: { field: Field; word: RegExp }[] = [
  { field: "annualRentFils", word: /^(rent|rental)$/ },
  { field: "depositFils", word: /^deposit$/ },
  { field: "cheques", word: /^(cheques?|checks?|payments?|instal+ments?)$/ },
  {
    field: "startOn",
    word: /^(start|starts|starting|commence|commences|commencing|commencement|begin|begins|beginning)$/,
  },
  { field: "moveInOn", word: /^(move-?in|move|moves|moving|movein)$/ },
];
/** A value is bound to a term when the term's keyword is within this many words of it, in the same sentence. */
const REACH = 6;

const SENTENCE = /(?<=[.!?])\s+(?=[A-Z])|[;\n]+/;

/**
 * For every value in the text, the term(s) it belongs to: the nearest keyword within REACH words, in the same
 * sentence (a keyword before the value wins a tie). A value with no keyword near it belongs to no term.
 */
export function boundValues(text: string): { occ: Occurrence; fields: Field[] }[] {
  const out: { occ: Occurrence; fields: Field[] }[] = [];
  for (const sentence of text.split(SENTENCE)) {
    if (!sentence.trim()) continue;
    const tokens = [...sentence.matchAll(/\S+/g)].map((m) => ({
      start: m.index!,
      end: m.index! + m[0].length,
      word: m[0].toLowerCase().replace(/[^a-z-]/g, ""),
    }));
    const keyAt = tokens.flatMap((t, idx) =>
      KEYWORDS.filter((k) => k.word.test(t.word)).map((k) => ({ idx, field: k.field })),
    );
    for (const occ of scanValues(sentence)) {
      const first = tokens.findIndex((t) => t.end > occ.start);
      const last = tokens.findLastIndex((t) => t.start < occ.end);
      let best: { d: number; before: boolean; field: Field }[] = [];
      for (const k of keyAt) {
        // A cheque count carries its own keyword ("6 cheques").
        if (occ.kind === "cheques" && k.field !== "cheques") continue;
        if (occ.kind !== "cheques" && k.field === "cheques") continue;
        if (occ.kind === "date" && k.field !== "startOn" && k.field !== "moveInOn") continue;
        if (occ.kind === "amount" && k.field !== "annualRentFils" && k.field !== "depositFils") continue;
        const before = k.idx < first;
        const d = before ? first - k.idx : k.idx - last;
        if (occ.kind === "cheques" ? k.idx >= first && k.idx <= last : d > 0 && d <= REACH)
          best.push({ d: occ.kind === "cheques" ? 0 : d, before, field: k.field });
      }
      best = best.toSorted((a, b) => a.d - b.d || Number(b.before) - Number(a.before));
      const top = best[0];
      out.push({
        occ,
        fields: top
          ? [...new Set(best.filter((b) => b.d === top.d && b.before === top.before).map((b) => b.field))]
          : [],
      });
    }
  }
  return out;
}

/**
 * The model's proposed term values, kept only where the officer's words contain them AND the value sits next to that
 * term's keyword (rent, deposit, cheques, start, move-in; within a few words, same sentence). Returns the accepted
 * values and one problem per value that is not in the words or can't be tied to its term.
 */
export function checkTermChanges(proposed: TermValues, words: string): { accepted: TermValues; problems: string[] } {
  const bound = boundValues(words);
  const accepted: TermValues = {};
  const problems: string[] = [];
  const check = (field: Field, kind: Occurrence["kind"], value: number | string, label: string, shown: string) => {
    const same = bound.filter((b) => b.occ.kind === kind && b.occ.value === value);
    if (!same.length) problems.push(`${label} ${shown} is not written in your words. Write the exact value to change.`);
    else if (same.some((b) => b.fields.includes(field))) (accepted as Record<string, unknown>)[field] = value;
    else problems.push(`Say which term this value is for: ${shown} (for example "rent ${shown}").`);
  };
  if (proposed.annualRentFils !== undefined)
    check("annualRentFils", "amount", proposed.annualRentFils, "The rent", aed(proposed.annualRentFils));
  if (proposed.depositFils !== undefined)
    check("depositFils", "amount", proposed.depositFils, "The deposit", aed(proposed.depositFils));
  if (proposed.cheques !== undefined)
    check("cheques", "cheques", proposed.cheques, "The number of cheques", String(proposed.cheques));
  if (proposed.startOn !== undefined) check("startOn", "date", proposed.startOn, "The start date", proposed.startOn);
  if (proposed.moveInOn !== undefined)
    check("moveInOn", "date", proposed.moveInOn, "The move-in date", proposed.moveInOn);
  return { accepted, problems };
}
