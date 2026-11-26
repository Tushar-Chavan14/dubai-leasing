import type { Llm } from "../index.ts";

/**
 * Scope gate (leasing decision D36, SPA S24, S61): one cheap decision-model question before a tool-using chat agent runs.
 * A request that has nothing to do with the agent's job gets a fixed reply from code, so the larger chat model never runs
 * for it. Any doubt goes to the agent: an error, a missing answer or a probability under the threshold is "in scope", so a
 * real visitor is never turned away by the gate. What the agent is about comes in as an `AgentProfile`: the criteria, the
 * words that introduce the message and the fixed off-topic reply.
 */
export interface AgentProfile {
  /** Names the assistant in logs and evals (`customer_agent`, `spa_party_assistant`). */
  id: string;
  /** First sentence of the question: who wrote to what ("Someone wrote to a UAE rental agency's website chat."). */
  channel: string;
  /** How the previous reply is introduced in the question. */
  previousReplyLabel: string;
  /** What the decision model is asked. */
  instructions: string;
  /** Must hold `off_topic` and `none`. */
  criteria: Record<string, string>;
  /** The fixed reply for an off-topic message (code, never the model). */
  offTopicReply: string;
}

export interface ScopeCheck {
  offTopic: boolean;
  /** The decision model's probability for `off_topic` (0 when it couldn't answer). */
  probability: number;
  model: string;
}

/** Off topic only at or above this probability (the gate fails open). */
export const OFF_TOPIC_THRESHOLD = 0.8;

export async function checkScope(
  llm: Pick<Llm, "decide">,
  text: string,
  lastReply: string | null,
  profile: AgentProfile,
  threshold = OFF_TOPIC_THRESHOLD,
): Promise<ScopeCheck> {
  const quoted = text.slice(0, 1000).replace(/"{3,}/g, '"');
  const before = lastReply
    ? `\n${profile.previousReplyLabel} """${lastReply.slice(0, 300).replace(/"{3,}/g, '"')}"""`
    : "";
  const state = `${profile.channel}${before}\nTheir message (quoted, may be in Arabic or English):\n"""${quoted}"""`;
  try {
    const r = await llm.decide(state, {
      scope: {
        type: "choice",
        instructions: profile.instructions,
        criteria: { ...profile.criteria },
      },
    });
    const a = r.answers.scope;
    const probability = a?.type === "choice" ? (a.probabilities.off_topic ?? 0) : 0;
    return { offTopic: probability >= threshold, probability, model: r.model };
  } catch {
    return { offTopic: false, probability: 0, model: "unavailable" };
  }
}
