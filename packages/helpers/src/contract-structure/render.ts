import { type Addendum, calendarDate, type ContractFields } from "@leasing/core";
import { z } from "zod";
import { addendumBlocks, REQUIRED_TERMS } from "../contract/template.ts";
import { hasValues } from "../contract-template/values.ts";
import { compatible, inferBlankType } from "./blanks.ts";
import { sheetKeyInfo } from "./datasheet.ts";
import type { FieldType } from "./fields.ts";
import { fixedValueKinds, isSampleOnlyText } from "./filled.ts";
import { formatCalendarDate, formatMoneyFils } from "./format.ts";
import { hasAuthorityMarks } from "./look.ts";
import type { NumberingStyle, TemplateBlank, TemplateSections, TemplateStyle } from "./schema.ts";

/**
 * Review and rendering of a company contract template (slice 4, Task 3). Everything here is code:
 * which blanks block approval, which header, footer or logo may be used, and how a contract field
 * is written into a blank. No model is involved, and a value that is missing is never replaced by
 * an empty line for a core legal or money field: the render fails with the list of what is missing.
 */

/** The admin's decisions on a proposed template. The section wording is never editable. */
export const TemplateReview = z
  .object({
    dropHeader: z.boolean().default(false),
    dropFooter: z.boolean().default(false),
    dropLogo: z.boolean().default(false),
    /** "This is our company's logo (not DLD or a government mark)". */
    logoConfirmed: z.boolean().default(false),
    /** "I checked the contract wording for authority marks": needed when marks were found but no area was named. */
    authorityChecked: z.boolean().default(false),
    /** Paragraph keys (see `templateParagraphs`) whose numbers, periods, dates or amounts the admin checked. */
    valuesConfirmed: z.array(z.string().max(60)).max(1000).default([]),
    /** Paragraph keys whose authority wording the admin confirmed as "Neutral reference, not branding". */
    authorityBodyConfirmed: z.array(z.string().max(60)).max(1000).default([]),
    /** Paragraph keys the admin dropped ("Drop this line"): not printed in contracts, and their blanks are not needed. */
    droppedParagraphs: z.array(z.string().max(60)).max(1000).default([]),
  })
  .strict();
export type TemplateReview = z.infer<typeof TemplateReview>;
export const EMPTY_REVIEW: TemplateReview = TemplateReview.parse({});

/** A block of the rendered contract (same shapes as the PDF renderer's styled blocks). */
export type TemplateBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "sigline"; label: string }
  | { kind: "small"; text: string };

/** The render cannot go ahead: each entry says what to fix. The engine turns it into a 422. */
export class TemplateRenderError extends Error {
  constructor(readonly problems: string[]) {
    super(`The company template can't be filled: ${problems.join(" ")}`);
    this.name = "TemplateRenderError";
  }
}

/**
 * Legal and money fields that only come from the lease, the unit and the rulebook (rule 1). A blank mapped to one
 * of these with no value blocks preparation; any other missing value prints as an empty line for hand-filling.
 */
export const CORE_FIELDS: ReadonlySet<string> = new Set<string>([
  "annualRentFils",
  "startOn",
  "endOn",
  "depositFils",
  "cheques",
  "landlordNameEn",
  "tenantNameEn",
  "unitNo",
  "dldPropertyNo",
  "leaseRef",
  "tenancyPeriod",
  // Always set from the lease or offer (the move-in date falls back to the start date), so a null is a bug.
  "moveInOn",
]);

/**
 * Keys whose absence is a real answer on the lease, printed as a neutral word chosen by code: no rent-free
 * period is "0" days (the record holds 0, never null), no reservation fee on the application is "None".
 */
export const NEUTRAL_WHEN_ABSENT: Readonly<Record<string, string>> = { rentFreeDays: "0", reservationFils: "None" };

/** What an empty blank prints: its own marker when it has one, else a plain line. */
const emptyLine = (b: Pick<TemplateBlank, "marker">): string => (b.marker.trim() ? b.marker.trim() : "________");

const blankName = (b: Pick<TemplateBlank, "id" | "label">) => `"${b.label}" (${b.id})`;

/**
 * Why a mapping on a field blank can't be used, or null when it can. A blank left empty (or the legacy
 * "unmapped") is fine: it prints as an empty line. Mappings are chosen by code, so this is a safety net.
 */
export function mappingProblem(b: TemplateBlank): string | null {
  if (b.role !== "field") return null;
  if (b.field === "leave_empty" || b.field === "unmapped") return null;
  const info = sheetKeyInfo(b.field);
  if (!info) return `Blank ${blankName(b)} is mapped to "${b.field}", which is not a data field.`;
  const inferred = inferBlankType(b.label, b.before, b.after);
  if (!compatible(inferred, info.type)) {
    return `Blank ${blankName(b)} is mapped to ${info.label} (${info.type}) but asks for ${inferred}.`;
  }
  return null;
}

/** One heading, paragraph or the title of a template, with what code found in it (rules 1 and 9). */
export interface TemplateParagraph {
  /** `title`, `<sectionId>:h` or `<sectionId>:<index>`: what the review lists confirm. */
  key: string;
  kind: "title" | "heading" | "paragraph";
  text: string;
  /** A number, period, date or amount: the admin must confirm it. */
  values: boolean;
  /** DLD, RERA, Ejari or Dubai-government wording in the body: needs "Neutral reference, not branding". */
  authority: boolean;
  /** Looks like a rent change or notice period: a warning, never a block. */
  warning: string | null;
  /** Personal data or specific values found in the wording (Emirates ID, passport, phone, email, AED amount, date, contract number): can never be fixed wording. */
  fixedValues: string[];
  /** A note about the sample itself ("this sample is modelled on ... fictitious"): not contract wording. */
  sampleOnly: boolean;
}

export { formatCalendarDate, formatMoneyFils };

export const LEGAL_TERMS_WARNING = "Check against the required terms; confirm with legal";
const NUMBER_DAYS =
  /(?:\d+|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty|thirty|forty|sixty|ninety)\b)\W+(?:\(\d+\)\W+)?(?:calendar\s+|business\s+|working\s+)?days?\b/i;

function legalWarning(text: string): string | null {
  const rentChange = /\brent\b/i.test(text) && /\b(?:increas|rais|chang)\w*/i.test(text);
  const noticeDays = /\bnotice\b/i.test(text) && NUMBER_DAYS.test(text);
  return rentChange || noticeDays ? LEGAL_TERMS_WARNING : null;
}

/** Every piece of fixed wording in the template, checked by code. Blank tokens `{{bN}}` are not wording. */
export function templateParagraphs(sections: TemplateSections | undefined): TemplateParagraph[] {
  if (!sections) return [];
  const out: TemplateParagraph[] = [];
  const add = (key: string, kind: TemplateParagraph["kind"], raw: string | null | undefined) => {
    if (!raw) return;
    const text = raw.replace(/\{\{b\d+\}\}/g, " ");
    out.push({
      key,
      kind,
      text: raw,
      values: hasValues(text),
      authority: hasAuthorityMarks(text),
      warning: legalWarning(text),
      fixedValues: fixedValueKinds(text),
      sampleOnly: isSampleOnlyText(text),
    });
  };
  add("title", "title", sections.title);
  for (const s of sections.items) {
    add(`${s.id}:h`, "heading", s.heading);
    s.paragraphs.forEach((p, i) => add(`${s.id}:${i}`, "paragraph", p));
  }
  return out;
}

/** Blank ids still used by wording the admin has not dropped (`undefined` when there are no sections to ask). */
export function liveBlankIds(
  sections: TemplateSections | undefined,
  dropped: ReadonlySet<string>,
): Set<string> | undefined {
  if (!sections) return undefined;
  const ids = new Set<string>();
  const scan = (text: string | null | undefined) => {
    for (const m of (text ?? "").matchAll(/\{\{(b\d+)\}\}/g)) ids.add(m[1]!);
  };
  scan(sections.title);
  for (const s of sections.items) {
    scan(s.heading);
    s.paragraphs.forEach((p, i) => {
      if (!dropped.has(`${s.id}:${i}`)) scan(p);
    });
  }
  return ids;
}

/** Non-blocking notes for the review screen. */
export function approvalWarnings(t: { sections?: TemplateSections }): string[] {
  return templateParagraphs(t.sections)
    .filter((p) => p.warning)
    .map((p) => `${LEGAL_TERMS_WARNING}: "${p.text.slice(0, 80)}"`);
}

/**
 * Reasons a template can't be approved yet (empty means it can). Every field blank must be mapped
 * to a field of a matching type; a sample with DLD or Ejari marks in its header, footer or logo area
 * must have those parts dropped; a kept logo must be confirmed as the company's own.
 */
export function approvalProblems(
  t: { blanks: TemplateBlank[]; style: TemplateStyle; logoDocumentId: string | null; sections?: TemplateSections },
  review: TemplateReview,
): string[] {
  const out: string[] = [];
  const dropped = new Set(review.droppedParagraphs);
  const live = liveBlankIds(t.sections, dropped);
  for (const b of t.blanks) {
    if (live && !live.has(b.id)) continue;
    const p = mappingProblem(b);
    if (p) out.push(p);
  }
  const hasLogo = t.logoDocumentId !== null;
  // The PDF fonts are the standard ones: text they can't encode would print as "?".
  const texts = [
    t.sections?.title,
    ...(t.sections?.items.flatMap((i) => [i.heading, ...i.paragraphs]) ?? []),
    t.style.header,
    t.style.footer,
  ];
  if (texts.some((x) => x && unprintable(x))) {
    out.push(
      "This template has text the PDF fonts can't print (for example Arabic). Upload an English version or contact support.",
    );
  }
  if (t.style.flags.authorityMarks && t.style.flags.areas.length === 0 && !review.authorityChecked) {
    out.push(
      "Authority marks were found in the sample but not where. Tick that you checked the contract wording for them.",
    );
  }
  if (t.style.flags.authorityMarks) {
    const areas = new Set(t.style.flags.areas);
    if (areas.has("header") && !review.dropHeader) {
      out.push("The sample's header carries DLD or Ejari marks. Drop the header to approve.");
    }
    if (areas.has("footer") && !review.dropFooter) {
      out.push("The sample's footer carries DLD or Ejari marks. Drop the footer to approve.");
    }
    if (areas.has("logo_area") && hasLogo && !review.dropLogo) {
      out.push("The sample's logo area carries DLD or Ejari marks. Drop the logo to approve.");
    }
  }
  for (const [text, dropped, where] of [
    [t.style.header, review.dropHeader, "header"],
    [t.style.footer, review.dropFooter, "footer"],
  ] as const) {
    if (text && !dropped && hasAuthorityMarks(text) && !out.some((o) => o.includes(`sample's ${where}`))) {
      out.push(`The sample's ${where} carries DLD or Ejari marks. Drop the ${where} to approve.`);
    }
  }
  for (const [text, droppedPart, where] of [
    [t.style.header, review.dropHeader, "header"],
    [t.style.footer, review.dropFooter, "footer"],
  ] as const) {
    const kinds = text && !droppedPart ? fixedValueKinds(text) : [];
    if (kinds.length) {
      out.push(`The sample's ${where} contains ${kinds.join(", ")} from the sample. Drop the ${where} to approve.`);
    }
  }
  const valuesOk = new Set(review.valuesConfirmed);
  const authorityOk = new Set(review.authorityBodyConfirmed);
  for (const p of templateParagraphs(t.sections)) {
    if (dropped.has(p.key) && p.kind === "paragraph") continue;
    const quote = `"${p.text.slice(0, 60)}${p.text.length > 60 ? "..." : ""}"`;
    if (p.fixedValues.length) {
      out.push(
        `${quote} contains ${p.fixedValues.join(", ")} taken from the sample. It can't be fixed wording: it has to be a blank${p.kind === "paragraph" ? " (or drop this line)" : ""}.`,
      );
      continue;
    }
    if (p.sampleOnly) {
      out.push(`${quote} is a note about the sample itself, not contract wording. Drop this line.`);
      continue;
    }
    if (p.values && !valuesOk.has(p.key)) {
      out.push(`Confirm the numbers, periods, dates or amounts in ${quote}.`);
    }
    if (p.authority && !authorityOk.has(p.key)) {
      out.push(`Confirm that the DLD, RERA or Ejari wording in ${quote} is a neutral reference, not branding.`);
    }
  }
  if (hasLogo && !review.dropLogo && !review.logoConfirmed) {
    out.push("Confirm that the logo is the company's own (not DLD or a government mark), or drop it.");
  }
  return out;
}

/**
 * The look actually used: dropped parts removed. A sample with authority marks never gives an
 * accent colour (the neutral one is used), and a dropped logo is gone.
 */
export function effectiveStyle(
  style: TemplateStyle,
  review: TemplateReview,
  logoDocumentId: string | null,
): { style: TemplateStyle; logoDocumentId: string | null } {
  return {
    style: {
      ...style,
      header: review.dropHeader ? null : style.header,
      footer: review.dropFooter ? null : style.footer,
      accentColour: style.flags.authorityMarks ? null : style.accentColour,
    },
    logoDocumentId: review.dropLogo ? null : logoDocumentId,
  };
}

/** Characters the standard PDF fonts (WinAnsi) can't draw: the PDF renderer would print "?" for them. */
export function unprintable(s: string): boolean {
  return /[^\x20-\x7e\xa0-\xff\n]/.test(
    s
      .replace(/[\u2212\u2013\u2014]/g, "-")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/\s/g, " "),
  );
}

/** A data-sheet value as written in a blank, or null when it has none (or the key is unknown). */
export function formatField(name: string, values: Record<string, unknown>): string | null {
  const v = values[name] as string | number | null | undefined;
  const info = sheetKeyInfo(name);
  if (!info || v === null || v === undefined || v === "") return null;
  const type: FieldType = info.type;
  switch (type) {
    case "money_fils":
      return typeof v === "number" ? formatMoneyFils(v) : null;
    case "date":
      return typeof v === "string" ? formatCalendarDate(v) : null;
    case "int":
      return typeof v === "number" ? String(v) : null;
    case "enum": {
      const w = String(v);
      return w.charAt(0).toUpperCase() + w.slice(1);
    }
    default:
      return String(v);
  }
}

const toRoman = (n: number): string => {
  const t: [number, string][] = [
    [100, "C"],
    [90, "XC"],
    [50, "L"],
    [40, "XL"],
    [10, "X"],
    [9, "IX"],
    [5, "V"],
    [4, "IV"],
    [1, "I"],
  ];
  let r = "";
  for (const [v, sym] of t) {
    while (n >= v) {
      r += sym;
      n -= v;
    }
  }
  return r;
};

/** The number the next section takes, in the template's own numbering style (null for "none"). */
export function nextSectionNumber(style: NumberingStyle, lastNumber: string | null, count: number): string | null {
  const n = count + 1;
  switch (style) {
    case "none":
      return null;
    case "article":
      return `Article ${lastNumber && /[IVXLC]+$/.test(lastNumber) ? toRoman(n) : n}`;
    case "clause":
      return `${lastNumber?.toLowerCase().startsWith("section") ? "Section" : "Clause"} ${n}`;
    case "roman":
      return `${toRoman(n)}.`;
    case "alpha":
      return `${String.fromCharCode(64 + Math.min(n, 26))}.`;
    default:
      return `${n}.`;
  }
}

export const LAW_SECTION_HEADING = "Additional terms required by law";

export interface TemplateRenderInput {
  sections: TemplateSections;
  blanks: TemplateBlank[];
  /** The template's own version number, shown as "Company template v<N>". */
  templateVersion: number;
  /** Paragraph keys the admin dropped: not printed. */
  dropped?: readonly string[];
}

export interface TemplateRenderOptions {
  version: number;
  reference: string;
  demo: boolean;
  /** Values of the generated data-sheet keys beyond the contract fields (`sheetExtras`). */
  extras?: Record<string, string | number | null>;
  /** A preview with sample values: marked as such in the text (the PDF also gets a watermark). */
  preview?: boolean;
}

const TOKEN = /(\{\{b\d+\}\})/;

/**
 * The contract in the company's sections and wording. A blank is replaced only by the contract
 * field it is mapped to, formatted here; any blank that can't be filled is reported together and
 * nothing is rendered. Signature blanks become signature lines. Terms the product requires that
 * the template lacks are appended, then the addendum clauses.
 */
export function templateContractBlocks(
  t: TemplateRenderInput,
  fields: ContractFields,
  addendum: Addendum,
  o: TemplateRenderOptions,
): { title: string; blocks: TemplateBlock[]; leftEmpty: string[]; filled: { label: string; key: string }[] } {
  const problems: string[] = [];
  // Record values by key: the contract fields, then the extras copied from the other records.
  const values: Record<string, unknown> = { ...o.extras, ...fields };
  const byId = new Map(t.blanks.map((b) => [b.id, b]));
  const dropped = new Set(t.dropped ?? []);
  /** Labels of blanks printed as empty lines (to be filled by hand); shown to the approver. */
  const leftEmpty = new Set<string>();
  const report = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };

  /** Blanks filled from a data-sheet key: `label` and the key it was copied from (shown to the approver). */
  const filled: { label: string; key: string }[] = [];
  const empty = (b: TemplateBlank): string => {
    leftEmpty.add(b.label);
    return emptyLine(b);
  };
  const valueOf = (b: TemplateBlank): string => {
    // Nothing chosen, or a choice that can't be used (unknown key, wrong type): an empty line, never a guess.
    if (b.field === "leave_empty" || b.field === "unmapped" || mappingProblem(b)) return empty(b);
    const info = sheetKeyInfo(b.field)!;
    // A preview shows where each field lands: a marked placeholder, never a realistic value.
    if (o.preview) return `\u00ab${info.label}${info.type === "money_fils" ? " (AED)" : ""}\u00bb`;
    const v = formatField(b.field, values);
    if (v !== null && unprintable(v)) {
      report(
        `Value for ${info.label} (blank ${blankName(b)}) can't be printed: the PDF fonts don't cover its characters.`,
      );
      return "";
    }
    if (v === null) {
      const neutral = NEUTRAL_WHEN_ABSENT[b.field];
      if (neutral !== undefined) {
        if (!filled.some((f) => f.label === b.label && f.key === b.field))
          filled.push({ label: b.label, key: b.field });
        return neutral;
      }
      if (CORE_FIELDS.has(b.field)) {
        report(`No value for ${info.label} (blank ${blankName(b)}).`);
        return "";
      }
      return empty(b);
    }
    if (!filled.some((f) => f.label === b.label && f.key === b.field)) filled.push({ label: b.label, key: b.field });
    return v;
  };
  const known = (id: string): TemplateBlank | null => {
    const b = byId.get(id);
    if (!b) report(`The template refers to blank ${id}, which it does not define.`);
    return b ?? null;
  };
  /** Text with its field blanks filled; a signature blank inside inline text (a heading) is dropped. */
  const inline = (text: string): string =>
    text
      .split(TOKEN)
      .map((part) => {
        const m = /^\{\{(b\d+)\}\}$/.exec(part);
        if (!m) return part;
        const b = known(m[1]!);
        return b && b.role === "field" ? valueOf(b) : "";
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
  /** A paragraph: signature blanks end it as signature lines labelled by the words before them. */
  const paragraph = (text: string): TemplateBlock[] => {
    const out: TemplateBlock[] = [];
    let cur = "";
    for (const part of text.split(TOKEN)) {
      const m = /^\{\{(b\d+)\}\}$/.exec(part);
      if (!m) {
        cur += part;
        continue;
      }
      const b = known(m[1]!);
      if (!b) continue;
      if (b.role === "signature") {
        const label = cur.replace(/[\s:_.-]+$/, "").trim();
        out.push({ kind: "sigline", label: label || b.label });
        cur = "";
      } else cur += valueOf(b);
    }
    const rest = cur.replace(/\s+/g, " ").trim();
    if (rest) out.push({ kind: "para", text: rest });
    return out;
  };

  const blocks: TemplateBlock[] = [];
  const title = t.sections.title ? inline(t.sections.title) : "Tenancy contract";
  blocks.push({ kind: "title", text: title });
  const seen: string[] = [];
  let numbered = 0;
  let lastNumber: string | null = null;
  for (const s of t.sections.items) {
    if (s.heading !== null) {
      const heading = inline(s.heading);
      blocks.push({ kind: "heading", text: s.number ? `${s.number} ${heading}` : heading });
      seen.push(heading);
      if (s.number) {
        numbered++;
        lastNumber = s.number;
      }
    }
    for (const [pi, p] of s.paragraphs.entries()) {
      if (dropped.has(`${s.id}:${pi}`)) continue;
      for (const b of paragraph(p)) {
        blocks.push(b);
        if (b.kind === "para") seen.push(b.text);
      }
    }
  }

  // Company clauses and parties' free text, as in the standard contract.
  for (const b of addendumBlocks(addendum)) {
    if (b.kind === "heading" || b.kind === "para" || b.kind === "list" || b.kind === "small") blocks.push(b);
  }

  // What the product requires. No keyword guessing: each term is appended unless its exact standard sentence is
  // already in the template wording (compared in lower case with whitespace collapsed).
  const norm = (x: string) => x.toLowerCase().replace(/\s+/g, " ").trim();
  const haystack = norm(seen.join(" "));
  const missing = (term: string) => !haystack.includes(norm(term));
  const needRent = missing(REQUIRED_TERMS.rentChange);
  const needEjari = missing(REQUIRED_TERMS.ejari);
  const needSigning = missing(REQUIRED_TERMS.signatures);
  const needSignLines = t.blanks.filter((b) => b.role === "signature").length < 2;
  if (needRent || needEjari || needSigning || needSignLines) {
    const n = nextSectionNumber(t.sections.numbering, lastNumber, numbered);
    blocks.push({ kind: "heading", text: n ? `${n} ${LAW_SECTION_HEADING}` : LAW_SECTION_HEADING });
    if (needRent) blocks.push({ kind: "para", text: REQUIRED_TERMS.rentChange });
    if (needEjari) blocks.push({ kind: "para", text: REQUIRED_TERMS.ejari });
    if (needSigning) blocks.push({ kind: "para", text: REQUIRED_TERMS.signatures });
    if (needSignLines) {
      blocks.push({ kind: "sigline", label: o.preview ? "Landlord" : `Landlord: ${fields.landlordNameEn}` });
      blocks.push({ kind: "sigline", label: o.preview ? "Tenant" : `Tenant: ${fields.tenantNameEn}` });
    }
  }

  const ref = `Contract reference ${o.reference}, version ${o.version}. Company template v${t.templateVersion}.`;
  blocks.push({
    kind: "small",
    text: o.preview
      ? `${ref} Preview: placeholders, not a contract.`
      : o.demo
        ? `${ref} Demo contract: all people and numbers in the demo are fictional.`
        : ref,
  });
  if (problems.length) throw new TemplateRenderError(problems);
  return { title: `Tenancy contract ${fields.leaseRef} (v${o.version})`, blocks, leftEmpty: [...leftEmpty], filled };
}

/** Demo values for the "Preview contract" button (fictional; never stored on a contract). */
export const SAMPLE_CONTRACT_FIELDS: ContractFields = {
  leaseRef: "PREVIEW-0001",
  tenantKind: "individual",
  tenantNameEn: "Sample Tenant",
  tenantNationality: "Sampleland",
  tenantEmiratesIdNo: "000-0000-0000000-0",
  tenantIdExpiresOn: calendarDate("2030-01-31"),
  tenantPassportNo: "X0000000",
  tenantPassportExpiresOn: calendarDate("2031-02-28"),
  tenantVisaNo: "000/0000/0000000",
  tenantTradeLicenceNo: "TL-000000",
  tenantEmail: "tenant@example.test",
  tenantPhone: "+971 50 000 0000",
  landlordNameEn: "Sample Landlord LLC",
  landlordIdNo: "LL-000000",
  landlordEmail: "landlord@example.test",
  landlordNationality: "Sampleland",
  landlordPhone: "+971 50 000 0001",
  propertyUsage: "residential",
  building: "Sample Tower",
  community: "Sample Marina",
  dldPropertyNo: "0000-0000",
  unitNo: "1204",
  makaniNo: "00000 00000",
  plotNo: "000",
  bedrooms: 2,
  startOn: calendarDate("2027-01-01"),
  endOn: calendarDate("2027-12-31"),
  annualRentFils: 8_500_000,
  cheques: 4,
  depositFils: 425_000,
  rentFreeDays: 0,
  moveInOn: calendarDate("2027-01-01"),
  contractOn: calendarDate("2026-12-15"),
};
