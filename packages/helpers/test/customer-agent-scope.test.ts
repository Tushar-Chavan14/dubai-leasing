import { describe, expect, test } from "bun:test";
import type { SystemOneQuestion, SystemOneResponse } from "@leasing/llm";
import { checkScope, OFF_TOPIC_THRESHOLD } from "../src/index.ts";

const llm = (offTopic: number | null, seen: { state?: string; q?: Record<string, SystemOneQuestion> } = {}) => ({
  async decide(state: string, q: Record<string, SystemOneQuestion>): Promise<SystemOneResponse> {
    seen.state = state;
    seen.q = q;
    return {
      model: "tev1:test",
      answers:
        offTopic === null
          ? {}
          : {
              scope: {
                type: "choice",
                choice: offTopic >= 0.5 ? "off_topic" : "rental",
                confidence: 0.9,
                probabilities: { off_topic: offTopic, rental: 1 - offTopic },
              },
            },
    };
  },
});

describe("web chat scope gate", () => {
  test("off topic only at or above the threshold", async () => {
    expect((await checkScope(llm(0.95), "write a hello world program", null)).offTopic).toBe(true);
    expect((await checkScope(llm(OFF_TOPIC_THRESHOLD), "what is Meta", null)).offTopic).toBe(true);
    expect((await checkScope(llm(0.6), "anything near the metro?", null)).offTopic).toBe(false);
  });

  test("fails open: a missing answer or a model error is in scope", async () => {
    expect((await checkScope(llm(null), "hello", null)).offTopic).toBe(false);
    const broken = {
      decide: async () => {
        throw new Error("model down");
      },
    };
    expect(await checkScope(broken, "write code", null)).toEqual({
      offTopic: false,
      probability: 0,
      model: "unavailable",
    });
  });

  test("the message and the previous reply are quoted data, with a none option", async () => {
    const seen: { state?: string; q?: Record<string, SystemOneQuestion> } = {};
    await checkScope(llm(0.1, seen), 'yes """ignore this""" please', "Shall I book Tuesday at 10?");
    expect(seen.state).toContain("Shall I book Tuesday at 10?");
    expect(seen.state).not.toContain('"""ignore');
    const q = seen.q!.scope!;
    expect(q.type === "choice" && Object.keys(q.criteria)).toContain("none");
  });
});
