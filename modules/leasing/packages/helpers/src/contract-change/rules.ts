import type { Emirate } from "@leasing/core";
import { valueTokens } from "../contract-template/values.ts";
import { LEGAL_WORDS, TOKENS, tokensOf } from "../contract-agent/checks.ts";
import { fixedValueKinds } from "../contract-structure/filled.ts";
import {
  emirateWordingProblems,
  legalPeriodProblems,
  rulebookPeriodsIn,
  type LegalRules,
} from "../contract-structure/legal-wording.ts";
import { unprintable } from "../contract-structure/render.ts";

export interface MarkRewriteInput {
  before: string;
  after: string;
  notes: string[];
  rules: LegalRules;
  emirate: Emirate;
  rewritable: boolean;
  /** Who asked for the change. An officer's explicit instruction is checked against the law only (D72). Default signer. */
  author?: "signer" | "officer";
}

const plain = (s: string) => s.replace(TOKENS, " ");
const legalWordsIn = (s: string): Set<string> => {
  const re = new RegExp(LEGAL_WORDS.source, "gi");
  return new Set([...plain(s).matchAll(re)].map((m) => m[0].toLowerCase()));
};

/**
 * Code rules a reworded passage must pass (AGENTS rule 1: no model decides a legal or money value). Returns the
 * problems; empty means the rewrite is accepted.
 */
export function checkMarkRewrite(input: MarkRewriteInput): string[] {
  const { before, after, notes, rules, emirate, rewritable } = input;
  if (!rewritable) return ["This part of the contract is fixed and can't be reworded."];
  const problems: string[] = [];
  const noteText = notes.join(" ");
  const officer = input.author === "officer";

  if (tokensOf(before).join() !== tokensOf(after).join())
    problems.push("Keep every {{bN}} blank exactly once and add none.");

  if (officer) {
    // D72: the officer's words are applied as written; only the law, the other emirate's wording, the records' blanks
    // and printing are checked.
    for (const p of legalPeriodProblems([{ key: "x", text: after }], rules)) problems.push(p.problem);
    const kept = rulebookPeriodsIn(after);
    for (const b of rulebookPeriodsIn(before))
      if (!kept.some((a) => a.kind === b.kind && a.value === b.value))
        problems.push(`The rulebook period of ${b.value} stated in this passage must stay as it is.`);
    for (const p of emirateWordingProblems([{ key: "x", text: after }], emirate)) problems.push(p.problem);
    if (unprintable(after)) problems.push("The new wording has characters the contract PDF can't print.");
    if (after.length > Math.max(before.length * 3, before.length + 1500)) problems.push("The new wording is too long.");
    return problems;
  }

  const have = valueTokens(plain(before));
  const asked = valueTokens(noteText);
  for (const t of valueTokens(plain(after)))
    if (!have.has(t) && !asked.has(t)) problems.push(`"${t}" is not in the request.`);

  for (const p of legalPeriodProblems([{ key: "x", text: after }], rules)) problems.push(p.problem);
  const stated = rulebookPeriodsIn(after);
  for (const b of rulebookPeriodsIn(before))
    if (!stated.some((a) => a.kind === b.kind && a.value === b.value))
      problems.push(`The rulebook period of ${b.value} stated in this passage must stay as it is.`);

  const noteDate = fixedValueKinds(noteText).includes("a date");
  const kinds = fixedValueKinds(after).filter((k) => !(k === "a date" && noteDate));
  if (kinds.length) problems.push(`The new wording contains ${kinds.join(", ")}.`);

  const allowed = new Set([...legalWordsIn(before), ...legalWordsIn(noteText)]);
  const added = [...legalWordsIn(after)].filter((w) => !allowed.has(w));
  if (added.length)
    problems.push(`The new wording adds legal, money, permission or negation words: ${added.join(", ")}.`);

  for (const p of emirateWordingProblems([{ key: "x", text: after }], emirate)) problems.push(p.problem);
  if (unprintable(after)) problems.push("The new wording has characters the contract PDF can't print.");
  if (after.length > Math.max(before.length * 2, before.length + 400)) problems.push("The new wording is too long.");
  return problems;
}
