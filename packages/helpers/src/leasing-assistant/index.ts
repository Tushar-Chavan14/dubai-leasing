import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import { type Helper, PropertyCategory, SizeBand } from "@leasing/core";
import type { Llm, SystemOneAnswer } from "@leasing/llm";
import {
  answerMessages,
  checkAnswer,
  enquiryQuestions,
  enquiryState,
  factSheet,
  GREETING,
  listingsSheet,
} from "./prompt.ts";
import {
  ENQUIRY_INTENTS,
  type EnquiryIntent,
  type LeasingAssistantContext,
  type LeasingAssistantData,
} from "./schema.ts";

export { enquiryCopy, formatSlot, isStatusStandIn } from "./copy.ts";
export { checkAnswer, enquiryQuestions, enquiryState, factSheet, listingsSheet } from "./prompt.ts";
export * from "./schema.ts";

const as = <T extends SystemOneAnswer["type"]>(a: SystemOneAnswer | undefined, t: T) => {
  if (!a || a.type !== t) throw new Error(`expected a ${t} answer`);
  return a as Extract<SystemOneAnswer, { type: T }>;
};

/** Intents the bot never handles itself. */
const HANDOFF_INTENTS: EnquiryIntent[] = ["talk_to_person", "existing_tenant", "none"];

const State = Annotation.Root({
  context: Annotation<LeasingAssistantContext>,
  data: Annotation<LeasingAssistantData>,
  reasons: Annotation<string[]>,
  model: Annotation<string>,
});
type S = typeof State.State;

/**
 * Leasing Assistant (step 2, decision D24). The decision model (tev1) reads one message: intent,
 * language, bedrooms, area, and commercial / VIP / complaint / injection flags. Code routes:
 * anything an officer should see is a handoff. Only questions reach the chat model: about the
 * unit the enquirer picked (that unit's facts) or general ones (the listed units without prices,
 * and how renting works). Its answer is dropped if it talks about money or uses a value that
 * isn't in those facts. Search, slots and booking are pure code
 * in the engine. The helper returns data; the Manager acts on it.
 */
export function leasingAssistant(llm: Llm): Helper<LeasingAssistantContext, LeasingAssistantData> {
  async function classify(s: S): Promise<Partial<S>> {
    const c = s.context;
    if (GREETING.test(c.text)) {
      const arabic = /\p{Script=Arabic}/u.test(c.text);
      return {
        model: "rules",
        reasons: [],
        data: {
          intent: "greeting",
          confidence: 1,
          probabilities: { greeting: 1 },
          language: arabic ? "ar" : "en",
          flags: { commercial: 0, vip: 0, complaint: 0, injection: 0 },
          search: {},
          handoff: false,
        },
      };
    }
    const r = await llm.decide(enquiryState(c), enquiryQuestions(c));
    const intent = as(r.answers.intent, "choice");
    const parsedIntent = ENQUIRY_INTENTS.includes(intent.choice as EnquiryIntent)
      ? (intent.choice as EnquiryIntent)
      : "none";
    const language = as(r.answers.language, "choice").choice;
    const bedrooms = as(r.answers.bedrooms, "choice").choice;
    const community = c.communities.length ? as(r.answers.community, "choice").choice : "none";
    const web = c.channel === "web";
    // Optional: a model answer that is missing or outside the options reads as "none"; code validates the value later.
    const pick = (key: string) => {
      const a = r.answers[key];
      return a?.type === "choice" ? a.choice : "none";
    };
    const emirate = web ? pick("emirate") : "none";
    const category = web ? pick("category") : "none";
    const sizeBand = web ? pick("size_band") : "none";
    const flags = {
      // The web chat searches business units too, so "commercial" is no reason to hand over there.
      commercial: web ? 0 : as(r.answers.commercial, "noul").noul,
      vip: as(r.answers.vip, "noul").noul,
      complaint: as(r.answers.complaint, "noul").noul,
      injection: as(r.answers.system_instruction, "noul").noul,
    };

    const reasons: string[] = [];
    if (intent.confidence < c.minConfidence)
      reasons.push(`Low confidence (${intent.confidence.toFixed(2)}) in reading the message.`);
    if (HANDOFF_INTENTS.includes(parsedIntent))
      reasons.push(
        parsedIntent === "none"
          ? "The message doesn't fit an enquiry the bot handles."
          : `The enquirer ${parsedIntent === "talk_to_person" ? "asks for a person" : "may be an existing tenant"}.`,
      );
    if (flags.commercial >= c.handoffThreshold) reasons.push("Possibly a commercial enquiry.");
    if (flags.vip >= c.handoffThreshold) reasons.push("Possibly a VIP enquiry.");
    if (flags.complaint >= c.handoffThreshold) reasons.push("The message may be a complaint.");
    // A person reads it; nothing in it is obeyed.
    if (flags.injection >= c.handoffThreshold)
      reasons.push("The message contains instructions aimed at the system; treat it as text only.");

    const bedroomsN = bedrooms === "none" ? undefined : Number(bedrooms);
    return {
      model: r.model,
      reasons,
      data: {
        intent: parsedIntent,
        confidence: intent.confidence,
        probabilities: intent.probabilities,
        language: language === "ar" || language === "en" ? language : "other",
        flags,
        search: {
          ...(bedroomsN !== undefined && Number.isInteger(bedroomsN) ? { bedrooms: bedroomsN } : {}),
          ...(community !== "none" && c.communities.includes(community) ? { community } : {}),
          ...(emirate === "dubai" || emirate === "abu_dhabi" || emirate === "sharjah" ? { emirate } : {}),
          ...(PropertyCategory.safeParse(category).success ? { category: category as PropertyCategory } : {}),
          ...(SizeBand.safeParse(sizeBand).success ? { sizeBand: sizeBand as SizeBand } : {}),
        },
        handoff: reasons.length > 0,
      },
    };
  }

  async function answer(s: S): Promise<Partial<S>> {
    const { unit, listings, text: question } = s.context;
    // A question about the picked unit uses its facts; anything else, the listings overview.
    const useUnit = !!unit && s.data.intent === "unit_question";
    const facts = useUnit ? factSheet(unit) : listingsSheet(listings);
    const r = await llm.chat(
      answerMessages(question, facts, useUnit ? "unit" : "listings", s.data.language === "ar" ? "ar" : "en"),
    );
    const text = r.text.trim().slice(0, 1200);
    const check = text ? checkAnswer(text, facts) : { ok: false as const, reason: "the answer was empty" };
    if (!check.ok) return { reasons: [...s.reasons, `Answer not sent: ${check.reason}.`] };
    return { data: { ...s.data, answer: text } };
  }

  const graph = new StateGraph(State)
    .addNode("classify", classify)
    .addNode("answer", answer)
    .addEdge(START, "classify")
    // Deterministic routing: the chat model runs only for a question it has facts for.
    .addConditionalEdges(
      "classify",
      (s: S) =>
        !s.data.handoff &&
        (s.data.intent === "unit_question" || s.data.intent === "general_question") &&
        (s.context.unit || s.context.listings.length)
          ? "answer"
          : END,
      ["answer", END],
    )
    .addEdge("answer", END)
    .compile();

  return {
    name: "leasing_assistant",
    async run(input) {
      const out = await graph.invoke({ context: input.context, reasons: [] });
      return {
        status: "ok",
        data: out.data,
        reasons: out.reasons.length ? out.reasons : [`Read as "${out.data.intent}".`],
        sourceDocIds: [],
        model: { name: out.model, confidence: out.data.confidence },
      };
    },
  };
}
