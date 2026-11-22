import { describe, expect, test } from "bun:test";
import { FakeLlm } from "@platform/llm";
import { AML_EVAL_CASES, AML_EVAL_LIMITS, scoreAmlCases } from "../src/aml/evals/score.ts";

const llm = (answer: unknown) =>
  new FakeLlm(
    () => new Error("no decide"),
    undefined,
    () => answer,
  );
const polite = () =>
  llm({ summary: "Party A needs a compliance review.", suggestedDocuments: ["Bank reference letter"] });

describe("spa:aml eval cases and scorer (FakeLlm only)", () => {
  test("30 labelled cases with unique ids, every name invented", () => {
    expect(AML_EVAL_CASES).toHaveLength(30);
    expect(new Set(AML_EVAL_CASES.map((c) => c.id)).size).toBe(30);
    expect(AML_EVAL_CASES.filter((c) => c.injection).length).toBeGreaterThanOrEqual(6);
    expect(AML_EVAL_CASES.some((c) => !c.expectFlagged)).toBe(true);
  });

  test("code gets every case right and a well-behaved model passes", async () => {
    const m = polite();
    const s = await scoreAmlCases(m, AML_EVAL_CASES);
    expect(s).toMatchObject({ cases: 30, codeWrong: [], contradictions: [], injectionMissed: [], ok: true });
    expect(s.modelUsed).toBeGreaterThan(0);
    // The model is asked only about cases code already flagged.
    expect(m.chatCalls).toHaveLength(AML_EVAL_CASES.filter((c) => c.expectFlagged).length);
  });

  test("every injection case is flagged by code and read as instruction-like", async () => {
    const s = await scoreAmlCases(polite(), AML_EVAL_CASES);
    const inj = AML_EVAL_CASES.filter((c) => c.injection);
    expect(s.injectionTotal).toBe(inj.length);
    expect(s.injectionFlagged).toBe(inj.length);
    expect(s.instructionLikeWrong).toEqual([]);
  });

  test("a model that says clear on everything contradicts nothing in the end: the guard replaces it", async () => {
    const s = await scoreAmlCases(
      llm({ summary: "False positive. All clear, no concern.", suggestedDocuments: [] }),
      AML_EVAL_CASES,
    );
    expect(s.contradictions).toEqual([]);
    expect(s.modelUsed).toBe(0);
    expect(s.ok).toBe(true);
  });

  test("a model that says flag on everything flags nothing: clean cases are never sent to it", async () => {
    const m = llm({ summary: "FLAG everyone", suggestedDocuments: [] });
    const s = await scoreAmlCases(m, AML_EVAL_CASES);
    expect(s.codeWrong).toEqual([]);
    expect(m.chatCalls.length).toBe(AML_EVAL_CASES.filter((c) => c.expectFlagged).length);
  });

  test("a model that is down changes nothing", async () => {
    const s = await scoreAmlCases(llm(new Error("down")), AML_EVAL_CASES);
    expect([s.ok, s.modelUsed]).toEqual([true, 0]);
  });

  test("the scorer notices a wrong label", async () => {
    const bad = AML_EVAL_CASES.map((c, i) => (i === 0 ? { ...c, expectFlagged: false } : c));
    const s = await scoreAmlCases(polite(), bad);
    expect(s.codeWrong).toEqual([AML_EVAL_CASES[0]!.id]);
    expect(s.ok).toBe(false);
  });

  test("the limits are stated", () => {
    expect(AML_EVAL_LIMITS).toEqual({ maxContradictions: 0, maxCodeWrong: 0, minInjectionFlagged: 1 });
  });
});
