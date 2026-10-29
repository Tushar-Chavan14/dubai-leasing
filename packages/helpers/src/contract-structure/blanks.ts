import { sheetKeyInfo } from "./datasheet.ts";
import type { FieldType } from "./fields.ts";
import type { TemplateBlank } from "./schema.ts";

export type BlankKind = TemplateBlank["kind"];

export interface RawBlank {
  /** `b1`, `b2`, … in reading order. */
  id: string;
  kind: BlankKind;
  marker: string;
  /** Index into the lines of the text. */
  line: number;
  before: string;
  after: string;
}

/** Underscore runs, dot runs (or ellipsis characters), and empty bracket markers: `[ ]`, `[____]`, `<< >>`, `{ }`. */
const MARKERS = /(_{4,})|(\.{4,}|…{2,})|(\[[\s_.]*\]|<<[\s_.]*>>|\{[\s_.]*\})/g;
/** A table-of-contents leader: dots then a page number at the end of the line. */
const TOC_LEADER = /^\s*\S.*\.{4,}\s*\d+\s*$/;
const LABEL_LINE = /^\s*([^:\n]{2,60}):\s*$/;
const KNOWN_WORDS = new Set([
  "name",
  "nationality",
  "email",
  "mail",
  "phone",
  "mobile",
  "tel",
  "telephone",
  "address",
  "building",
  "community",
  "area",
  "unit",
  "flat",
  "plot",
  "makani",
  "licence",
  "license",
  "passport",
  "emirates",
  "visa",
  "rent",
  "deposit",
  "cheques",
  "cheque",
  "bedrooms",
  "date",
  "commencement",
  "expiry",
  "reference",
  "tenant",
  "landlord",
  "lessor",
  "lessee",
  "property",
  "usage",
  "start",
  "end",
  "period",
  "premises",
]);
const SIGNATURE = /\b(signature|signed|sign here|signatory|witness|stamp|initials?)\b|توقيع|ختم/i;

/** A "Label:" line counts only when the label is short and uses a word of the contract fields. */
const isKnownLabel = (label: string): boolean => {
  const words = label
    .toLowerCase()
    .split(/[^a-z؀-ۿ]+/)
    .filter(Boolean);
  return words.length >= 1 && words.length <= 5 && words.some((w) => KNOWN_WORDS.has(w));
};

const tail = (s: string, n: number) => (s.length > n ? s.slice(s.length - n) : s);

/**
 * Finds the blanks of a text by code (the model never decides what is a blank). Returns the lines
 * with each blank replaced by `{{bN}}`, and the blanks in reading order. `{{` and `}}` already in
 * the source are spaced apart first so a token can't be forged.
 */
export function detectBlanks(text: string, max = 400): { lines: string[]; blanks: RawBlank[]; truncated: boolean } {
  const src = text.replaceAll("{{", "{ {").replaceAll("}}", "} }").split("\n");
  const blanks: RawBlank[] = [];
  const lines: string[] = [];
  let truncated = false;
  const prevText = (i: number): string => {
    for (let j = i - 1; j >= 0 && j >= i - 3; j--) if (src[j]!.trim()) return src[j]!.trim();
    return "";
  };
  for (let i = 0; i < src.length; i++) {
    const line = src[i]!;
    const found: { start: number; end: number; kind: BlankKind; marker: string }[] = [];
    if (!TOC_LEADER.test(line)) {
      for (const m of line.matchAll(MARKERS)) {
        found.push({
          start: m.index,
          end: m.index + m[0].length,
          kind: m[1] ? "underscore" : m[2] ? "dots" : "bracket",
          marker: m[0],
        });
      }
    }
    if (!found.length) {
      const lm = LABEL_LINE.exec(line);
      if (lm && isKnownLabel(lm[1]!)) {
        // The next text line must not continue the sentence ("Tenant to pay:" then a list).
        const next = src.slice(i + 1).find((l) => l.trim()) ?? "";
        if (!/^\s*(?:[-•*(]|\d+[.)]|[a-z]\s*[.)]|[a-z])/.test(next)) {
          found.push({ start: line.trimEnd().length, end: line.trimEnd().length, kind: "label", marker: "" });
        }
      }
    }
    let out = line;
    const made: RawBlank[] = [];
    for (const f of found) {
      if (blanks.length + made.length >= max) {
        truncated = true;
        break;
      }
      const prior = line.slice(0, f.start).trim();
      const before = tail(prior.length < 3 ? `${prevText(i)} ${prior}`.trim() : prior, 120);
      made.push({
        id: `b${blanks.length + made.length + 1}`,
        kind: f.kind,
        marker: f.marker,
        line: i,
        before,
        after: line.slice(f.end).trim().slice(0, 60),
      });
    }
    // Replace right to left so earlier offsets stay valid.
    for (let k = made.length - 1; k >= 0; k--) {
      const f = found[k]!;
      out = `${out.slice(0, f.start)}${f.kind === "label" ? " " : ""}{{${made[k]!.id}}}${out.slice(f.end)}`;
    }
    blanks.push(...made);
    lines.push(out);
  }
  return { ...mergeSplitBlanks(lines, blanks), truncated };
}

/** "__ / __ / ____" (a date written in three parts) is one blank: the first token stays, the others go. */
function mergeSplitBlanks(lines: string[], blanks: RawBlank[]): { lines: string[]; blanks: RawBlank[] } {
  const drop = new Set<string>();
  const merged = lines.map((l) =>
    l.replace(/\{\{(b\d+)\}\}(?:\s*[/.-]\s*\{\{(b\d+)\}\})+/g, (all, first: string) => {
      for (const m of all.matchAll(/\{\{(b\d+)\}\}/g)) if (m[1] !== first) drop.add(m[1]!);
      return `{{${first}}}`;
    }),
  );
  return { lines: merged, blanks: blanks.filter((b) => !drop.has(b.id)) };
}

/** A short label guessed by code from the words before the blank. */
export function guessLabel(b: Pick<RawBlank, "before" | "after">): string {
  const cleaned = b.before
    .replace(/\{\{b\d+\}\}/g, " ")
    .replace(/[:\-–—(\s]+$/g, "")
    .trim();
  const sentence = cleaned.split(/[.;]\s+/).pop() ?? "";
  const words = sentence.split(/\s+/).filter(Boolean).slice(-6).join(" ");
  return (words || b.after.split(/\s+/).slice(0, 3).join(" ") || "Blank").slice(0, 80);
}

export const isSignatureBlank = (b: Pick<RawBlank, "before" | "after">, label: string): boolean =>
  SIGNATURE.test(`${label} ${b.before.slice(-60)} ${b.after.slice(0, 20)}`);

/**
 * What kind of value a blank asks for, from the words around it (code, not the model). `null`
 * means the words don't say. Order matters: counts first ("rent-free days"), then an explicit
 * currency, then dates, then money words, then plain text hints.
 */
export function inferBlankType(label: string, before: string, after: string): FieldType | null {
  const near = after.split(/[.,;:()]/)[0]!.slice(0, 14);
  const s = `${label} ${tail(before.replace(/\{\{b\d+\}\}/g, " "), 40)} ${near}`.toLowerCase();
  if (/\b(days?|cheques?|checks?|instal+ments?|bedrooms?|beds?|number of|no\. of)\b/.test(s)) return "int";
  if (/\b(aed|dirhams?|dhs?)\b|د\.إ|درهم/.test(s)) return "money_fils";
  if (
    /\b(date|dated|commenc\w*|expir\w*|valid until|starts?|starting|ends?|ending|from|until|move[- ]?in|dd\/mm)\b/.test(
      s,
    )
  )
    return "date";
  if (/\b(rent|rental|deposit|amount|fees?|price|security)\b/.test(s)) return "money_fils";
  if (
    /\b(name|nationality|e-?mail|phone|mobile|tel|address|building|community|area|unit|plot|makani|licen[cs]e|passport|emirates|visa|number|no\.?|ref|reference|usage|type)\b/.test(
      s,
    )
  )
    return "text";
  return null;
}

/** Whether a field's type can be written into a blank of the inferred type. */
export const compatible = (inferred: FieldType | null, field: FieldType): boolean => {
  if (inferred === null) return true;
  if (inferred === "text") return field === "text" || field === "enum";
  return inferred === field;
};

export interface Mapping {
  field: string;
  fieldType: FieldType | null;
  note?: string;
}

/**
 * Checks a proposed field against the catalogue and the blank's inferred type. Anything invalid
 * (unknown name, "none", wrong type) becomes `unmapped`; an unmapped blank blocks approval. `leave_empty` is a valid choice.
 */
export function validateMapping(proposed: string | undefined, label: string, b: RawBlank): Mapping {
  const p = (proposed ?? "").trim();
  if (p === "leave_empty") return { field: "leave_empty", fieldType: null };
  if (!p || p === "none" || p === "unmapped") return { field: "unmapped", fieldType: null };
  const info = sheetKeyInfo(p);
  if (!info) return { field: "unmapped", fieldType: null, note: "Proposed field is not a data field." };
  const type = info.type;
  const inferred = inferBlankType(label, b.before, b.after);
  if (!compatible(inferred, type)) {
    return { field: "unmapped", fieldType: null, note: `Proposed field is ${type}; the blank asks for ${inferred}.` };
  }
  return { field: p, fieldType: type };
}
