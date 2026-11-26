/**
 * Specific values in a sample agreement (UAE): IDs, emails, phones, passports, AED amounts, dates, reference codes.
 * They must never become fixed wording, so code turns them into blanks; no model is involved.
 */
const NUM_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and";

/** A reference code such as DEMO-DLD-000017, ARR-0017 or DEMO-TL-100201: the one pattern for sweeps and checks. */
export const REFERENCE_CODE_RE = /\b[A-Z]{2,6}(?:-[A-Z]{2,6})*-\d{2,}[A-Z0-9-]*\b/g;

/** Patterns for personal data and specific values: also the hard block on fixed wording (see `fixedValueKinds`). */
export const VALUE_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "an Emirates ID number", re: /\b784[-\s]?\d{4}[-\s]?\d{7}[-\s]?\d\b/g },
  { kind: "an email address", re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g },
  {
    kind: "a phone number",
    re: /(?<![\w-])(?:\+|00)\d{1,3}[\s-]?\d{1,3}[\s-]?\d{3}[\s-]?\d{3,4}\b|\b0\d{1,2}[\s-]?\d{3}[\s-]?\d{4}\b/g,
  },
  { kind: "a passport number", re: /\b[A-Z]{1,2}\d{6,9}\b/g },
  {
    kind: "an AED amount",
    re: new RegExp(
      `\\bAED\\s?\\d[\\d,]*(?:\\.\\d+)?|\\b\\d[\\d,]*(?:\\.\\d+)?\\s*(?:dirhams?|dhs?|AED)\\b|\\b(?:AED|dirhams?)\\s+(?:${NUM_WORDS})\\b|\\b(?:${NUM_WORDS})(?:[\\s-]+(?:${NUM_WORDS}))*\\s+(?:dirhams?|UAE dirhams?|AED)\\b`,
      "gi",
    ),
  },
  {
    kind: "a date",
    re: /\b\d{1,2}(?:st|nd|rd|th)?[\s-](?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[\s-]\d{4}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s\d{1,2}(?:st|nd|rd|th)?,?\s\d{4}\b|\b\d{1,2}[/.]\d{1,2}[/.]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/gi,
  },
  { kind: "a contract number", re: /\b[A-Z]{2,5}-\d{4}-\d{3,}\b/g },
  // D70: codes of one sample record (unit ARR-0017, DEMO-DLD-000017, DEMO-TL-100201). Capitals joined by hyphens, then digits.
  { kind: "a reference code", re: REFERENCE_CODE_RE },
];

/** What of a text can never be fixed wording. Blank tokens are not wording and are ignored. */
export function fixedValueKinds(text: string): string[] {
  const t = text.replace(/\{\{b\d+\}\}/g, " ");
  const out: string[] = [];
  for (const { kind, re } of VALUE_PATTERNS) {
    re.lastIndex = 0;
    if (re.test(t)) out.push(kind);
  }
  return out;
}

/** Text that belongs to the sample document, not to a contract (a disclaimer about the sample). */
const SAMPLE_ONLY =
  /\b(this sample|sample (?:contract|document|only)|modell?ed on|fictitious|fictional|for illustration|illustrative purposes|have (?:it|this) reviewed by|lawyer review|legal review|data source map|field\s+value\s+copied\s+from|where each value in this contract was copied from)\b/i;
export const isSampleOnlyText = (text: string): boolean => SAMPLE_ONLY.test(text);

/**
 * The generic last pass of filled-sample detection: every value found by pattern becomes a blank the admin maps
 * (`{{bN}}`, ids after `startIndex`), on every line, as leasing's sweep does.
 */
export function sweepValuePatterns(
  lines: string[],
  startIndex: number,
): {
  lines: string[];
  blanks: { id: string; kind: "label"; marker: string; line: number; before: string; after: string }[];
} {
  const blanks: { id: string; kind: "label"; marker: string; line: number; before: string; after: string }[] = [];
  const out = lines.map((line, lineNo) => {
    let cur = line;
    for (const { re } of VALUE_PATTERNS) {
      cur = cur.replace(new RegExp(re.source, re.flags), (_m, ...rest) => {
        const offset = rest.find((x) => typeof x === "number") as number;
        const before = cur
          .slice(0, offset)
          .replace(/\{\{b\d+\}\}/g, " ")
          .replace(/[\s:|\-–]+$/, "");
        const id = `b${startIndex + blanks.length + 1}`;
        blanks.push({
          id,
          kind: "label",
          marker: "",
          line: lineNo,
          before: before.split(/\s+/).slice(-3).join(" ").slice(-60),
          after: "",
        });
        return `{{${id}}}`;
      });
    }
    return cur;
  });
  return { lines: out, blanks };
}
