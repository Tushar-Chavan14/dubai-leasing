import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { AddendumFlag, CONTRACT_CLAUSES, type Helper } from "@leasing/core";
import { z } from "zod";
import { buildContractFields } from "../contract/fields.ts";
import type { AgentModel, ModelTurn, ToolSpec } from "../customer-agent/index.ts";
import {
  changedWords,
  checkContractTerms,
  checkRewrite,
  codeUnitRewrite,
  normalizeRewrite,
  safeReason,
  type UnitDisagreement,
  unitDisagreements,
} from "./checks.ts";
import { asData, caseBrief, contractAgentSystem } from "./prompt.ts";
import {
  AgentAnswer,
  type BlankFill,
  ContractAgentContext,
  ContractAgentData,
  type TemplateRewrite,
} from "./schema.ts";

export {
  checkContractTerms,
  checkRewrite,
  codeUnitRewrite,
  describesUnit,
  dropLeftoverType,
  factNumbers,
  headingWithUse,
  normalizeRewrite,
  safeReason,
  statedNumbers,
  type UnitDisagreement,
  unitDisagreements,
  unitParticulars,
} from "./checks.ts";
export * from "./schema.ts";

export const ContractAgentSchemas = { context: ContractAgentContext, data: ContractAgentData };
export const MAX_CONTRACT_AGENT_CALLS = 8;
/** Each model turn must answer within this; a hung model fails the run (the job retries). */
const MODEL_TURN_TIMEOUT_MS = 180_000;

/** Code the engine provides: template blanks filled from the records. */
export interface ContractAgentBackend {
  fillBlanks(fields: Record<string, unknown>): Promise<BlankFill | null>;
}

const State = Annotation.Root({
  messages: Annotation<BaseMessage[]>({ reducer: (a, b) => a.concat(b), default: () => [] }),
  calls: Annotation<number>({ reducer: (a, b) => a + b, default: () => 0 }),
  retried: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  rewriteRetried: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
  coverRetried: Annotation<boolean>({ reducer: (_a, b) => b, default: () => false }),
});

/** D78: below this share of disagreeing template lines reworded by the model, code rewords the particulars. */
export const CODE_REWORD_BELOW = 0.3;

const NoArgs = z.object({}).strict();
const TOOL_NAMES = [
  "contract_inputs",
  "contract_rule",
  "company_clauses",
  "template",
  "unit_facts",
  "fill_blanks",
  "check_terms",
] as const;
const DESCRIPTIONS: Record<(typeof TOOL_NAMES)[number], string> = {
  contract_inputs: "The contract fields copied from the records, with the source of each.",
  contract_rule: "The company's contract rule for this unit: allowed tenures, cheque range and its clause ids.",
  company_clauses:
    "The company's approved clauses you may add (ref, title, text); those already in the template are not listed.",
  template:
    "The company template's paragraphs with {{bN}} blanks (rewritable or particulars: may be reworded to match unit_facts), or null for the standard contract.",
  unit_facts:
    "The unit's facts from its record (type, bedrooms, bathrooms, area, parking, floor, furnished, description).",
  fill_blanks: "Fills the template blanks from the records (code). Returns filled, leftEmpty and missingCore.",
  check_terms: "Checks tenure, cheques, rent band, deposit, landlord details, required terms and blanks (code).",
};

/**
 * Contract agent (step 5, decision D45). A LangGraph tool loop: the chat model reads the records, the company's
 * contract rule, approved clauses and template through code tools, chooses the additional clauses and flags
 * conflicts. Every field is copied by code (`buildContractFields`) and the term checks are recomputed by code after
 * the loop; a failed check, an unknown clause or an answer that doesn't parse twice → `needs_human`.
 */
export function contractAgent(
  model: AgentModel,
  backend: ContractAgentBackend,
): Helper<ContractAgentContext, ContractAgentData> {
  return {
    name: "contract_agent",
    async run(input) {
      const c = input.context;
      const built = buildContractFields(c.contract);
      if (!built.ok) {
        return {
          status: "needs_human",
          reasons: built.missing.map((m) => `Missing or invalid: ${m}.`),
          sourceDocIds: [],
        };
      }
      const nonce = input.runId.replaceAll("-", "").slice(0, 16);
      const fill = await backend.fillBlanks(built.fields);
      const tool = (name: (typeof TOOL_NAMES)[number]): unknown => {
        switch (name) {
          case "contract_inputs":
            // Names and contact details were typed by people: passed as data, never as instructions.
            return {
              fields: Object.fromEntries(
                Object.entries(built.fields).map(([k, v]) => [k, typeof v === "string" ? asData(v, nonce) : v]),
              ),
              sources: built.sources,
            };
          case "contract_rule":
            return c.rule;
          case "company_clauses":
            // Only clauses the agent may choose: those already in the template's wording are printed there (it reads
            // them through `template`) and can never be added. Sending them all overflowed the model's context (a
            // company with 75 clauses, 57 in its template, cut the answer off mid-JSON).
            return c.clauses
              .filter((x) => !x.inTemplate)
              .map(({ inTemplate: _in, ...x }) => ({
                ...x,
                title: asData(x.title, nonce),
                text: asData(x.text, nonce),
              }));
          case "template":
            return c.template
              ? {
                  version: c.template.version,
                  paragraphs: c.template.paragraphs.map((p) => ({
                    key: p.key,
                    text: asData(p.text, nonce),
                    rewritable: p.rewritable === true,
                    particulars: p.particulars === true,
                    heading: p.heading === true,
                  })),
                }
              : null;
          case "unit_facts":
            return c.unitFacts
              ? {
                  ...c.unitFacts,
                  description: c.unitFacts.description ? asData(c.unitFacts.description, nonce) : null,
                }
              : null;
          case "fill_blanks":
            return fill;
          case "check_terms":
            return checkContractTerms(c, built.fields, fill);
        }
      };
      const specs: ToolSpec[] = TOOL_NAMES.map((name) => ({
        type: "function",
        function: {
          name,
          description: DESCRIPTIONS[name],
          parameters: z.toJSONSchema(NoArgs, { io: "input" }) as Record<string, unknown>,
        },
      }));
      const disagreements = unitDisagreements(c);
      /** The disagreements a set of accepted rewrites covers (a rewrite of the paragraph that passed code's checks). */
      const accepted = (rs: AgentAnswer["rewrites"]) =>
        new Set(rs.filter((r) => checkRewrite(c, r).problems.length === 0).map((r) => r.key));
      const openOf = (rs: AgentAnswer["rewrites"]): UnitDisagreement[] => {
        const ok = accepted(rs);
        return disagreements.filter((d) => !ok.has(d.key));
      };
      const answerSchema = z.toJSONSchema(AgentAnswer, { io: "input" }) as Record<string, unknown>;
      let answer: AgentAnswer | null = null;
      let dropped = 0;
      let failed = false;

      const agent = async (s: typeof State.State) => {
        const limit = s.calls >= MAX_CONTRACT_AGENT_CALLS;
        const messages = limit
          ? [...s.messages, new SystemMessage("Tool limit reached. Answer with the JSON now.")]
          : s.messages;
        // D78: after a nudge (retry) or at the tool limit the turn answers only, held to the answer's JSON schema.
        const last = s.messages.at(-1);
        const answerOnly =
          limit || (s.messages.length > 2 && (last instanceof SystemMessage || last instanceof HumanMessage));
        const turn: ModelTurn = await model.respond(
          messages,
          answerOnly ? null : specs,
          () => {},
          AbortSignal.timeout(MODEL_TURN_TIMEOUT_MS),
          answerOnly ? { format: answerSchema } : undefined,
        );
        if (!answerOnly && turn.toolCalls.length) {
          return {
            messages: [
              new AIMessage({
                content: "",
                tool_calls: turn.toolCalls.map((t) => ({
                  id: t.id,
                  name: t.name,
                  args: t.args,
                  type: "tool_call" as const,
                })),
              }),
            ],
          };
        }
        const parsed = parseAnswer(turn.content);
        if (parsed.success) {
          dropped = parsed.dropped;
          // D64: a rewording code refuses is sent back once with the reasons; after that it is dropped.
          const problems = parsed.data.rewrites.flatMap((r) => checkRewrite(c, r).problems);
          if (problems.length && !s.rewriteRetried) {
            return {
              rewriteRetried: true,
              messages: [
                new AIMessage(turn.content),
                new HumanMessage(
                  `Code refused these rewrites:\n- ${problems.join("\n- ")}\nFix them (use only unit_facts) or leave them out, and answer with the full JSON again.`,
                ),
              ],
            };
          }
          // D78: a disagreeing template line the answer left unfixed is sent back once, with the paragraph keys.
          const open = openOf(parsed.data.rewrites);
          if (open.length && !s.coverRetried) {
            return {
              coverRetried: true,
              messages: [
                new AIMessage(turn.content),
                new HumanMessage(
                  `These template lines still disagree with the unit record:\n- ${open
                    .map((d) => `${d.key}: says "${d.said}", the record says "${d.record}"`)
                    .join(
                      "\n- ",
                    )}\nGive a rewrite for each of these paragraphs (change only those words, keep everything else and every {{bN}} blank), keep your other rewrites, and answer with the full JSON again.`,
                ),
              ],
            };
          }
          answer = parsed.data;
          return { messages: [new AIMessage(turn.content)] };
        }
        if (!s.retried) {
          return {
            retried: true,
            messages: [
              new SystemMessage("That was not the JSON answer. Reply with the JSON object only, in the shape given."),
            ],
          };
        }
        failed = true;
        return { messages: [new AIMessage(turn.content)] };
      };

      const toolsNode = async (s: typeof State.State) => {
        const last = s.messages.at(-1) as AIMessage;
        const calls = last.tool_calls ?? [];
        // Tools take no arguments, so a second call returns the same data: it gets a short pointer instead, or the
        // repeated results fill the model's context and its answer is cut off (D70).
        const earlier = new Set(
          s.messages.filter((m): m is ToolMessage => m instanceof ToolMessage).map((m) => m.name ?? ""),
        );
        const seen = new Set(earlier);
        const out = calls.map((call, i) => {
          const name = call.name as (typeof TOOL_NAMES)[number];
          const content = !TOOL_NAMES.includes(name)
            ? JSON.stringify({ error: `there is no tool named ${call.name}` })
            : earlier.has(name)
              ? JSON.stringify({
                  note: `${name} was already returned above and has not changed. Answer with the JSON now.`,
                })
              : JSON.stringify(tool(name));
          earlier.add(name);
          return new ToolMessage({ content, tool_call_id: call.id ?? `call_${s.calls + i}`, name: call.name });
        });
        // Only new tool results count toward the limit: a repeated call costs a short note, not context.
        const fresh = calls.filter((call, i) => {
          const name = call.name;
          return (
            TOOL_NAMES.includes(name as (typeof TOOL_NAMES)[number]) &&
            !calls.slice(0, i).some((x) => x.name === name) &&
            !seen.has(name)
          );
        }).length;
        return { messages: out, calls: Math.max(fresh, 1) };
      };

      const graph = new StateGraph(State)
        .addNode("agent", agent)
        .addNode("tools", toolsNode)
        .addEdge(START, "agent")
        .addConditionalEdges(
          "agent",
          (s) => {
            if (answer || failed) return END;
            const last = s.messages.at(-1);
            if (last instanceof SystemMessage || last instanceof HumanMessage) return "agent";
            return (last as AIMessage).tool_calls?.length ? "tools" : END;
          },
          ["tools", "agent", END],
        )
        .addEdge("tools", "agent")
        .compile();

      try {
        await graph.invoke(
          {
            messages: [
              new SystemMessage(contractAgentSystem(nonce)),
              new HumanMessage(caseBrief(c, nonce, disagreements)),
            ],
          },
          { recursionLimit: MAX_CONTRACT_AGENT_CALLS * 2 + 10 },
        );
      } catch (e) {
        // Not the model's answer but the model itself (down, loading, a dropped connection): "failed", so the job
        // that called it can retry.
        return {
          status: "failed",
          reasons: [`The contract agent's model failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`],
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
      // D77: the model only advises (extra clauses, flags, rewordings); fields and checks are code. A model that gives
      // no valid answer twice is ignored and the contract is prepared from code alone, marked not reviewed, so the flow
      // does not stop on a small model. The person at `final_contract` still approves every contract.
      const reviewed = answer !== null;
      const a: AgentAnswer = answer ?? { extraClauseIds: [], clauseReasons: [], flags: [], rewrites: [] };
      // Code decides what is allowed: standard clause ids and approved company clauses not already in the template.
      // The model can only add: the starting clauses (the rule's, or the ones staff chose) always stay.
      const inTemplate = new Set(c.clauses.filter((x) => x.inTemplate).map((x) => x.ref));
      const allowed = new Set([
        ...Object.keys(CONTRACT_CLAUSES),
        ...c.clauses.filter((x) => !x.inTemplate).map((x) => x.ref),
      ]);
      const skipped = a.extraClauseIds.filter((id) => inTemplate.has(id));
      // D79: an id that isn't an approved clause (a mistyped id, another company's clause) is never added; it is
      // listed for the approver instead of stopping the contract, since only code decides what is added.
      const bad = a.extraClauseIds.filter((id) => !inTemplate.has(id) && !allowed.has(id));
      const added = a.extraClauseIds.filter((id) => !inTemplate.has(id) && allowed.has(id));
      const extra = [...new Set([...c.contract.addendum.clauses, ...added])];
      const checks = checkContractTerms(c, built.fields, fill);
      const failedChecks = checks.filter((x) => !x.ok);
      if (failedChecks.length) {
        return {
          status: "needs_human",
          reasons: failedChecks.map((x) => x.reason),
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
      const addendum = { ...c.contract.addendum, clauses: extra as typeof c.contract.addendum.clauses };
      // D64: only rewordings code accepts are used, one per paragraph; the rest keep the template's wording.
      const rewrites: TemplateRewrite[] = [];
      const refused: string[] = [];
      // D78: a paragraph code finds nothing wrong with keeps the template's wording (no rewording for its own sake).
      const disagreeing = new Set(disagreements.map((d) => d.key));
      const unneeded = a.rewrites.filter((r) => !disagreeing.has(r.key)).map((r) => r.key);
      for (const r of a.rewrites) {
        if (rewrites.some((x) => x.key === r.key) || !disagreeing.has(r.key)) continue;
        const chk = checkRewrite(c, r);
        if (chk.problems.length || chk.before === null) refused.push(...chk.problems);
        else
          rewrites.push({
            key: r.key,
            before: chk.before,
            after: normalizeRewrite(c, r.text),
            reason: safeReason(r.reason),
          });
      }
      // D78: confidence = the share of the template lines that disagree with the unit record which the model reworded
      // (accepted by code). No disagreement: 1 with a valid answer, 0 without. Only below CODE_REWORD_BELOW does code
      // copy the type and use into the particulars itself (D77), as the last resort.
      const modelKeys = new Set(rewrites.map((r) => r.key));
      const fixedByModel = disagreements.filter((d) => modelKeys.has(d.key)).length;
      const confidence = disagreements.length ? fixedByModel / disagreements.length : reviewed ? 1 : 0;
      const codeFallback = confidence < CODE_REWORD_BELOW;
      const usage =
        built.fields.propertyUsage === "commercial" || built.fields.propertyUsage === "residential"
          ? built.fields.propertyUsage
          : null;
      const coded: TemplateRewrite[] = [];
      for (const p of codeFallback ? (c.template?.paragraphs ?? []) : []) {
        if ((!p.particulars && !p.heading) || modelKeys.has(p.key)) continue;
        const after = codeUnitRewrite(c, p.text, usage, p.heading === true);
        if (after)
          coded.push({ key: p.key, before: p.text, after, reason: "Unit type and use copied from the unit record" });
      }
      rewrites.push(...coded);
      // A conflict flag is resolved only when its quote names a word code changed (the type or the use); a flag about
      // anything else in the same paragraph (a count, parking) stays.
      const resolved = (f: AgentAnswer["flags"][number]) =>
        f.kind === "conflict" &&
        coded.some((r) => {
          const q = plainQuote(f.quote);
          return (
            q.length > 0 &&
            r.before.toLowerCase().includes(q) &&
            changedWords(r.before, r.after).some((w) => q.includes(w))
          );
        });
      // A disagreement nothing fixed is shown to the approver as a conflict (unless the model already flagged it).
      const fixedKeys = new Set(rewrites.map((r) => r.key));
      const unfixed = disagreements.filter(
        (d) => !fixedKeys.has(d.key) && !a.flags.some((f) => plainQuote(f.quote).includes(d.said.toLowerCase())),
      );
      // One flag per spot: "garage" is already in "two-car garage".
      const spots = unfixed.filter(
        (d) =>
          !unfixed.some(
            (o) =>
              o !== d &&
              o.key === d.key &&
              o.said.length > d.said.length &&
              o.said.toLowerCase().includes(d.said.toLowerCase()),
          ),
      );
      const codeFlags = spots.map((d) => ({
        kind: "conflict" as const,
        quote: d.said,
        reason: `The template says "${d.said}" but the unit record says "${d.record}"; not reworded, check before approving.`,
      }));
      const flags = [...a.flags.filter((f) => !resolved(f)), ...codeFlags].slice(0, 20);
      const resolvedFlags = a.flags.filter(resolved);
      return {
        status: "ok",
        data: {
          fields: built.fields,
          sources: built.sources,
          addendum,
          flags,
          reviewed,
          checks,
          extraClauseIds: extra,
          clauseReasons: a.clauseReasons.filter((r) => added.includes(r.id)),
          ...(rewrites.length ? { rewrites } : {}),
        },
        reasons: [
          ...(reviewed
            ? []
            : [
                `The contract agent (${model.name}) gave no valid answer after one retry, so the contract was prepared by code only: fields from the records, the rule's clauses, no AI review of the wording. Read the wording before approving.`,
              ]),
          ...(disagreements.length
            ? [
                `Model confidence ${Math.round(confidence * 100)}%: it reworded ${fixedByModel} of ${disagreements.length} template line(s) that disagree with the unit record${
                  coded.length ? "; below 30%, so code copied the unit's type and use from the record" : ""
                }`,
              ]
            : []),
          ...checks.map((x) => x.reason),
          ...(skipped.length ? [`Already in the template, not added again: ${skipped.join(", ")}`] : []),
          ...(bad.length
            ? [
                `Not an approved clause of this company, not added: ${bad
                  .slice(0, 5)
                  .map((id) => id.slice(0, 48))
                  .join(", ")}${bad.length > 5 ? ` and ${bad.length - 5} more` : ""}`,
              ]
            : []),
          ...flags.map((f) => `Flag ${f.kind.replace("_", " ")}: "${f.quote}" (${f.reason})`),
          ...(dropped
            ? [`${dropped} item(s) of the model's answer did not fit the answer's shape and were ignored`]
            : []),
          ...(unneeded.length
            ? [`Rewording not used, the paragraph already matches the records: ${[...new Set(unneeded)].join(", ")}`]
            : []),
          ...resolvedFlags.map((f) => `Conflict resolved by the code rewording: "${f.quote}"`),
          ...rewrites.map((r) => `Reworded from the records: "${r.before}" -> "${r.after}" (${r.reason})`),
          ...refused.map((p) => `Rewording refused by code, template wording kept: ${p}`),
        ],
        sourceDocIds: [],
        model: { name: model.name, confidence },
      };
    },
  };
}

function parseJson(text: string): unknown {
  const t = text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "");
  try {
    return JSON.parse(t);
  } catch {
    // Small models wrap the object in prose or a fence: take the outermost {...}.
    const from = t.indexOf("{");
    const to = t.lastIndexOf("}");
    if (from < 0 || to <= from) return null;
    try {
      return JSON.parse(t.slice(from, to + 1));
    } catch {
      return null;
    }
  }
}

/** A flag's quote without the data delimiters, lower case. */
const plainQuote = (q: string) =>
  q
    .replace(/<<<DATA_\w+_(?:START|END)>>>/g, "")
    .trim()
    .toLowerCase();
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : v);
const keep = <T>(items: unknown[], schema: z.ZodType<T>, max: number): T[] =>
  items
    .flatMap((x) => {
      const r = schema.safeParse(x);
      return r.success ? [r.data] : [];
    })
    .slice(0, max);

const ANSWER_KEYS = ["extraClauseIds", "clauseReasons", "flags", "rewrites"] as const;
const ClauseReason = AgentAnswer.shape.clauseReasons.element;
const Rewrite = AgentAnswer.shape.rewrites.unwrap().element;

/**
 * The model's answer, Zod-checked. An object with none of the answer's keys (e.g. `{"error": ""}`) is no answer.
 * Otherwise items that don't fit the shape are dropped one by one (an over-long quote or reason is cut to its limit)
 * instead of losing the whole answer: what is kept is still parsed by the schema.
 */
function parseAnswer(text: string): { success: true; data: AgentAnswer; dropped: number } | { success: false } {
  const raw = parseJson(text);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { success: false };
  const o = raw as Record<string, unknown>;
  if (!ANSWER_KEYS.some((k) => k in o)) return { success: false };
  const strict = AgentAnswer.safeParse(o);
  if (strict.success) return { ...strict, dropped: 0 };
  const salvaged = AgentAnswer.safeParse({
    extraClauseIds: list(o.extraClauseIds)
      .filter((x): x is string => typeof x === "string")
      .slice(0, 30),
    clauseReasons: keep(
      list(o.clauseReasons).map((x) =>
        x && typeof x === "object" ? { ...x, reason: cut((x as { reason?: unknown }).reason, 300) } : x,
      ),
      ClauseReason,
      30,
    ),
    flags: keep(
      list(o.flags).map((x) =>
        x && typeof x === "object"
          ? {
              ...x,
              quote: cut((x as { quote?: unknown }).quote, 500),
              reason: cut((x as { reason?: unknown }).reason, 500),
            }
          : x,
      ),
      AddendumFlag,
      20,
    ),
    rewrites: keep(list(o.rewrites), Rewrite, 10),
  });
  if (!salvaged.success) return { success: false };
  const d = salvaged.data;
  const given = ANSWER_KEYS.reduce((n, k) => n + list(o[k]).length, 0);
  const kept = d.extraClauseIds.length + d.clauseReasons.length + d.flags.length + d.rewrites.length;
  return { success: true, data: d, dropped: Math.max(0, given - kept) };
}
