import type { Helper } from "@leasing/core";
import type { Llm } from "@platform/llm";
import { anchorFor, findQuotePlace } from "../contract-change/anchor.ts";
import { checkMarkRewrite } from "../contract-change/rules.ts";
import { rulebookPeriodsIn } from "../contract-structure/legal-wording.ts";
import { marksMessages } from "./prompt.ts";
import { MarksContext, MarksData, ModelMarks } from "./schema.ts";
import { checkTermChanges } from "./terms.ts";

export * from "./schema.ts";
export { marksMessages } from "./prompt.ts";
export { boundValues, checkTermChanges, valuesInWords } from "./terms.ts";

const CLAUSE_APPROVED =
  "This clause's wording is approved by the company; ask for it to be removed or describe the change in the additional terms.";
const REMOVE_ASKED =
  /\b(remove|removed|removing|delete|deleted|drop|dropped|strike|take (it )?out|get rid of|without this)\b/i;
const REMOVE_VERB =
  /\b(remove|removed|removing|delete|deleted|drop|dropped|strike|take (?:it )?out|get rid of|without this)\b/gi;
const NEGATION = /\b(not|no|never|don't|dont|doesn't|doesnt|do not|cannot|can't|cant|won't|wont|shouldn't|without)\b/i;
/** True when the note asks for removal and doesn't negate it ("do not remove", "keep this clause"). */
export function asksRemoval(note: string): boolean {
  if (!REMOVE_ASKED.test(note)) return false;
  if (/\bkeep\b/i.test(note)) return false;
  for (const m of note.matchAll(REMOVE_VERB)) {
    const before = note.slice(0, m.index).trim().split(/\s+/).slice(-3).join(" ");
    if (!NEGATION.test(before)) return true;
  }
  return false;
}
const LINKED_CLAUSE =
  "This paragraph prints a company clause; remove the clause or describe the change in the additional terms.";
const CORE_REMOVAL = "This part prints the lease's terms or the parties; change the terms instead of removing it.";
const NOT_FOUND = "Couldn't find these words in the contract.";
const OFFICER_TARGET =
  /\b(this|the|that)\s+(line|clause|paragraph|sentence|term|section)\b|\bcan be (removed|deleted|dropped)\b/i;
/** D72: the officer's words ask to remove a line, clause or paragraph (negation and "keep" refuse, as for a signer). */
export function asksOfficerRemoval(note: string): boolean {
  return asksRemoval(note) && OFFICER_TARGET.test(note);
}
/** The paragraph key of a clause-anchored mark: the clause ref carried in the mark's quote anchor (see `clauseRef`). */
function clauseKeyOf(c: MarksContext, n: number): string | undefined {
  return c.marks.find((x) => x.n === n)?.clauseRef;
}

/** Models often print the heading ("6.2 Visitors") before the body; the label is code's, not wording. */
function withoutLabel(after: string, label: string, before: string): string {
  const num = /^[\d.]+/.exec(label.trim())?.[0];
  const heading = label.trim().replace(/^[\d.]+\s*/, "");
  let t = after.trim().replace(/^[([]\s*(?=[\d])/, "");
  const closer = /^[([]/.test(after.trim());
  for (const l of [label.trim(), num && heading ? `${num} ${heading}` : "", num ?? "", heading]) {
    if (!l || before.toLowerCase().startsWith(l.toLowerCase())) continue;
    if (t.toLowerCase().startsWith(l.toLowerCase())) {
      t = t.slice(l.length).replace(closer ? /^[\s)\]:.\-–—]+/ : /^[\s:.\-–—]+/, "");
      break;
    }
  }
  return t;
}

export const ContractMarksSchemas = { context: MarksContext, data: MarksData };

/**
 * contract_marks helper (one-shot, chat model + code). One model call rewrites the marked paragraphs from the notes;
 * code then checks each rewrite (checkMarkRewrite). A rewrite that fails, names an unknown paragraph or covers no
 * known mark moves to `refused` with the problems. A model answer that doesn't parse throws: the runner retries once,
 * then returns needs_human. Never writes anything.
 */
export function contractMarksHelper(llm: Llm): Helper<MarksContext, MarksData> {
  return {
    name: "contract_marks",
    async run(input) {
      const c = input.context;
      const nonce = input.runId.replaceAll("-", "").slice(0, 16);
      const r = await llm.chat(marksMessages(c, nonce), { schema: ModelMarks });
      const m = ModelMarks.parse(r.parsed);
      const rewrites: MarksData["rewrites"] = [];
      const removals: MarksData["removals"] = [];
      const additions: MarksData["additions"] = [];
      const refused: MarksData["refused"] = [];
      const terms: MarksData["terms"] = [];
      const done = new Set<number>();
      const known = new Set(c.marks.map((x) => x.n));
      // D72: an officer's mark whose place is unknown is placed by code: the model's key counts only when the quote
      // is in that paragraph, else code searches every paragraph.
      const hints = new Map<number, string>();
      for (const w of m.rewrites) for (const n of w.n) hints.set(n, w.key);
      for (const r of m.removals) for (const n of r.n) if (r.key) hints.set(n, r.key);
      // A term change needs no place in the contract (it changes the lease's records).
      const termMarks = new Set(m.termChanges.flatMap((t) => t.n));
      const places: MarksData["places"] = [];
      const unresolved = new Set<number>();
      const view = c.marks.map((x) => {
        if (x.author !== "officer") return x;
        if (x.anchor === "unknown" && !termMarks.has(x.n)) {
          const p = findQuotePlace(c.paragraphs, x.quote, hints.get(x.n));
          if (!p) {
            unresolved.add(x.n);
            return x;
          }
          places.push({ n: x.n, key: p.key });
          const kind = anchorFor(p).kind as "paragraph" | "clause" | "free_text" | "fixed";
          return { ...x, key: p.key, anchor: kind, ...(kind === "clause" ? { clauseRef: p.key } : {}) };
        }
        return x.anchor === "clause" && !x.key && x.clauseRef ? { ...x, key: x.clauseRef } : x;
      });
      for (const n of unresolved) {
        done.add(n);
        refused.push({ n, reason: NOT_FOUND });
      }
      const markOf = (n: number) => view.find((x) => x.n === n);
      const anchorOf = (n: number) => markOf(n)?.anchor;
      const allOfficer = (ns: number[]) => ns.every((n) => markOf(n)?.author === "officer");
      // D72: an officer's term change. Each value must be in the officer's words (code), else the mark is refused.
      for (const t of m.termChanges) {
        const ns = [...new Set(t.n)].filter((n) => known.has(n) && !done.has(n));
        if (!ns.length) continue;
        for (const n of ns) done.add(n);
        if (!allOfficer(ns)) {
          for (const n of ns) refused.push({ n, reason: "Only the leasing team can change the lease terms." });
          continue;
        }
        const words = ns.map((n) => markOf(n)!.note).join(" ");
        const { accepted, problems } = checkTermChanges(t.changes, words);
        if (problems.length || !Object.keys(accepted).length) {
          for (const n of ns)
            refused.push({ n, reason: problems.join(" ") || "No lease term to change was found in your words." });
        } else terms.push({ n: ns, changes: accepted, summary: t.summary });
      }
      // Code, not the model, decides a removal the words ask for: a mark on a clause (signer or officer) or an officer's
      // mark on any paragraph whose note says "remove this" / "drop it" is removed even if the model didn't list it.
      const askedByWords = c.marks
        .filter(
          (x) => asksRemoval(x.note) && (x.anchor === "clause" || (x.author === "officer" && x.anchor === "paragraph")),
        )
        .map((x) => x.n);
      for (const n of new Set([...askedByWords, ...m.removeClauses, ...m.removals.flatMap((r) => r.n)])) {
        const mark = markOf(n);
        if (!mark || done.has(n)) continue;
        done.add(n);
        if (mark.author === "officer") {
          const para = c.paragraphs.find((p) => p.key === mark.key);
          // The mark already points at the clause or paragraph, so "drop it" is enough (no "this line" needed).
          if (!para || !asksRemoval(mark.note)) refused.push({ n, reason: "Your words don't ask to remove this." });
          else if (mark.anchor === "clause")
            removals.push({ n: [n], key: para.key, before: para.raw, summary: "Remove this clause." });
          else if (mark.anchor === "paragraph" && !para.rewritable) refused.push({ n, reason: LINKED_CLAUSE });
          else if (mark.anchor === "paragraph" && para.core) refused.push({ n, reason: CORE_REMOVAL });
          else if (mark.anchor === "paragraph" && para.rewritable) {
            const law = rulebookPeriodsIn(para.raw)[0];
            if (law)
              refused.push({
                n,
                reason: `This paragraph states the rulebook period of ${law.value}, set by law, so it can't be removed.`,
              });
            else rewrites.push({ n: [n], key: para.key, after: "", summary: "Remove this paragraph." });
          } else
            refused.push({ n, reason: "Only a clause or a paragraph of the contract's own wording can be removed." });
          continue;
        }
        const para = c.paragraphs.find((p) => p.key === clauseKeyOf(c, n));
        if (mark.anchor !== "clause" || !para) refused.push({ n, reason: "Only a clause can be removed." });
        else if (!asksRemoval(mark.note)) refused.push({ n, reason: CLAUSE_APPROVED });
        else removals.push({ n: [n], key: para.key, before: para.raw, summary: "Remove this clause." });
      }
      for (const a of m.additionalTerms) {
        const ns = [...new Set(a.n)].filter((n) => known.has(n) && !done.has(n));
        if (!ns.length) continue;
        for (const n of ns) done.add(n);
        if (ns.some((n) => anchorOf(n) !== "fixed")) {
          for (const n of ns)
            refused.push({ n, reason: "Additional terms are proposed only for marks on fixed text." });
          continue;
        }
        const before = c.freeText ?? "";
        const after = before ? `${before.trimEnd()} ${a.text}` : a.text;
        const problems = checkMarkRewrite({
          before,
          after,
          notes: view.filter((x) => ns.includes(x.n)).map((x) => x.note),
          rules: c.rules,
          emirate: c.emirate,
          rewritable: true,
          ...(allOfficer(ns) ? { author: "officer" as const } : {}),
        });
        if (problems.length) for (const n of ns) refused.push({ n, reason: problems.join(" ") });
        else additions.push({ n: ns, before, after, summary: "Adds this sentence to the additional terms." });
      }
      for (const w of m.rewrites) {
        const listed = [...new Set(w.n)].filter((n) => known.has(n) && !done.has(n));
        if (!listed.length) continue;
        // Code owns the paragraph key: the marks' own key, else the model's key, else its label.
        const keys = listed.map((n) => markOf(n)?.key);
        const shared = keys[0] && keys.every((k) => k === keys[0]) ? keys[0] : undefined;
        const wanted = w.key.trim().toLowerCase();
        const para =
          (shared ? c.paragraphs.find((p) => p.key === shared) : undefined) ??
          c.paragraphs.find((p) => p.key === w.key) ??
          c.paragraphs.find((p) => p.label.trim().toLowerCase() === wanted);
        // A rewrite of a paragraph covers every mark anchored to it.
        const ns = para
          ? [
              ...new Set([...listed, ...view.filter((x) => x.key === para.key && !done.has(x.n)).map((x) => x.n)]),
            ].toSorted((a, b) => a - b)
          : listed;
        const notes = view.filter((x) => ns.includes(x.n)).map((x) => x.note);
        const officer = allOfficer(ns);
        // D72: an officer's reworded clause can't be edited in place: the clause is removed and its new wording goes
        // into the additional terms.
        if (para && officer && ns.every((n) => anchorOf(n) === "clause")) {
          for (const n of ns) done.add(n);
          const problems = checkMarkRewrite({
            before: para.raw,
            after: w.after,
            notes,
            rules: c.rules,
            emirate: c.emirate,
            rewritable: true,
            author: "officer",
          });
          if (problems.length) for (const n of ns) refused.push({ n, reason: problems.join(" ") });
          else removals.push({ n: ns, key: para.key, before: para.raw, after: w.after, summary: w.summary });
          continue;
        }
        if (para && officer && !para.rewritable && ns.every((n) => anchorOf(n) === "paragraph")) {
          for (const n of ns) done.add(n);
          for (const n of ns) refused.push({ n, reason: LINKED_CLAUSE });
          continue;
        }
        if (para && !para.rewritable && ns.every((n) => anchorOf(n) === "clause")) {
          for (const n of ns) done.add(n);
          for (const n of ns) refused.push({ n, reason: CLAUSE_APPROVED });
          continue;
        }
        const after = para ? withoutLabel(w.after, para.label, para.raw) : w.after;
        const problems = para
          ? checkMarkRewrite({
              before: para.raw,
              after,
              notes,
              rules: c.rules,
              emirate: c.emirate,
              rewritable: para.rewritable,
              ...(officer ? { author: "officer" as const } : {}),
            })
          : ["The AI named a paragraph that is not in the contract."];
        for (const n of ns) done.add(n);
        if (problems.length) for (const n of ns) refused.push({ n, reason: problems.join(" ") });
        else rewrites.push({ n: ns, key: para!.key, after, summary: w.summary });
      }
      for (const f of m.refused)
        if (known.has(f.n) && !done.has(f.n)) {
          done.add(f.n);
          refused.push({ n: f.n, reason: f.reason });
        }
      for (const x of c.marks)
        if (!done.has(x.n)) refused.push({ n: x.n, reason: "The AI gave no rewrite for this mark." });
      refused.sort((a, b) => a.n - b.n);
      return {
        status: "ok",
        data: { rewrites, refused, removals, additions, terms, places: places.filter((p) => !unresolved.has(p.n)) },
        reasons: [
          `${rewrites.length + removals.length + additions.length + terms.length} proposal(s) passed the checks, ${refused.length} mark(s) refused; a person reviews each.`,
        ],
        sourceDocIds: [],
        model: { name: r.model },
      };
    },
  };
}
