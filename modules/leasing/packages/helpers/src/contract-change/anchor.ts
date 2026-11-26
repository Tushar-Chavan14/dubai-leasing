import type { MarkAnchor, ParagraphText } from "@leasing/core";

export const VALUE_REFUSAL = "This is set in the offer or the records and can't be changed here.";

/** Join `word-\nword` hyphenation, straighten quotes, collapse whitespace. */
export function normaliseQuoteText(s: string): string {
  return s
    .replace(/(\p{L})-\s*\n\s*(\p{L})/gu, "$1$2")
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”„]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

const alnum = /[\p{L}\p{N}]/u;
const digit = /\p{N}/u;
/** True when text[from,to) is not inside a longer word or number ("1" inside "10" or "4.10"). */
function wholeToken(text: string, from: number, to: number): boolean {
  const prev = text[from - 1] ?? "";
  const next = text[to] ?? "";
  if (alnum.test(prev) || alnum.test(next)) return false;
  if (/[.,]/.test(prev) && digit.test(text[from - 2] ?? "")) return false;
  if (/[.,]/.test(next) && digit.test(text[to + 1] ?? "")) return false;
  return true;
}

const lower = (s: string) => s.toLowerCase();

export function anchorFor(par: { key: string; label: string }): MarkAnchor {
  const { key, label } = par;
  if (key === "free_text") return { kind: "free_text", label: "Additional terms" };
  if (key === "title" || key.endsWith(":h") || key.startsWith("law:") || key.startsWith("std:"))
    return { kind: "fixed", label };
  if (key.includes(":"))
    return key.startsWith("cc:") ? { kind: "clause", ref: key, label } : { kind: "paragraph", key, label };
  return { kind: "clause", ref: key, label };
}

/**
 * Pin a signer's selected quote to the contract paragraph(s) it came from. Pure code, no model.
 * A quote that touches a printed record value is refused (rule 1). Several matches take the first.
 */
export function anchorQuote(
  paragraphs: ParagraphText[] | null,
  quote: string,
): { anchor: MarkAnchor; refused: string | null; quotes: { key: string; quote: string }[] } {
  const none = { anchor: { kind: "unknown" } as MarkAnchor, refused: null, quotes: [] };
  if (!paragraphs) return none;
  const q = normaliseQuoteText(quote);
  if (!q) return none;
  const ql = lower(q);
  const texts = paragraphs.map((x) => lower(normaliseQuoteText(x.text)));

  const refuse = () => ({ anchor: none.anchor, refused: VALUE_REFUSAL, quotes: [] });
  // Position overlap: a whole-token occurrence of a printed value that intersects [from, to) of the text.
  const hitsValue = (par: ParagraphText, text: string, from: number, to: number) =>
    par.values.some((v) => {
      const n = lower(normaliseQuoteText(v));
      if (!n) return false;
      for (let at = text.indexOf(n); at >= 0; at = text.indexOf(n, at + 1)) {
        const end = at + n.length;
        if (!wholeToken(text, at, end)) continue;
        if (at < to && end > from) return true;
      }
      return false;
    });

  const one = texts.findIndex((t) => t.includes(ql));
  if (one >= 0) {
    const par = paragraphs[one]!;
    const from = texts[one]!.indexOf(ql);
    if (hitsValue(par, texts[one]!, from, from + ql.length)) return { ...refuse(), anchor: anchorFor(par) };
    return { anchor: anchorFor(par), refused: null, quotes: [{ key: par.key, quote: q }] };
  }

  for (let i = 0; i + 1 < paragraphs.length; i++) {
    const a = texts[i]!;
    const joined = `${a} ${texts[i + 1]!}`;
    const at = joined.indexOf(ql);
    if (at < 0 || at >= a.length || at + ql.length <= a.length + 1) continue;
    const pair = [paragraphs[i]!, paragraphs[i + 1]!];
    const cut = a.length - at;
    const second = texts[i + 1]!;
    if (hitsValue(pair[0]!, a, at, a.length) || hitsValue(pair[1]!, second, 0, ql.length - cut - 1))
      return { ...refuse(), anchor: anchorFor(pair[0]!) };
    return {
      anchor: anchorFor(pair[0]!),
      refused: null,
      quotes: [
        { key: pair[0]!.key, quote: q.slice(0, cut).trim() },
        { key: pair[1]!.key, quote: q.slice(cut).trim() },
      ],
    };
  }
  return none;
}

/**
 * D72: finds the paragraph that holds a quote when the mark's place is unknown (a version prepared before marks were
 * pinned). Code only: the quote must be inside the paragraph's raw wording (blank tokens left out) in lower case with
 * whitespace collapsed. The model's `hint` key is tried first, then every paragraph in order; the first match wins.
 * A clause's raw wording is "Title: text", so a quote with or without the title matches.
 */
export function findQuotePlace<P extends { key: string; raw: string }>(
  paragraphs: readonly P[],
  quote: string,
  hint?: string,
): P | null {
  const q = lower(normaliseQuoteText(quote));
  if (!q) return null;
  const has = (p: P) => lower(normaliseQuoteText(p.raw.replace(/\{\{b\d+\}\}/g, " "))).includes(q);
  const hinted = hint ? paragraphs.find((p) => p.key === hint) : undefined;
  if (hinted && has(hinted)) return hinted;
  return paragraphs.find(has) ?? null;
}
