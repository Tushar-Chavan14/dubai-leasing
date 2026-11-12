import { AIMessage, type BaseMessage, HumanMessage, SystemMessage, ToolMessage } from "@langchain/core/messages";
import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { CONTRACT_CLAUSES, type Helper } from "@leasing/core";
import { z } from "zod";
import { buildContractFields } from "../contract/fields.ts";
import type { AgentModel, ModelTurn, ToolSpec } from "../customer-agent/index.ts";
import { checkContractTerms, checkRewrite, safeReason } from "./checks.ts";
import { asData, contractAgentSystem } from "./prompt.ts";
import {
  AgentAnswer,
  type BlankFill,
  ContractAgentContext,
  ContractAgentData,
  type TemplateRewrite,
} from "./schema.ts";

export { checkContractTerms, checkRewrite, describesUnit, factNumbers, safeReason, statedNumbers } from "./checks.ts";
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
});

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
  company_clauses: "The company's approved clauses (ref, title, text, inTemplate).",
  template:
    "The company template's paragraphs with {{bN}} blanks (rewritable: may be reworded from unit_facts), or null for the standard contract.",
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
            return c.clauses.map((x) => ({ ...x, title: asData(x.title, nonce), text: asData(x.text, nonce) }));
          case "template":
            return c.template
              ? {
                  version: c.template.version,
                  paragraphs: c.template.paragraphs.map((p) => ({
                    key: p.key,
                    text: asData(p.text, nonce),
                    rewritable: p.rewritable === true,
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
      let answer: AgentAnswer | null = null;
      let failed = false;

      const agent = async (s: typeof State.State) => {
        const limit = s.calls >= MAX_CONTRACT_AGENT_CALLS;
        const messages = limit
          ? [...s.messages, new SystemMessage("Tool limit reached. Answer with the JSON now.")]
          : s.messages;
        const turn: ModelTurn = await model.respond(
          messages,
          limit ? null : specs,
          () => {},
          AbortSignal.timeout(MODEL_TURN_TIMEOUT_MS),
        );
        if (!limit && turn.toolCalls.length) {
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
        const parsed = AgentAnswer.safeParse(parseJson(turn.content));
        if (parsed.success) {
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
        const out = calls.map((call, i) => {
          const name = call.name as (typeof TOOL_NAMES)[number];
          const content = TOOL_NAMES.includes(name)
            ? JSON.stringify(tool(name))
            : JSON.stringify({ error: `there is no tool named ${call.name}` });
          return new ToolMessage({ content, tool_call_id: call.id ?? `call_${s.calls + i}`, name: call.name });
        });
        return { messages: out, calls: calls.length };
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
              new HumanMessage(`Prepare the contract for lease ${c.contract.lease.ref}.`),
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
      const a = answer as AgentAnswer | null;
      if (!a) {
        return {
          status: "needs_human",
          reasons: ["The contract agent did not give a valid answer after one retry."],
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
      // Code decides what is allowed: standard clause ids and approved company clauses not already in the template.
      // The model can only add: the starting clauses (the rule's, or the ones staff chose) always stay.
      const inTemplate = new Set(c.clauses.filter((x) => x.inTemplate).map((x) => x.ref));
      const allowed = new Set([
        ...Object.keys(CONTRACT_CLAUSES),
        ...c.clauses.filter((x) => !x.inTemplate).map((x) => x.ref),
      ]);
      const skipped = a.extraClauseIds.filter((id) => inTemplate.has(id));
      const added = a.extraClauseIds.filter((id) => !inTemplate.has(id));
      const bad = added.filter((id) => !allowed.has(id));
      if (bad.length) {
        return {
          status: "needs_human",
          reasons: [`The contract agent chose clauses that are not approved for this company: ${bad.join(", ")}.`],
          sourceDocIds: [],
          model: { name: model.name },
        };
      }
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
      for (const r of a.rewrites) {
        if (rewrites.some((x) => x.key === r.key)) continue;
        const chk = checkRewrite(c, r);
        if (chk.problems.length || chk.before === null) refused.push(...chk.problems);
        else rewrites.push({ key: r.key, before: chk.before, after: r.text.trim(), reason: safeReason(r.reason) });
      }
      return {
        status: "ok",
        data: {
          fields: built.fields,
          sources: built.sources,
          addendum,
          flags: a.flags,
          reviewed: true,
          checks,
          extraClauseIds: extra,
          clauseReasons: a.clauseReasons.filter((r) => added.includes(r.id)),
          ...(rewrites.length ? { rewrites } : {}),
        },
        reasons: [
          ...checks.map((x) => x.reason),
          ...(skipped.length ? [`Already in the template, not added again: ${skipped.join(", ")}`] : []),
          ...a.flags.map((f) => `Flag ${f.kind.replace("_", " ")}: "${f.quote}" (${f.reason})`),
          ...rewrites.map((r) => `Reworded from the records: "${r.before}" -> "${r.after}" (${r.reason})`),
          ...refused.map((p) => `Rewording refused by code, template wording kept: ${p}`),
        ],
        sourceDocIds: [],
        model: { name: model.name },
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
    return null;
  }
}
