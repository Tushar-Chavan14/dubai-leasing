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
/**
 * D74: a named placeholder, `{name}`, `[name]` or `<name>`: 2 to 40 characters of letters, digits, space and `_ - / .`,
 * starting with a letter. Never an internal token (`{{b1}}`, which was spaced to `{ {b1} }` above), `<<...>>` or
 * `[[...]]`, and never a page marker (`{n}`, `{N}`, `{page}`, `{pages}`).
 */
const PH_NAME = String.raw`[A-Za-z][A-Za-z0-9 _\-/.]{1,39}`;
const PLACEHOLDER = new RegExp(
  String.raw`(?<!\{ ?)\{(${PH_NAME})\}(?! ?\})|(?<!\[)\[(${PH_NAME})\](?!\])|(?<!<)<(${PH_NAME})>(?!>)`,
  "g",
);
const PAGE_MARKER = /^(?:n|page|pages)$/i;
/** The name inside a placeholder as written (`{tenant name}` gives `tenant name`), or null when the text is not one. */
export function placeholderName(marker: string): string | null {
  const m = /^\{([^{}]+)\}$|^\[([^[\]]+)\]$|^<([^<>]+)>$/.exec(marker.trim());
  const name = (m?.[1] ?? m?.[2] ?? m?.[3])?.trim();
  return name && /^[A-Za-z][A-Za-z0-9 _\-/.]{1,39}$/.test(name) && !PAGE_MARKER.test(name) ? name : null;
}
/** A readable label for a placeholder's name ("property_community" gives "Property community"). */
export function placeholderLabel(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

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
  const src = joinSplitPlaceholders(text.replaceAll("{{", "{ {").replaceAll("}}", "} }").split("\n"));
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
      for (const m of line.matchAll(PLACEHOLDER)) {
        if (PAGE_MARKER.test((m[1] ?? m[2] ?? m[3] ?? "").trim())) continue;
        found.push({ start: m.index, end: m.index + m[0].length, kind: "placeholder", marker: m[0] });
      }
      found.sort((a, b) => a.start - b.start);
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

const CLOSERS: Record<string, string> = { "{": "}", "[": "]", "<": ">" };

/**
 * D74: a placeholder that a line break (or a page break with its repeated header and footer already removed) cut in two
 * ("{registering" ... "authority}") is put back on the first line. Line numbers stay: the rest of the second line stays
 * where it was.
 */
function joinSplitPlaceholders(src: string[]): string[] {
  const out = [...src];
  for (let i = 0; i < out.length; i++) {
    const open = /([{[<])[A-Za-z][A-Za-z0-9 _\-/.]{0,38}$/.exec(out[i]!);
    if (!open) continue;
    let j = i + 1;
    while (j < out.length && j <= i + 6 && !out[j]!.trim()) j++;
    const next = out[j];
    if (next === undefined) continue;
    const m = /^\s*([A-Za-z0-9 _\-/.]{1,38}?)([}\]>])/.exec(next);
    if (!m || m[2] !== CLOSERS[open[1]!]) continue;
    out[i] = `${out[i]!.trimEnd()} ${m[1]!.trim()}${m[2]}`;
    out[j] = next.slice(m[0].length);
  }
  return out;
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
  // Who pays, and the list of other fees: text, whatever the money words around them say.
  if (/\b(paid by|payable by|borne by|payer)\b|\b(other|additional|extra) fees?\b|\bfees? (summary|list)\b/.test(s))
    return "text";
  // D70: the blank's own label first: one cheque's date ("Cheque 2 date", "Second cheque date") is a date, whatever
  // the row around it says ("Cheque Dates" before the first blank of a row).
  const own = label.toLowerCase();
  if (
    /\b(cheques?|checks?)\s*(?:no\.?\s*|number\s*|#\s*)?\d{1,2}(?:st|nd|rd|th)?\s*(?:due\s*)?date\b/.test(own) ||
    /\b(?:\d{1,2}(?:st|nd|rd|th)|first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|eleventh|twelfth)\s+(cheques?|checks?)\s*(?:due\s*)?date\b/.test(
      own,
    )
  )
    return "date";
  // Cheque blanks: a date, a list of dates or an amount, not a count (checked before the "cheques" count rule).
  if (/\b(cheques?|checks?)\s*(no\.?\s*|number\s*)?dates\b/.test(s)) return "text";
  if (/\b(cheques?|checks?)\s*(no\.?\s*|number\s*)?date\b|\bdates? of (the )?(\w+ )?(cheques?|checks?)\b/.test(s))
    return "date";
  if (
    /\b(cheques?|checks?)\s*amounts?\b|\bamounts?\s*(per|of each|of every)\s*(cheques?|checks?)\b|\b(each|per)\s*(cheques?|checks?)\b|\b(cheques?|checks?)\s+of\b/.test(
      s,
    )
  )
    return "money_fils";
  // D70: an area in square feet is a number ("Area (sq ft)"), though "area" alone reads as text.
  if (/\b(?:sq\.?\s?f(?:ee)?t|sqft|square\s+f(?:ee|oo)t)\b/.test(s)) return "int";
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
