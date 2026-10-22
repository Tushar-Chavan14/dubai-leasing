import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { Helper } from "@leasing/core";
import type { Llm, SystemOneAnswer } from "@leasing/llm";
import { ackMessages, checkAck, complaintQuestions, complaintState, templateAck } from "./prompt.ts";
import {
  COMPLAINT_CATEGORIES,
  type ComplaintCategory,
  type ComplaintTriageContext,
  type ComplaintTriageData,
} from "./schema.ts";

export { checkAck, complaintQuestions, complaintState, templateAck } from "./prompt.ts";
export * from "./schema.ts";

const as = <T extends SystemOneAnswer["type"]>(a: SystemOneAnswer | undefined, t: T) => {
  if (!a || a.type !== t) throw new Error(`expected a ${t} answer`);
  return a as Extract<SystemOneAnswer, { type: T }>;
};

type Partial0 = Omit<ComplaintTriageData, "acknowledgement" | "ackSource">;
const State = Annotation.Root({
  context: Annotation<ComplaintTriageContext>,
  triage: Annotation<Partial0>,
  ack: Annotation<{ text: string; source: "model" | "template" }>,
  reasons: Annotation<string[]>,
  model: Annotation<string>,
});
type S = typeof State.State;

/**
 * Complaint Triage (step 8, architecture §6, decision D28). The decision model (tev1) reads the
 * report: category, urgency (0–3), safety risk, legal threat, instructions to the system,
 * language. Code routes: "anyone at risk" ticked, a safety risk or a legal threat → escalate to a
 * person at once; no fitting category, low confidence or injected instructions → a person
 * triages; otherwise a maintenance ticket. The chat model writes the tenant's acknowledgement
 * from the category and urgency band only (never the tenant's text); a check drops any time,
 * number, money or promise, and then a fixed template is used. Returns data; the Manager acts.
 */
export function complaintTriage(llm: Llm): Helper<ComplaintTriageContext, ComplaintTriageData> {
  async function classify(s: S): Promise<Partial<S>> {
    const c = s.context;
    const r = await llm.decide(complaintState(c), complaintQuestions);
    const cat = as(r.answers.category, "choice");
    const category = (COMPLAINT_CATEGORIES as readonly string[]).includes(cat.choice)
      ? (cat.choice as ComplaintCategory)
      : "none";
    const urgency = Math.max(0, Math.min(3, Math.round(as(r.answers.urgency, "score").score)));
    const safety = as(r.answers.safety, "noul").noul;
    const legalThreat = as(r.answers.legal_threat, "noul").noul;
    const injection = as(r.answers.system_instruction, "noul").noul;
    const lang = as(r.answers.language, "choice").choice;
    const reasons: string[] = [];
    if (c.atRisk) reasons.push("The tenant ticked 'someone is at risk'.");
    if (safety >= c.safetyThreshold) reasons.push(`Possible safety risk (${safety.toFixed(2)}).`);
    if (legalThreat >= c.legalThreshold) reasons.push(`Possible legal threat (${legalThreat.toFixed(2)}).`);
    const escalate = reasons.length > 0;
    if (!escalate) {
      if (injection >= c.injectionThreshold)
        reasons.push("The report contains instructions aimed at the system; a person reads it.");
      if (category === "none") reasons.push("No maintenance category fits; a person triages it.");
      else if (cat.confidence < c.minConfidence)
        reasons.push(`Low confidence (${cat.confidence.toFixed(2)}) in the category.`);
    }
    const route = escalate ? "escalate" : reasons.length ? "review" : "ticket";
    return {
      model: r.model,
      reasons,
      triage: {
        category,
        categoryConfidence: cat.confidence,
        probabilities: cat.probabilities,
        // A ticked "at risk" or a safety risk is at least "same day".
        urgency: c.atRisk || safety >= c.safetyThreshold ? Math.max(urgency, 2) : urgency,
        safety,
        legalThreat,
        injection,
        language: lang === "ar" || lang === "en" ? lang : "other",
        route,
      },
    };
  }

  async function acknowledge(s: S): Promise<Partial<S>> {
    const t = s.triage;
    const language = t.language === "ar" ? "ar" : "en";
    try {
      const r = await llm.chat(ackMessages({ category: t.category, urgency: t.urgency, route: t.route, language }));
      const text = r.text.trim();
      const check = checkAck(text);
      if (check.ok) return { ack: { text, source: "model" } };
      return {
        ack: { text: templateAck({ route: t.route, language }), source: "template" },
        reasons: [...s.reasons, `Acknowledgement replaced by the template: ${check.reason}.`],
      };
    } catch {
      return { ack: { text: templateAck({ route: t.route, language }), source: "template" } };
    }
  }

  const graph = new StateGraph(State)
    .addNode("classify", classify)
    .addNode("acknowledge", acknowledge)
    .addEdge(START, "classify")
    .addEdge("classify", "acknowledge")
    .addEdge("acknowledge", END)
    .compile();

  return {
    name: "complaint_triage",
    async run(input) {
      const out = await graph.invoke({ context: input.context, reasons: [] });
      return {
        status: "ok",
        data: { ...out.triage, acknowledgement: out.ack.text, ackSource: out.ack.source },
        reasons: out.reasons.length ? out.reasons : [`Read as ${out.triage.category}, urgency ${out.triage.urgency}.`],
        sourceDocIds: [],
        model: { name: out.model, confidence: out.triage.categoryConfidence },
      };
    },
  };
}
