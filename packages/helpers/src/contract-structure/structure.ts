import { normalizeWs } from "../contract-template/extract.ts";
import type { NumberingStyle, TemplateSection, TemplateSections } from "./schema.ts";
import { MAX_SECTIONS } from "./schema.ts";

const NUMBER_PREFIX =
  /^((?:Article|ARTICLE|Clause|CLAUSE|Section|SECTION)\s+[IVXLC\d]+[.:)]?|\d+(?:\.\d+)*[.)]?|[IVXLC]+[.)]|[A-Z][.)])\s+(\S.*)$/;
const PARA_START = /^(?:\d+(?:\.\d+)+[.)]?\s|\d+[.)]\s|\([a-z0-9ivx]+\)\s|[a-z][.)]\s|[-•*]\s)/;

/** Splits "1.2 Rent" into `["1.2", "Rent"]`; a line with no number prefix gives `[null, line]`. */
export function splitNumber(line: string): [string | null, string] {
  const m = NUMBER_PREFIX.exec(line.trim());
  return m ? [m[1]!, m[2]!] : [null, line.trim()];
}

/** Numbering style by code (regex over the verified headings and the paragraph starts), not the model. */
export function detectNumbering(numbers: (string | null)[], paragraphs: string[]): NumberingStyle {
  const nums = numbers.filter((n): n is string => n !== null);
  if (!numbers.length || nums.length * 2 < numbers.length) return "none";
  const count = (re: RegExp) => nums.filter((n) => re.test(n)).length;
  const most = (re: RegExp) => count(re) * 2 >= nums.length;
  if (most(/^article/i)) return "article";
  if (most(/^(?:clause|section)/i)) return "clause";
  if (most(/^[IVXLC]+[.)]$/)) return "roman";
  if (most(/^\d+(?:\.\d+)*[.)]?$/)) {
    return paragraphs.filter((p) => /^\d+\.\d+/.test(p)).length >= 2 ? "decimal_nested" : "decimal";
  }
  if (most(/^[A-Z][.)]$/)) return "alpha";
  return "none";
}

/** Joins wrapped lines into paragraphs: a new one starts at a numbered or bulleted line or after a full stop. */
export function toParagraphs(lines: string[]): string[] {
  const out: string[] = [];
  let cur = "";
  for (const raw of lines) {
    const line = normalizeWs(raw);
    if (!line) {
      if (cur) out.push(cur);
      cur = "";
      continue;
    }
    if (cur && (PARA_START.test(line) || /[.:;!?]$/.test(cur))) {
      out.push(cur);
      cur = line;
    } else cur = cur ? `${cur} ${line}` : line;
  }
  if (cur) out.push(cur);
  return out;
}

const headKey = (s: string): string => normalizeWs(s);

/** A heading is short, has no sentence punctuation at the end, no blank, and isn't a numbered sub-clause (3.1 …). */
export function looksLikeHeading(line: string): boolean {
  const l = normalizeWs(line);
  return (
    l.length >= 2 &&
    l.length <= 80 &&
    l.split(" ").length <= 10 &&
    !/[.;,]$/.test(l) &&
    !/\{\{b\d+\}\}/.test(l) &&
    !/^\d+\.\d+/.test(l)
  );
}

/**
 * The quote guard for sections. A heading the model proposed is kept only when a line of the text
 * equals it verbatim after normalisation (with or without its number), in reading order. The body
 * of every section is then cut from the text by code, so fixed wording is verbatim by construction.
 */
export function buildSections(
  lines: string[],
  proposed: string[],
  /** Lines set in a heading look in the PDF (pass `undefined` only when the look failed; an empty set allows no heading). */
  allowed?: ReadonlySet<string>,
): { sections: TemplateSections; dropped: number; headingLines: number[] } {
  const heads: { line: number; number: string | null; heading: string }[] = [];
  let cursor = 0;
  let dropped = 0;
  for (const p of proposed) {
    const want = headKey(p);
    const wantRest = splitNumber(want)[1];
    let at = -1;
    if (want.length >= 2 && want.length <= 120 && heads.length < MAX_SECTIONS) {
      for (let i = cursor; i < lines.length; i++) {
        const l = headKey(lines[i]!);
        if (!l || l.length > 160) continue;
        if ((l === want || splitNumber(l)[1] === wantRest) && looksLikeHeading(l) && (!allowed || allowed.has(l))) {
          at = i;
          break;
        }
      }
    }
    if (at < 0) {
      dropped++;
      continue;
    }
    const [num, rest] = splitNumber(headKey(lines[at]!));
    heads.push({ line: at, number: num, heading: rest });
    cursor = at + 1;
  }
  const first = heads[0]?.line ?? lines.length;
  const preamble = lines.slice(0, first);
  const firstIdx = preamble.findIndex((l) => l.trim());
  const rawTitle = firstIdx >= 0 ? normalizeWs(preamble[firstIdx]!) : "";
  const title = rawTitle && rawTitle.length <= 100 && !/\{\{b\d+\}\}/.test(rawTitle) ? rawTitle : null;
  if (title) preamble.splice(firstIdx, 1);
  const items: TemplateSection[] = [];
  const preParas = toParagraphs(preamble);
  if (preParas.length) items.push({ id: "s0", number: null, heading: null, paragraphs: preParas });
  const allParas: string[] = [...preParas];
  heads.forEach((h, k) => {
    const end = heads[k + 1]?.line ?? lines.length;
    const paragraphs = toParagraphs(lines.slice(h.line + 1, end));
    allParas.push(...paragraphs);
    items.push({ id: `s${k + 1}`, number: h.number, heading: h.heading, paragraphs });
  });
  const numbering = detectNumbering(
    heads.map((h) => h.number),
    allParas,
  );
  return { sections: { numbering, title, items }, dropped, headingLines: heads.map((h) => h.line) };
}

/** Index of the section holding each line (for `sectionIndex` on a blank). */
export function sectionOfLines(lineCount: number, headingLines: number[], hasPreamble: boolean): number[] {
  const base = hasPreamble ? 1 : 0;
  const out: number[] = [];
  let k = -1;
  for (let i = 0; i < lineCount; i++) {
    while (k + 1 < headingLines.length && headingLines[k + 1]! <= i) k++;
    out.push(k < 0 ? 0 : k + base);
  }
  return out;
}
