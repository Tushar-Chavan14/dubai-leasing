import { type ContractChangeAnalysis, type Helper, wordDiff } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { fixedValueKinds } from "../contract-structure/filled.ts";
import { changeMessages } from "./prompt.ts";
import { type ClauseOption, ContractChangeContext, ContractChangeData, ModelChange } from "./schema.ts";

export * from "./schema.ts";
export { changeMessages } from "./prompt.ts";

export const ContractChangeSchemas = { context: ContractChangeContext, data: ContractChangeData };

/**
 * Words of a money, date or period term. New wording the AI adds may contain none of them (rule 1): such a change is
 * the offer's or the rulebook's, and a person makes it.
 */
const MONEY_OR_DATE =
  /\b(?:rent(?:al|s)?|deposits?|cheques?|checks?|aed|dirhams?|dhs?|fees?|commissions?|payments?|pay|paid|refund\w*|penalt\w*|fines?|discount\w*|interest|charges?|free of charge|costs?|days?|weeks?|months?|years?|annual\w*|monthly|yearly|dates?|deadline\w*|ejari|vat|notice|terminat\w*|vacat\w*|evict\w*|repossess\w*|renew\w*|increas\w*|decreas\w*|reduc\w*|waiv\w*|late|early|half|twice|double|triple|percent|per ?cent|thirty|sixty|ninety|hundred|thousand)\b|%/i;

/** The addendum as it prints, one clause per line, so the diff reads like the contract. */
export function renderAddendum(clauses: string[], freeText: string | null, catalogue: ClauseOption[]): string {
  const lines = clauses.map((ref) => {
    const c = catalogue.find((x) => x.ref === ref);
    return c ? `${c.title}. ${c.text}` : ref;
  });
  if (freeText?.trim()) lines.push(`Additional terms. ${freeText.trim()}`);
  return lines.join("\n");
}

/** The words the new extra terms add (from the diff), the only text the money/date checks look at. */
function addedText(before: string | null, after: string | null): string {
  return wordDiff(before?.trim() ?? "", after?.trim() ?? "")
    .filter((p) => p.op === "add")
    .map((p) => p.text)
    .join(" ");
}

/**
 * Checks a model draft against the rules. Returns the problems (empty: the draft may be shown) and the proposal.
 * Pure code; the model's words never decide what is allowed.
 */
export function checkChange(
  c: ContractChangeContext,
  m: ModelChange,
): { problems: string[]; proposal: { clauses: string[]; freeText: string | null } | null } {
  if (m.kind === "money_or_dates" || m.kind === "question" || m.kind === "other")
    return { problems: [], proposal: null };
  const problems: string[] = [];
  const current = c.current.clauses.map((x) => x.ref);
  const allowed = new Set(c.allowed.map((x) => x.ref));
  for (const r of m.removeClauses)
    if (!current.includes(r)) problems.push(`removeClauses: ${r} is not a clause on the contract`);
  for (const r of m.addClauses) {
    if (!allowed.has(r)) problems.push(`addClauses: ${r} is not in the allowed list`);
    else if (current.includes(r)) problems.push(`addClauses: ${r} is already on the contract`);
  }
  const clauses = [
    ...current.filter((r) => !m.removeClauses.includes(r)),
    ...m.addClauses.filter((r) => allowed.has(r)),
  ];
  const freeText = m.freeText === null ? c.current.freeText : m.freeText.trim() || null;
  const added = addedText(c.current.freeText, freeText);
  if (added) {
    const kinds = fixedValueKinds(added);
    if (kinds.length) problems.push(`freeText: the new wording contains ${kinds.join(", ")}`);
    if (/\d/.test(added)) problems.push("freeText: the new wording contains a number");
    const w = MONEY_OR_DATE.exec(added);
    if (w) problems.push(`freeText: the new wording talks about money or time ("${w[0]}"); set kind "money_or_dates"`);
  }
  if (clauses.length > 20) problems.push("the addendum may have at most 20 clauses");
  const same = clauses.join() === current.join() && (freeText?.trim() ?? "") === (c.current.freeText?.trim() ?? "");
  if (same) problems.push("the draft changes nothing; change the addendum or choose a kind that changes nothing");
  return { problems, proposal: { clauses, freeText } };
}

const blockedFor: Partial<Record<ModelChange["kind"], string>> = {
  money_or_dates:
    "The request is about rent, cheques, deposit, dates or periods. The AI drafts none of these: change the offer or the lease terms by hand.",
  question: "The signer asked a question rather than a change. Reply, then decline the request or re-issue as is.",
  other: "The AI drafted no change. Read the request and decide.",
};

/**
 * Contract change helper (D67, one-shot, chat model + code). The model classifies the request, explains it and drafts a
 * revised addendum; code checks the draft (allowed clause ids only, no amount, number, date, period or money word
 * added) and builds the diff. A draft that breaks a rule is sent back once, then dropped: staff see the analysis and
 * edit by hand. Never writes anything: the Manager stores the result and a person re-issues or declines.
 */
export function contractChangeHelper(llm: Llm): Helper<ContractChangeContext, ContractChangeData> {
  return {
    name: "contract_change",
    async run(input) {
      const c = input.context;
      const catalogue = [...c.current.clauses, ...c.allowed];
      const before = renderAddendum(
        c.current.clauses.map((x) => x.ref),
        c.current.freeText,
        catalogue,
      );
      let problems: string[] = [];
      let last: ModelChange | null = null;
      let modelName = "";
      for (let round = 0; round < 2; round++) {
        const r = await llm.chat(changeMessages(c, problems), { schema: ModelChange });
        modelName = r.model;
        // An answer that doesn't parse throws: the runner retries once, then asks a person.
        const m = ModelChange.parse(r.parsed);
        last = m;
        const checked = checkChange(c, m);
        if (!checked.problems.length) {
          const proposal = checked.proposal;
          const data: ContractChangeAnalysis = {
            kind: m.kind,
            summary: m.summary,
            analysis: m.analysis,
            risks: m.risks,
            proposal,
            blocked: proposal ? null : (blockedFor[m.kind] ?? null),
            diff: proposal ? wordDiff(before, renderAddendum(proposal.clauses, proposal.freeText, catalogue)) : [],
          };
          return {
            status: "ok",
            data,
            reasons: [proposal ? "Drafted a revised addendum; a person reviews it." : (data.blocked ?? "No draft.")],
            sourceDocIds: [],
            model: { name: modelName },
          };
        }
        problems = checked.problems;
      }
      // Two drafts broke a rule: keep the explanation, drop the draft.
      const data: ContractChangeAnalysis = {
        kind: last!.kind,
        summary: last!.summary,
        analysis: last!.analysis,
        risks: last!.risks,
        proposal: null,
        blocked: `The AI's draft broke a rule (${problems.slice(0, 2).join("; ")}). Edit the contract by hand.`.slice(
          0,
          400,
        ),
        diff: [],
      };
      return {
        status: "ok",
        data,
        reasons: ["The draft was refused twice by the checks; a person edits the contract."],
        sourceDocIds: [],
        model: { name: modelName },
      };
    },
  };
}
