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

interface LabelDef {
  re: string;
  /** Label printed for the blank. */
  label: string;
  /** One entry per value of a compound label ("Phone / Email"). `null`: a known label with no contract field. */
  fields: (SheetKey | null | { landlord: SheetKey | null; tenant: SheetKey | null })[];
}

/** A contract field or a data-sheet key (`SHEET_KEYS`); the caller validates it against the blank. */
type SheetKey =
  | ContractFieldName
  | "unitDescription"
  | "furnishing"
  | "bathrooms"
  | "areaSqft"
  | "parkingSpaces"
  | "floor"
  | "propertySubtype"
  | "dewaPremiseNo"
  | "unitCode"
  | "signatoryName";

const both = (landlord: SheetKey | null, tenant: SheetKey | null) => ({ landlord, tenant });
const ROLE = String.raw`(?:(?:owner|landlord|lessor|tenant|lessee)(?:'s)?\s+)?`;

/** Longest and most specific first. `\b` anchors keep "Name" from matching inside other words. */
const LABELS: LabelDef[] = [
  // D70: a heading "DLD Property No. <value>" or "DEWA Premise No. <value>" keeps its label; the value is a blank.
  { re: String.raw`dld\s+property\s*(?:no\.?|number)`, label: "DLD property number", fields: ["dldPropertyNo"] },
  { re: String.raw`dewa\s+premises?\s*(?:no\.?|number)?`, label: "DEWA premise number", fields: ["dewaPremiseNo"] },
  { re: String.raw`category\s*/\s*type`, label: "Property type", fields: ["propertySubtype"] },
  { re: String.raw`unit\s+code`, label: "Unit code", fields: ["unitCode"] },
  // Row leaders: their own text is wording; they let "4 Bedrooms | 4 Bathrooms" after them be read as a label row.
  { re: String.raw`layout|payment\s+schedule`, label: "Layout", fields: [null] },
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
  // D64: lines that describe the unit print from the unit record, never the sample's wording.
  {
    re: String.raw`(?:property|unit)\s+description|description(?:\s+of\s+(?:the\s+)?(?:property|unit|premises))?`,
    label: "Unit description",
    fields: ["unitDescription"],
  },
  { re: String.raw`(?:property|unit)\s+type`, label: "Property type", fields: ["propertySubtype"] },
  { re: String.raw`(?:property\s+)?usage`, label: "Property usage", fields: ["propertyUsage"] },
  {
    re: String.raw`built[-\s]?up\s+area|(?:property|unit)\s+(?:area|size)|(?:area|size)\s*\(\s*sq\.?\s*f(?:ee)?t\.?\s*\)`,
    label: "Area (sq ft)",
    fields: ["areaSqft"],
  },
  { re: String.raw`(?:no\.?\s+of\s+)?bathrooms?`, label: "Bathrooms", fields: ["bathrooms"] },
  { re: String.raw`parking(?:\s+(?:spaces?|bays?))?`, label: "Parking spaces", fields: ["parkingSpaces"] },
  { re: String.raw`floor(?:\s*(?:no\.?|number))?(?=\s*:)`, label: "Floor", fields: ["floor"] },
  { re: String.raw`building(?:\s+name)?`, label: "Building", fields: ["building"] },
  { re: String.raw`(?:community|area|location)`, label: "Community", fields: ["community"] },
  { re: String.raw`(?:unit|flat|apartment)\s*(?:no\.?|number)?`, label: "Unit number", fields: ["unitNo"] },
  { re: String.raw`plot\s*(?:no\.?|number)?`, label: "Plot number", fields: ["plotNo"] },
  { re: String.raw`makani\s*(?:no\.?|number)?`, label: "Makani number", fields: ["makaniNo"] },
  { re: String.raw`property\s*(?:no\.?|number)`, label: "Property number", fields: ["dldPropertyNo"] },
  { re: String.raw`(?:no\.?\s+of\s+)?bedrooms?`, label: "Bedrooms", fields: ["bedrooms"] },
  // Stops for the value before them (their own value is a blank token already, so they are left as printed).
  { re: String.raw`(?:signature|signed|date|initials?|witness|stamp)(?=\s*:)`, label: "Signature", fields: [null] },
  { re: String.raw`furnish(?:ed|ing)(?:\s+status)?`, label: "Furnishing", fields: ["furnishing"] },
];

/** Fields whose sample text (a name, a community) is looked for again in the fixed wording (D70). */
const SWEEP_FIELDS = new Set<string>(["landlordNameEn", "tenantNameEn", "community", "building"]);
/** "4 Bedrooms", "1 Parking space", "4 cheques": a count in front of its word, read only on a label row (D70). */
const COUNTS = /\b(\d{1,2})\s+(bedrooms?|bathrooms?|parking\s+(?:spaces?|bays?)|cheques?)\b/gi;
const COUNT_FIELDS: [RegExp, string, SheetKey][] = [
  [/^bedroom/i, "Bedrooms", "bedrooms"],
  [/^bathroom/i, "Bathrooms", "bathrooms"],
  [/^parking/i, "Parking spaces", "parkingSpaces"],
  [/^cheque/i, "Cheques", "cheques"],
];

const ALT = new RegExp(`(?<![\\w'])(${LABELS.map((l, i) => `(?<l${i}>${l.re})`).join("|")})(?![\\w])\\s*:?`, "gi");
const ROLE_WORDS = /\b(landlord|owner|lessor|tenant|lessee)\b/gi;
const partyOf = (w: string): Party => (/^(?:landlord|owner|lessor)$/i.test(w) ? "landlord" : "tenant");

export interface FilledBlank extends RawBlank {
  /** Set when code found a known label: the proposed field (validated by the caller), or "unmapped". */
  proposedField?: SheetKey | "unmapped";
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
export function detectFilledValues(
  lines: string[],
  startIndex: number,
  /**
   * D74: ids of the named-placeholder blanks. A line holding one is a template row ("Community / area: {community}"),
   * not a filled one, so its labels are not read; other lines (a sample's "Tenant Name Ahmed Example") still are.
   * Values found by pattern (IDs, emails, dates ...) are blanked everywhere.
   */
  placeholderIds: ReadonlySet<string> = new Set(),
): { lines: string[]; blanks: FilledBlank[] } {
  const blanks: FilledBlank[] = [];
  let party: Party | null = null;
  const next = () => `b${startIndex + blanks.length + 1}`;
  /** D70: sample values of these fields are found again in the fixed wording and blanked there too. */
  const samples: { value: string; field: SheetKey; label: string }[] = [];
  const add = (label: string, field: SheetKey | null, lineNo: number): string => {
    const id = next();
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
    return `{{${id}}}`;
  };
  const tokensFor = (def: LabelDef, role: Party | null, value: string, lineNo: number): string => {
    const multi = def.fields.length > 1;
    const parts = multi ? value.split(/\s+\/\s+/) : [value];
    const tokens: string[] = [];
    for (let p = 0; p < parts.length; p++) {
      const f1 = multi ? (def.fields[p] ?? null) : (def.fields[0] ?? null);
      const field = f1 && typeof f1 === "object" ? (role === "landlord" ? f1.landlord : f1.tenant) : f1;
      const labelText = multi ? (def.label.split(" / ")[p] ?? def.label) : def.label;
      const who =
        role && /^(?:Name|Emirates ID|Phone|Email|Nationality|Passport number|Passport)$/.test(labelText)
          ? `${role === "landlord" ? "Landlord" : "Tenant"} `
          : "";
      const label = `${who}${labelText}`.replace(/^(Landlord|Tenant) Name$/, "$1 name");
      if (!multi && field && SWEEP_FIELDS.has(field) && value.length >= 4 && value.length <= 80) {
        samples.push({ value, field, label });
      }
      tokens.push(add(label, field, lineNo));
    }
    return tokens.join(" / ");
  };
  const hasPlaceholder = (l: string) => [...l.matchAll(/\{\{(b\d+)\}\}/g)].some((m) => placeholderIds.has(m[1]!));
  let carry: { def: LabelDef; role: Party | null } | null = null;
  const out = lines.map((rawLine, lineNo) => {
    let line = rawLine;
    if (hasPlaceholder(line)) return line;
    // D70: on a label row ("Layout 4 Bedrooms | 4 Bathrooms", "Payment Schedule 4 cheques of ...") a count in front of
    // its word is a blank. Never in prose: a row must start with a known label (or none but role words before it).
    const head = ALT.exec(line);
    ALT.lastIndex = 0;
    const leadDef = head ? LABELS.findIndex((_, i) => head.groups?.[`l${i}`] !== undefined) : -1;
    if (head && LEAD_ONLY.test(line.slice(0, head.index)) && LABELS[leadDef]!.label !== "Unit description") {
      line = line.replace(COUNTS, (_m, _n: string, word: string) => {
        const [, label, field] = COUNT_FIELDS.find(([re]) => re.test(word))!;
        return `${add(label, field, lineNo)} ${word}`;
      });
    }
    const all = [...line.matchAll(ALT)].map((m) => {
      const idx = LABELS.findIndex((_, i) => m.groups?.[`l${i}`] !== undefined);
      return { idx, start: m.index, end: m.index + m[0].length, text: m[0] };
    });
    // A description is free text to the end of its line: words in it ("Four-bedroom", "parking") are not labels.
    const desc = all.findIndex((f) => LABELS[f.idx]!.label === "Unit description");
    const found = desc >= 0 ? all.slice(0, desc + 1) : all;
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
    // D70: a label line that wraps from a sentence ("... the Tenant shall supply a valid" / "Emirates ID ...") belongs
    // to the last role word of that sentence.
    const prev = lineNo > 0 ? (lines[lineNo - 1] ?? "") : "";
    if (!prefix.trim() && prev.trim() && !/[.:;!?]\s*$/.test(prev) && ![...prev.matchAll(ALT)].length) {
      const words = [...prev.matchAll(ROLE_WORDS)];
      if (words.length) party = partyOf(words.at(-1)![1]!);
    }
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
  // D70: a name beside a signature blank with no label ("Al Noor Family Holdings Authorised Signatory: {{b1}} Priya
  // Example Rao Signature: {{b2}}") is a sample name. In a row with two such names the first is the landlord's, the
  // second the tenant's; a single one takes the party named above it. Anything else is left as it is.
  const labelOnly = new RegExp(ALT.source, "i");
  const signed = out.map((line, lineNo) => {
    if (hasPlaceholder(line)) return line;
    if (!/\b(?:signature|signatory)\s*:\s*\{\{b\d+\}\}/i.test(line)) return line;
    const parts = line.split(/(\{\{b\d+\}\})/);
    const names: { at: number; name: string; start: number }[] = [];
    for (let i = 0; i + 1 < parts.length; i += 2) {
      const seg = parts[i]!;
      const m = /\s*(?:authori[sz]ed\s+)?(?:signatory|signature)\s*:\s*$/i.exec(seg);
      if (!m) continue;
      const lead = seg.slice(0, m.index);
      const name = lead.trim();
      const ok =
        name.length >= 3 &&
        name.length <= 60 &&
        /^[A-Z][\w.&'\u2019-]*(?:\s+[\w.&'\u2019-]+){0,6}$/.test(name) &&
        !/\d/.test(name) &&
        !LEAD_ONLY.test(name) &&
        !labelOnly.test(name);
      if (ok) names.push({ at: i, name, start: lead.indexOf(name) });
    }
    // An "Authorised Signatory:" signs for the company, so the name before it is the landlord's. A row is two columns
    // (landlord, tenant), so a name after its blank at the end of the line is the tenant's, as when the row is split.
    const signatory = (n: { at: number }) => /authori[sz]ed\s+signatory\s*:\s*$/i.test(parts[n.at]!);
    const after: { at: number; name: string; start: number }[] = [];
    for (let i = 0; i + 2 < parts.length + 1; i += 2) {
      if (!/authori[sz]ed\s+signatory\s*:\s*$/i.test(parts[i] ?? "")) continue;
      const seg = parts[i + 2];
      if (seg === undefined) continue;
      const m =
        /^\s*([A-Z][\w.&'\u2019-]*(?:\s+[A-Z][\w.&'\u2019-]*){1,5})(?=\s+(?:signature|signatory|date|stamp)\b|\s*$)/.exec(
          seg,
        );
      if (m && !/\d/.test(m[1]!) && !labelOnly.test(m[1]!))
        after.push({ at: i + 2, name: m[1]!, start: seg.indexOf(m[1]!) });
    }
    if (!names.length && !after.length) return line;
    const roles: Party[] =
      names.length === 1 && signatory(names[0]!)
        ? ["landlord"]
        : names.length >= 2
          ? ["landlord", "tenant"]
          : party
            ? [party]
            : [];
    const edits: { at: number; start: number; name: string; label: string; field: SheetKey }[] = [];
    names.slice(0, roles.length).forEach((n, k) => {
      const role = roles[k]!;
      edits.push({
        ...n,
        label: role === "landlord" ? "Landlord name" : "Tenant name",
        field: role === "landlord" ? "landlordNameEn" : "tenantNameEn",
      });
    });
    // Only when the row has no second name before a signature of its own (that one is the tenant already).
    if (names.length === 1) for (const n of after) edits.push({ ...n, label: "Tenant name", field: "tenantNameEn" });
    // Blank ids in reading order; replaced right to left so earlier offsets stay valid.
    const ordered = edits.toSorted((a, b) => a.at - b.at || a.start - b.start);
    const tokens = ordered.map((e) => {
      samples.push({ value: e.name, field: e.field, label: e.label });
      return add(e.label, e.field, lineNo);
    });
    for (let k = ordered.length - 1; k >= 0; k--) {
      const e = ordered[k]!;
      const seg = parts[e.at]!;
      parts[e.at] = `${seg.slice(0, e.start)}${tokens[k]}${seg.slice(e.start + e.name.length)}`;
    }
    return parts.join("");
  });
  // D70: a sample value of a name or a community is blanked everywhere else it stands as whole words (min 4 letters).
  const seen = new Set<string>();
  const sweeps = samples
    // Only a name of 2+ words or a capitalised proper noun of 6+ letters; matched with the same capitals.
    .filter((x) => /\s/.test(x.value.trim()) || /^[A-Z][a-z]{5,}$/.test(x.value.trim()))
    .filter((x) => (seen.has(x.value) ? false : (seen.add(x.value), true)))
    .toSorted((a, b) => b.value.length - a.value.length);
  const again = signed.map((line, lineNo) => {
    let cur = line;
    for (const x of sweeps) {
      const re = new RegExp(
        `(?<![\\w])${x.value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}(?![\\w])`,
        "g",
      );
      cur = cur.replace(re, () => add(x.label, x.field, lineNo));
    }
    return cur;
  });
  // Anything else that is a specific value by pattern becomes a blank the admin must map.
  const swept = again.map((line, lineNo) => {
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
