import { VALUE_PATTERNS } from "@platform/readers/structure/values";

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const GROUPED = /\b\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?\b/g;

export interface StrayMatch {
  kind: string;
  /** The words as they stand in the text. */
  text: string;
  index: number;
}

/**
 * Values in a text that are not among the deal's own (`allowed`): emails, IDs, passport numbers, AED amounts, dates (the
 * kinds asked for). Returns the words found, in text order; a match inside an earlier match (a grouped number in an AED
 * amount) is dropped. Pure code (S51, S60).
 */
export function strayMatches(text: string, allowed: string, kinds: readonly string[]): StrayMatch[] {
  const ok = squash(allowed);
  const patterns = VALUE_PATTERNS.filter((p) => kinds.includes(p.kind));
  if (kinds.includes("an AED amount")) patterns.push({ kind: "an AED amount", re: GROUPED });
  const all: StrayMatch[] = [];
  for (const { kind, re } of patterns)
    for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`)))
      if (!ok.includes(squash(m[0]))) all.push({ kind, text: m[0], index: m.index });
  all.sort((a, b) => a.index - b.index || b.text.length - a.text.length);
  const kept: StrayMatch[] = [];
  let end = -1;
  for (const m of all) {
    if (m.index < end) continue;
    kept.push(m);
    end = m.index + m.text.length;
  }
  return kept;
}
