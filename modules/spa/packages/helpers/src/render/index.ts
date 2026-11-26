/**
 * `renderSpaAgreement` (C14, S46): prints an approved template version with one deal's data-sheet values, in the
 * template's own sections, numbering, tables, header, footer and logo, with e-sign anchors. Pure code: no model, no
 * database, no storage (the caller passes the logo bytes and `now` from its Clock). Anything that can't be printed
 * with certainty fails closed (`needs_human`, no PDF): a core value missing, a signature line with no role, a party
 * that does not fit the template's slots, an authority mark in the stored look.
 */
import { PdfLogoError, renderStyledPdfWithAnchors, type PdfLogo, type SignatureAnchor } from "@platform/adapters";
import {
  blankName,
  emptyLine,
  fillPlaceholderText,
  mappingProblem,
  type RenderProfile,
  type TemplateBlock,
  unprintable,
} from "@platform/readers/render/blocks";
import { formatCalendarDate, formatMoneyFils } from "@platform/readers/structure/format";
import { hasAuthorityMarks } from "@platform/readers/structure/look";
import type { TemplateBlank, TemplateSections, TemplateStyle } from "@platform/readers/structure/schema";
import { type DealType, type SheetKeyInfo, spaDataSheet, type SpaSheetKey } from "@spa/core";
import {
  MAX_INSTALMENT,
  partyNamedIn,
  signatureRoles,
  signatureSlots,
  slotMarks,
  splitSlotKey,
  spaTemplateProfile,
} from "../template/index.ts";
import { moneyInWords } from "./words.ts";

export { moneyInWords, wholeInWords } from "./words.ts";

export type SpaValue = string | number | null | undefined;
/** Values by data-sheet key. Money is integer fils, dates are `YYYY-MM-DD` calendar dates, shares are basis points. */
export type SpaValues = Record<string, SpaValue>;

/** One instalment of the deal's payment plan. */
export interface PlanRow {
  number: number;
  label: string;
  dueOn: string | null;
  milestone: string | null;
  amountFils: number;
}
/** One line of the settlement statement, in statement order. */
export interface SettlementRow {
  label: string;
  payer: string;
  payee: string;
  amountFils: number;
}

export interface SpaRenderTemplate {
  sections: TemplateSections;
  blanks: TemplateBlank[];
  style: TemplateStyle;
  /** The template's own version number. */
  version: number;
  /** Logo bytes from the caller (the renderer never reads storage). */
  logo?: PdfLogo | null;
}

export interface SpaRenderInput {
  template: SpaRenderTemplate;
  dealType: DealType;
  /** Shown in the PDF's document properties only. */
  reference: string;
  /** Per party, by plain key (`purchaser_name`, `purchaser_licence_no`, ...). Order is the slot order. */
  purchasers: readonly SpaValues[];
  sellers: readonly SpaValues[];
  /** Everything else, by key: broker, unit, money, dates, resale and other keys. `price_words` is written by code. */
  values: SpaValues;
  plan?: readonly PlanRow[];
  settlement?: readonly SettlementRow[];
  /** From the caller's Clock: the PDF's creation and modification dates, so the same deal gives the same bytes. */
  now: Date;
}

export type SpaBlocksResult =
  | { ok: true; title: string; blocks: TemplateBlock[]; header: string | null; footer: string | null }
  | { ok: false; status: "needs_human"; problems: string[] };
export type SpaRenderResult =
  | { ok: true; bytes: Uint8Array; anchors: SignatureAnchor[]; blocks: TemplateBlock[]; title: string }
  | { ok: false; status: "needs_human"; problems: string[] };

// ---- values -------------------------------------------------------------------------------------------------------

const CORE_KEYS: ReadonlySet<string> = new Set(
  Object.entries(spaDataSheet)
    .filter(([, i]) => (i as SheetKeyInfo).core)
    .map(([k]) => k),
);
const INSTALMENT = /^instalment_([1-9]\d?)_(amount|due)$/;

const sheetOf = (key: string): SheetKeyInfo | null =>
  Object.hasOwn(spaDataSheet, key) ? (spaDataSheet[key as SpaSheetKey] as SheetKeyInfo) : null;

const pct = (bps: number): string => `${Number((bps / 100).toFixed(2))}%`;

/** A data-sheet value as written in a blank, or null when it has none or isn't valid. Pure code. */
export function formatSpaValue(key: string, values: Record<string, unknown>): string | null {
  const v = values[key] as SpaValue;
  if (v === null || v === undefined || v === "") return null;
  const inst = INSTALMENT.exec(key);
  const type = inst ? (inst[2] === "amount" ? "money_fils" : "date") : sheetOf(key)?.type;
  switch (type) {
    case "money_fils":
      return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? formatMoneyFils(v) : null;
    case "date":
      return typeof v === "string" ? formatCalendarDate(v) : null;
    case "int":
      return typeof v === "number" && Number.isSafeInteger(v) ? String(v) : null;
    case "bps":
      return typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= 10_000 ? pct(v) : null;
    case "text":
      return typeof v === "string" ? v : null;
    default:
      return null;
  }
}

export const spaRenderProfile: RenderProfile = {
  template: spaTemplateProfile,
  coreKeys: CORE_KEYS,
  neutralWhenAbsent: {},
  formatValue: formatSpaValue,
};

const SIDE: Record<string, string> = {
  buyer: "Buyer",
  seller: "Seller",
  bank_buyer: "Buyer's bank",
  bank_seller: "Seller's bank",
  dld: "DLD",
  trustee: "Trustee",
  broker: "Broker",
  developer: "Developer",
};

/** Plan rows by due date then instalment number (the booking is row 1); a milestone row has no date and goes last. */
export function sortPlan(rows: readonly PlanRow[]): PlanRow[] {
  return [...rows].sort((a, b) => {
    if (a.dueOn && b.dueOn) return a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : a.number - b.number;
    if (a.dueOn) return -1;
    if (b.dueOn) return 1;
    return a.number - b.number;
  });
}

// ---- the render ---------------------------------------------------------------------------------------------------

type Group = "buyer" | "seller";
interface TokenInfo {
  blank: TemplateBlank | null;
  /** The party a token belongs to (plain key or signature role), else null. */
  group: Group | null;
  /** The numbered slot, else null. */
  slot: number | null;
}
const GROUP_ROLE: Record<Group, "purchaser" | "seller"> = { buyer: "purchaser", seller: "seller" };
const TOKEN = /\{\{(b\d+)\}\}/g;
const TOKEN_SPLIT = /(\{\{b\d+\}\})/;
const MAX_LABEL_WORDS = 5;

const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length;
const tokensOf = (text: string): string[] => [...text.matchAll(TOKEN)].map((m) => m[1]!);

export function spaAgreementBlocks(input: SpaRenderInput): SpaBlocksResult {
  const { template, dealType } = input;
  const { sections, blanks, style } = template;
  const problems: string[] = [];
  const report = (p: string) => {
    if (!problems.includes(p)) problems.push(p);
  };
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const counts: Record<Group, number> = { buyer: input.purchasers.length, seller: input.sellers.length };
  const parties: Record<Group, readonly SpaValues[]> = { buyer: input.purchasers, seller: input.sellers };
  const word: Record<Group, string> = { buyer: "purchaser", seller: "seller" };
  const plan = sortPlan(input.plan ?? []);

  // Who must be there at all.
  for (const g of ["buyer", "seller"] as const) if (counts[g] === 0) report(`The deal has no ${word[g]}.`);

  // The look: an authority mark stored with the template is never printed (rule 9).
  if (
    style.flags.authorityMarks ||
    (style.header && hasAuthorityMarks(style.header)) ||
    (style.footer && hasAuthorityMarks(style.footer))
  )
    report("The template's header, footer or logo carries DLD, RERA or other authority marks: it can't be printed.");
  for (const text of [style.header, style.footer]) {
    if (text && unprintable(text)) report("The header or footer has text the PDF fonts can't print.");
  }

  // Every blank used by wording must be a usable mapping.
  for (const b of blanks) {
    const p = mappingProblem(b, spaTemplateProfile);
    if (p) report(p);
  }

  // Token facts.
  const roles = signatureRoles(blanks);
  const sigSlots = signatureSlots(blanks);
  const infoOf = (id: string): TokenInfo => {
    const b = byId.get(id) ?? null;
    if (!b) return { blank: null, group: null, slot: null };
    if (b.role === "signature") {
      const role = roles[b.id];
      const group: Group | null = role === "purchaser" ? "buyer" : role === "seller" ? "seller" : null;
      return { blank: b, group, slot: group ? (sigSlots[b.id] ?? null) : null };
    }
    const { key, slot } = splitSlotKey(b.field);
    const rep = sheetOf(key)?.repeat ?? null;
    return { blank: b, group: rep, slot: rep ? slot : null };
  };

  // Fixed slots: the highest numbered slot the template prints, per party. More parties than that is needs_human.
  const maxSlot: Record<Group, number> = { buyer: 0, seller: 0 };
  for (const b of blanks) {
    const i = infoOf(b.id);
    if (i.group && i.slot) maxSlot[i.group] = Math.max(maxSlot[i.group], i.slot);
  }
  for (const g of ["buyer", "seller"] as const) {
    if (maxSlot[g] > 0 && counts[g] > maxSlot[g]) report(`${counts[g]} ${word[g]}s, template has ${maxSlot[g]} slots.`);
  }
  // A signature line names a party, or the render stops.
  for (const b of blanks) {
    if (b.role === "signature" && roles[b.id] === null)
      report(`Signature line ${blankName(b)} doesn't say whose it is (seller, purchaser or broker).`);
  }

  // Values by party and deal.
  const deal: Record<string, unknown> = { ...input.values };
  const price = input.values.price;
  if (deal.price_words === undefined && typeof price === "number" && Number.isSafeInteger(price) && price >= 0)
    deal.price_words = moneyInWords(price);
  plan.slice(0, MAX_INSTALMENT).forEach((r, i) => {
    deal[`instalment_${i + 1}_amount`] = r.amountFils;
    deal[`instalment_${i + 1}_due`] = r.dueOn;
  });
  const flat: Record<string, unknown> = { ...parties.seller[0], ...parties.buyer[0], ...deal };

  const unusedSlot = (i: TokenInfo): boolean => !!i.group && !!i.slot && i.slot > counts[i.group];

  const valueOf = (i: TokenInfo, idx: Record<Group, number>): string => {
    const b = i.blank!;
    if (b.field === "leave_empty" || b.field === "unmapped" || mappingProblem(b, spaTemplateProfile))
      return emptyLine(b);
    const { key } = splitSlotKey(b.field);
    const label = spaTemplateProfile.sheet.keyInfo(b.field)?.label ?? b.label;
    let record: Record<string, unknown> = deal;
    let who = "";
    if (i.group) {
      const n = i.slot ? i.slot - 1 : idx[i.group];
      if (n >= counts[i.group]) return emptyLine(b);
      record = parties[i.group][n] ?? {};
      who = i.slot || counts[i.group] > 1 ? ` (${word[i.group]} ${n + 1})` : "";
    }
    const raw = record[key] as SpaValue;
    const v = formatSpaValue(key, record);
    if (v === null) {
      const info = sheetOf(key);
      const needed = CORE_KEYS.has(key) || (info?.requiredFor?.includes(dealType) ?? false);
      if (raw !== null && raw !== undefined && raw !== "")
        report(`The value for ${label}${who} (blank ${blankName(b)}) isn't valid.`);
      else if (needed) report(`No value for ${label}${who} (blank ${blankName(b)}).`);
      return needed ? "" : emptyLine(b);
    }
    if (unprintable(v)) {
      report(
        `Value for ${label}${who} (blank ${blankName(b)}) can't be printed: the PDF fonts don't cover its characters.`,
      );
      return "";
    }
    return v;
  };

  const tableOf = (key: string): TemplateBlock | null => {
    if (key === "payment_plan") {
      if (plan.length === 0) return null;
      return {
        kind: "table",
        head: ["No.", "Description", "Due", "Amount"],
        rows: plan.map((r, n) => [
          String(n + 1),
          r.label,
          (r.dueOn ? formatCalendarDate(r.dueOn) : null) ?? r.milestone ?? "",
          formatMoneyFils(r.amountFils),
        ]),
        widths: [1, 4, 3, 3],
      };
    }
    const lines = input.settlement ?? [];
    if (lines.length === 0) return null;
    return {
      kind: "table",
      head: ["Item", "Payer", "Payee", "Amount"],
      rows: lines.map((l) => [
        l.label,
        SIDE[l.payer] ?? l.payer,
        SIDE[l.payee] ?? l.payee,
        formatMoneyFils(l.amountFils),
      ]),
      widths: [4, 2, 2, 3],
    };
  };
  const isTable = (b: TemplateBlank | null) =>
    !!b && b.role === "field" && sheetOf(splitSlotKey(b.field).key)?.type === "table";

  /** Text with its field blanks filled (title and headings): a signature or table blank can't sit in a line like this. */
  const inline = (text: string, idx: Record<Group, number>): string =>
    text
      .split(TOKEN_SPLIT)
      .map((part) => {
        const m = /^\{\{(b\d+)\}\}$/.exec(part);
        if (!m) return part;
        const i = infoOf(m[1]!);
        if (!i.blank) {
          report(`The template refers to blank ${m[1]}, which it does not define.`);
          return "";
        }
        if (i.blank.role !== "field" || isTable(i.blank)) {
          report(`Blank ${blankName(i.blank)} can't sit in a title or heading.`);
          return "";
        }
        if (i.group && counts[i.group] > 1 && !i.slot) {
          report(
            `A ${word[i.group]} value in a title or heading can't be printed for ${counts[i.group]} ${word[i.group]}s.`,
          );
          return "";
        }
        return valueOf(i, idx);
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();

  /** A paragraph: a signature blank ends it as a signature line; a table blank prints the table in its place. */
  const paragraph = (text: string, idx: Record<Group, number>): TemplateBlock[] => {
    const out: TemplateBlock[] = [];
    let cur = "";
    const flush = () => {
      const t = cur.replace(/\s+/g, " ").trim();
      // Punctuation left after a table ("paid as per {payment_plan}.") isn't a paragraph.
      if (t && !(out.at(-1)?.kind === "table" && /^[.,;:)\]]+$/.test(t))) out.push({ kind: "para", text: t });
      cur = "";
    };
    for (const part of text.split(TOKEN_SPLIT)) {
      const m = /^\{\{(b\d+)\}\}$/.exec(part);
      if (!m) {
        cur += part;
        continue;
      }
      const i = infoOf(m[1]!);
      if (!i.blank) {
        report(`The template refers to blank ${m[1]}, which it does not define.`);
        continue;
      }
      if (i.blank.role === "signature") {
        const label = cur.replace(/[\s:_.-]+$/, "").trim() || i.blank.label;
        cur = "";
        const role = roles[i.blank.id] ?? null;
        const slot = i.group ? (i.slot ?? idx[i.group] + 1) : null;
        out.push({ kind: "sigline", label, role, slot });
        continue;
      }
      if (isTable(i.blank)) {
        const key = splitSlotKey(i.blank.field).key;
        const t = tableOf(key);
        if (t) {
          flush();
          out.push(t);
        } else if (key === "payment_plan" && !(sheetOf(key)?.requiredFor?.includes(dealType) ?? false)) {
          cur += emptyLine(i.blank);
        } else if (key === "payment_plan") {
          report(`No value for ${spaTemplateProfile.sheet.keyInfo(key)?.label} (blank ${blankName(i.blank)}).`);
        } else {
          cur += emptyLine(i.blank);
        }
        continue;
      }
      cur += valueOf(i, idx);
    }
    flush();
    return out;
  };

  // Items: each paragraph of each section, with slot clean-up applied.
  interface Row {
    section: number;
    text: string;
    /** The party this paragraph repeats for, if it must. */
    repeat: Group | null;
  }
  const rows: Row[] = [];
  sections.items.forEach((s, si) => {
    for (const raw of s.paragraphs) {
      let text = raw;
      const ids = tokensOf(text);
      const infos = ids.map(infoOf);
      const tailAt = ids.length ? text.lastIndexOf("}}") + 2 : -1;
      const tail = ids.length ? text.slice(tailAt).trim() : "";
      const tailMarks = tail ? slotMarks(tail) : [];
      const tailUnused =
        tailMarks.length > 0 && wordCount(tail) <= MAX_LABEL_WORDS && tailMarks.every((m) => m.n > counts[m.group]);
      if (ids.length === 0) {
        const marks = slotMarks(text);
        if (marks.length > 0 && wordCount(text) <= MAX_LABEL_WORDS && marks.every((m) => m.n > counts[m.group]))
          continue;
      } else if (infos.every((i) => i.blank && unusedSlot(i))) {
        // Only blanks of a slot the deal doesn't use: the block is left out, but a label that follows stays.
        text = tail && !tailUnused ? tail : "";
        if (!text) continue;
      } else if (tailUnused) {
        text = text.slice(0, tailAt).trimEnd();
      }
      const groups = new Set(
        tokensOf(text)
          .map(infoOf)
          .filter((i) => i.group && !i.slot)
          .map((i) => i.group!),
      );
      const repeating = [...groups].filter((g) => counts[g] > 1);
      if (repeating.length > 1 || (repeating.length === 1 && groups.size > 1)) {
        report(
          `A paragraph mixes values of more than one party that appears more than once, so it can't be repeated: "${text.replace(TOKEN, "…").slice(0, 60)}".`,
        );
        continue;
      }
      rows.push({ section: si, text, repeat: repeating[0] ?? null });
    }
  });

  // Runs: consecutive repeating paragraphs of one party print once per party, with the label that leads them.
  const blocks: TemplateBlock[] = [];
  const title = sections.title ? inline(sections.title, { buyer: 0, seller: 0 }) : "Agreement";
  blocks.push({ kind: "title", text: title });
  const out: Record<number, TemplateBlock[]> = {};
  const idx0: Record<Group, number> = { buyer: 0, seller: 0 };
  // `out[n]` is the blocks of paragraph row n; a run's repeats are placed on its first row.
  const printed = new Set<number>();
  rows.forEach((row, n) => {
    if (printed.has(n)) return;
    if (!row.repeat) {
      out[n] = paragraph(row.text, idx0);
      return;
    }
    const g = row.repeat;
    let end = n;
    while (rows[end + 1] && rows[end + 1]!.repeat === g && rows[end + 1]!.section === row.section) end++;
    const run = rows.slice(n, end + 1);
    // The label that leads the run: its own label-only paragraph, or the tail of the paragraph before it.
    let label: string | null = null;
    const prevN = n - 1;
    const prev = rows[prevN];
    if (prev && prev.section === row.section && !printed.has(prevN)) {
      if (
        tokensOf(prev.text).length === 0 &&
        partyNamedIn(prev.text) === GROUP_ROLE[g] &&
        wordCount(prev.text) <= MAX_LABEL_WORDS
      ) {
        label = prev.text;
        delete out[prevN];
      } else if (tokensOf(prev.text).length > 0) {
        const at = prev.text.lastIndexOf("}}") + 2;
        const t = prev.text.slice(at).trim();
        if (t && !/\d/.test(t) && partyNamedIn(t) === GROUP_ROLE[g] && wordCount(t) <= MAX_LABEL_WORDS) {
          label = t;
          out[prevN] = paragraph(prev.text.slice(0, at), idx0);
        }
      }
    }
    const chunk: TemplateBlock[] = [];
    for (let i = 0; i < counts[g]; i++) {
      if (label) chunk.push({ kind: "para", text: label });
      for (const r of run) chunk.push(...paragraph(r.text, { ...idx0, [g]: i }));
    }
    out[n] = chunk;
    for (let k = n; k <= end; k++) printed.add(k);
    // Following rows of the run print nothing of their own.
    for (let k = n + 1; k <= end; k++) out[k] = [];
  });

  // Headings and paragraphs in the template's own order.
  let rowAt = 0;
  sections.items.forEach((s, si) => {
    if (s.heading !== null) {
      const heading = inline(s.heading, idx0);
      blocks.push({ kind: "heading", text: s.number ? `${s.number} ${heading}` : heading });
    }
    while (rowAt < rows.length && rows[rowAt]!.section === si) blocks.push(...(out[rowAt++] ?? []));
  });

  const header = style.header ? fillPlaceholderText(style.header, flat, spaRenderProfile) : null;
  const footer = style.footer ? fillPlaceholderText(style.footer, flat, spaRenderProfile) : null;
  if (problems.length) return { ok: false, status: "needs_human", problems };
  return { ok: true, title, blocks, header, footer };
}

/** The agreement as a PDF with one anchor per signature line, or `needs_human` and the list of what to fix. */
export async function renderSpaAgreement(input: SpaRenderInput): Promise<SpaRenderResult> {
  const built = spaAgreementBlocks(input);
  if (!built.ok) return built;
  const { style, logo } = input.template;
  try {
    const { bytes, anchors } = await renderStyledPdfWithAnchors(
      { title: `${built.title} ${input.reference}`, subject: "Sale and purchase agreement" },
      built.blocks,
      {
        page: style.page,
        margins: style.margins,
        font: { regular: style.font.regular, bold: style.font.bold },
        sizes: style.sizes,
        headingBold: style.headingBold,
        accentColour: style.accentColour,
        header: built.header,
        footer: built.footer,
      },
      { logo: logo ?? null, now: input.now },
    );
    return { ok: true, bytes, anchors, blocks: built.blocks, title: built.title };
  } catch (e) {
    if (e instanceof PdfLogoError) return { ok: false, status: "needs_human", problems: [e.message] };
    throw e;
  }
}
