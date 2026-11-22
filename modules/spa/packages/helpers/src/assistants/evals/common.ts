import { FakeLlm, type SystemOneResponse } from "@platform/llm";
import type { AgentModel } from "@platform/llm/agent";

type BaseMessage = Parameters<AgentModel["respond"]>[0][number];

/** The message a person typed, read back from the fenced human turn the model was shown. */
export function typedText(messages: BaseMessage[]): string {
  const humans = messages.filter((m) => m._getType() === "human");
  const last = String(humans.at(-1)?.content ?? "");
  return last.replace(/^<untrusted>/, "").replace(/<\/untrusted>$/, "");
}

/** The message quoted in a scope-gate question. */
export function quotedText(state: string): string {
  const m = /Their message \(quoted[^)]*\):\n"""([\s\S]*?)"""$/.exec(state);
  return m?.[1] ?? "";
}

/**
 * A decision model for tests: it answers the scope question from the labels (`off` texts get a high off-topic
 * probability), or, with `invert`, the opposite, to prove a scorer notices a bad gate.
 */
export function labelledGate(offTexts: ReadonlySet<string>, invert = false): FakeLlm {
  return new FakeLlm((state): SystemOneResponse => {
    const off = offTexts.has(quotedText(state)) !== invert;
    return {
      model: "fake-decide",
      answers: {
        scope: {
          type: "choice",
          choice: off ? "off_topic" : "none",
          confidence: 0.99,
          probabilities: { off_topic: off ? 0.97 : 0.02, none: off ? 0.03 : 0.98 },
        },
      },
    };
  });
}

/** Share of hits: 1 when there is nothing to hit. */
export const rate = (hit: number, total: number): number => (total ? hit / total : 1);
