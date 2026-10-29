import type { ContractFieldName } from "@leasing/core";
import type { RawBlank } from "./blanks.ts";

/**
 * A sample contract is often a FILLED contract. Its people, numbers and dates must never become fixed wording
 * (rules 1 and 8), so code finds them and turns each into a blank (a "label" blank, marker empty). Known
 * labels get a proposed field (validated afterwards against the catalogue and the blank's type); other values
 * found by pattern (Emirates ID, passport, phone, email, AED amount, date, contract number) become blanks the
 * admin must map. The model plays no part in this.
 */

export type Party = "landlord" | "tenant";

const NUM_WORDS =
  "one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|and";

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
  /\b(this sample|sample (?:contract|document|only)|modell?ed on|fictitious|fictional|for illustration|illustrative purposes|have (?:it|this) reviewed by|lawyer review|legal review)\b/i;
export const isSampleOnlyText = (text: string): boolean => SAMPLE_ONLY.test(text);

interface LabelDef {
  re: string;
  /** Label printed for the blank. */
  label: string;
  /** One entry per value of a compound label ("Phone / Email"). `null`: a known label with no contract field. */
  fields: (ContractFieldName | null | { landlord: ContractFieldName | null; tenant: ContractFieldName | null })[];
}

const both = (landlord: ContractFieldName | null, tenant: ContractFieldName | null) => ({ landlord, tenant });
const ROLE = String.raw`(?:(?:owner|landlord|lessor|tenant|lessee)(?:'s)?\s+)?`;

/** Longest and most specific first. `\b` anchors keep "Name" from matching inside other words. */
const LABELS: LabelDef[] = [
  {
    re: String.raw`nationality\s*/\s*passport\s*(?:no\.?|number)?`,
    label: "Nationality / Passport",
    fields: ["tenantNationality", "tenantPassportNo"],
  },
  {
    re: String.raw`phone\s*/\s*e-?mail`,
    label: "Phone / Email",
    fields: [both("landlordPhone", "tenantPhone"), both("landlordEmail", "tenantEmail")],
  },
  { re: String.raw`${ROLE}(?:full\s+)?name`, label: "Name", fields: [both("landlordNameEn", "tenantNameEn")] },
  {
    re: String.raw`${ROLE}emirates\s*id(?:\s*(?:no\.?|number))?`,
    label: "Emirates ID",
    fields: [both("landlordIdNo", "tenantEmiratesIdNo")],
  },
  { re: String.raw`nationality`, label: "Nationality", fields: [both("landlordNationality", "tenantNationality")] },
  { re: String.raw`passport\s*(?:no\.?|number)?`, label: "Passport number", fields: [both(null, "tenantPassportNo")] },
  {
    re: String.raw`(?:phone|mobile|tel(?:ephone)?)(?:\s*(?:no\.?|number))?`,
    label: "Phone",
    fields: [both(null, "tenantPhone")],
  },
  { re: String.raw`e-?mail(?:\s+address)?`, label: "Email", fields: [both("landlordEmail", "tenantEmail")] },
  { re: String.raw`(?:landlord|owner)(?:'s|’s)?\s+representative`, label: "Landlord representative", fields: [null] },
  { re: String.raw`occupants?`, label: "Occupants", fields: [null] },
  { re: String.raw`contract\s*(?:no\.?|number|ref(?:erence)?)`, label: "Contract number", fields: ["leaseRef"] },
  { re: String.raw`date\s+of\s+contract`, label: "Date of contract", fields: [null] },
  { re: String.raw`lease\s+period`, label: "Lease period", fields: [null] },
  { re: String.raw`(?:lease\s+)?(?:start|commencement)\s+date`, label: "Start date", fields: ["startOn"] },
  { re: String.raw`(?:lease\s+)?(?:end|expiry)\s+date`, label: "End date", fields: ["endOn"] },
  { re: String.raw`annual\s+rent`, label: "Annual rent", fields: ["annualRentFils"] },
  { re: String.raw`payment\s+method`, label: "Payment method", fields: [null] },
  { re: String.raw`(?:security\s+)?deposit(?:\s+amount)?`, label: "Security deposit", fields: ["depositFils"] },
  { re: String.raw`property\s+(?:type|usage)|usage`, label: "Property usage", fields: [null] },
  { re: String.raw`building(?:\s+name)?`, label: "Building", fields: ["building"] },
  { re: String.raw`(?:community|area|location)`, label: "Community", fields: ["community"] },
  { re: String.raw`(?:unit|flat|apartment)\s*(?:no\.?|number)?`, label: "Unit number", fields: ["unitNo"] },
  { re: String.raw`plot\s*(?:no\.?|number)?`, label: "Plot number", fields: ["plotNo"] },
  { re: String.raw`makani\s*(?:no\.?|number)?`, label: "Makani number", fields: ["makaniNo"] },
  { re: String.raw`property\s*(?:no\.?|number)`, label: "Property number", fields: ["dldPropertyNo"] },
  { re: String.raw`(?:no\.?\s+of\s+)?bedrooms?`, label: "Bedrooms", fields: ["bedrooms"] },
  // Stops for the value before them (their own value is a blank token already, so they are left as printed).
  { re: String.raw`(?:signature|signed|date|initials?|witness|stamp)(?=\s*:)`, label: "Signature", fields: [null] },
  { re: String.raw`furnish(?:ed|ing)(?:\s+status)?`, label: "Furnishing", fields: [null] },
];

const ALT = new RegExp(`(?<![\\w'])(${LABELS.map((l, i) => `(?<l${i}>${l.re})`).join("|")})(?![\\w])\\s*:?`, "gi");
const ROLE_WORDS = /\b(landlord|owner|lessor|tenant|lessee)\b/gi;
const partyOf = (w: string): Party => (/^(?:landlord|owner|lessor)$/i.test(w) ? "landlord" : "tenant");

export interface FilledBlank extends RawBlank {
  /** Set when code found a known label: the proposed field (validated by the caller), or "unmapped". */
  proposedField?: ContractFieldName | "unmapped";
  /** Label chosen by code; the model's label is ignored for it. */
  fixedLabel?: string;
}

/** Words that may stand in front of the first label of a row ("LANDLORD TENANT Name: .. Name: .."). */
const LEAD_ONLY = /^[\s\W]*(?:(?:landlord|owner|lessor|tenant|lessee|and|party)\b[\s\W]*)*$/i;

/**
 * Replaces filled values in `lines` by `{{bN}}` tokens (ids continue from `startIndex`). Existing tokens are left as
 * they are. Only a line that starts with a known label is read this way (prose that happens to contain "area" is not);
 * a value runs from after its label to the next label or the end of the line. A label alone on its line takes the
 * next line as its value (table cells printed one per line).
 */
export function detectFilledValues(lines: string[], startIndex: number): { lines: string[]; blanks: FilledBlank[] } {
  const blanks: FilledBlank[] = [];
  let party: Party | null = null;
  const next = () => `b${startIndex + blanks.length + 1}`;
  const tokensFor = (def: LabelDef, role: Party | null, value: string, lineNo: number): string => {
    const multi = def.fields.length > 1;
    const parts = multi ? value.split(/\s+\/\s+/) : [value];
    const tokens: string[] = [];
    for (let p = 0; p < parts.length; p++) {
      const f1 = multi ? (def.fields[p] ?? null) : (def.fields[0] ?? null);
      const field = f1 && typeof f1 === "object" ? (role === "landlord" ? f1.landlord : f1.tenant) : f1;
      const id = next();
      const labelText = multi ? (def.label.split(" / ")[p] ?? def.label) : def.label;
      const who =
        role && /^(?:Name|Emirates ID|Phone|Email|Nationality|Passport number|Passport)$/.test(labelText)
          ? `${role === "landlord" ? "Landlord" : "Tenant"} `
          : "";
      const label = `${who}${labelText}`.replace(/^(Landlord|Tenant) Name$/, "$1 name");
      blanks.push({
        id,
        kind: "label",
        marker: "",
        line: lineNo,
        before: label,
        after: "",
        proposedField: field ?? "unmapped",
        fixedLabel: label,
      });
      tokens.push(`{{${id}}}`);
    }
    return tokens.join(" / ");
  };
  let carry: { def: LabelDef; role: Party | null } | null = null;
  const out = lines.map((line, lineNo) => {
    const found = [...line.matchAll(ALT)].map((m) => {
      const idx = LABELS.findIndex((_, i) => m.groups?.[`l${i}`] !== undefined);
      return { idx, start: m.index, end: m.index + m[0].length, text: m[0] };
    });
    if (!found.length) {
      if (carry && line.trim() && line.trim().length <= 120 && !/\{\{b\d+\}\}/.test(line)) {
        const t = tokensFor(carry.def, carry.role, line.trim(), lineNo);
        carry = null;
        return t;
      }
      carry = null;
      const words = [...line.matchAll(ROLE_WORDS)];
      if (words.length === 1 && line.trim().length <= 60) party = partyOf(words[0]![1]!);
      return line;
    }
    carry = null;
    const prefix = line.slice(0, found[0]!.start);
    if (!LEAD_ONLY.test(prefix)) return line;
    const lead = [...prefix.matchAll(ROLE_WORDS)].map((m) => partyOf(m[1]!));
    // "LANDLORD TENANT Name: .. Name: ..": the first label's own role word is the last of the row's roles.
    const firstOwn = /\b(landlord|owner|lessor|tenant|lessee)\b/i.exec(found[0]!.text);
    if (firstOwn) lead.push(partyOf(firstOwn[1]!));
    if (lead.length === 1) party = lead[0]!;
    const seenKind = new Map<number, number>();
    let rebuilt = prefix;
    found.forEach((f, k) => {
      const def = LABELS[f.idx]!;
      const valueEnd = found[k + 1]?.start ?? line.length;
      const value = line.slice(f.end, valueEnd).replace(/^[\s:|]+|[\s|;,]+$/g, "");
      const used = seenKind.get(f.idx) ?? 0;
      seenKind.set(f.idx, used + 1);
      const own = /\b(landlord|owner|lessor|tenant|lessee)\b/i.exec(f.text);
      const role: Party | null = lead.length > 1 ? (lead[used] ?? party) : own ? partyOf(own[1]!) : party;
      if (lead.length <= 1 && own) party = role;
      if (!value) {
        rebuilt += line.slice(f.start, valueEnd);
        if (k === found.length - 1) carry = { def, role };
        return;
      }
      if (/\{\{b\d+\}\}/.test(value)) {
        rebuilt += line.slice(f.start, valueEnd);
        return;
      }
      rebuilt += `${line.slice(f.start, f.end).trimEnd()} ${tokensFor(def, role, value, lineNo)} `;
    });
    return rebuilt.replace(/\s+$/g, "");
  });
  // Anything else that is a specific value by pattern becomes a blank the admin must map.
  const swept = out.map((line, lineNo) => {
    let cur = line;
    for (const { re } of VALUE_PATTERNS) {
      cur = cur.replace(new RegExp(re.source, re.flags), (m, ...rest) => {
        const offset = rest.find((x) => typeof x === "number") as number;
        const before = cur
          .slice(0, offset)
          .replace(/\{\{b\d+\}\}/g, " ")
          .replace(/[\s:|\-–]+$/, "");
        const tailWords = before.split(/\s+/).slice(-3).join(" ").slice(-60);
        const id = next();
        blanks.push({ id, kind: "label", marker: "", line: lineNo, before: tailWords, after: "" });
        void m;
        return `{{${id}}}`;
      });
    }
    return cur;
  });
  return { lines: swept, blanks };
}
