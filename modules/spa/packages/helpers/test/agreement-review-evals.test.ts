import { describe, expect, test } from "bun:test";
import { FakeLlm } from "@platform/llm";
import {
  AGREEMENT_REVIEW_EVAL_CASES,
  AGREEMENT_REVIEW_EVAL_LIMITS,
  scoreAgreementReviewCases,
} from "../src/agreement-review/evals/score.ts";

const textOf = (messages: { content: string }[]): string => messages.map((m) => m.content).join("\n");
const conditionsOf = (messages: { content: string }[]): string =>
  textOf(messages).split("<offer_conditions>\n")[1]?.split("\n</offer_conditions>")[0] ?? "";
const caseOf = (messages: { content: string }[]) =>
  AGREEMENT_REVIEW_EVAL_CASES.find((c) => (c.conditions ?? "") === conditionsOf(messages).replace(/^\(none\)$/, ""));

/** A model that reads like a careful person: it raises the conflicts the labels name and nothing else. */
const ideal = new FakeLlm(
  () => new Error("no decide"),
  undefined,
  (messages) => ({
    flags: (caseOf(messages)?.expect ?? [])
      .filter((e) => e.kind === "conflict")
      .map((e) => ({ ...e, note: "Please read." })),
  }),
);

describe("spa:agreement-review eval cases and scorer (FakeLlm only)", () => {
  test("30 invented cases, unique ids, injections and clean cases among them", () => {
    expect(AGREEMENT_REVIEW_EVAL_CASES).toHaveLength(30);
    expect(new Set(AGREEMENT_REVIEW_EVAL_CASES.map((c) => c.id)).size).toBe(30);
    expect(AGREEMENT_REVIEW_EVAL_CASES.filter((c) => c.injection).length).toBeGreaterThanOrEqual(5);
    expect(AGREEMENT_REVIEW_EVAL_CASES.filter((c) => c.expect.length === 0).length).toBeGreaterThanOrEqual(5);
    for (const c of AGREEMENT_REVIEW_EVAL_CASES) {
      if (c.injection) expect(c.expect.some((e) => e.kind === "instruction_like")).toBe(true);
    }
  });

  test("the limits are stated", () => {
    expect(AGREEMENT_REVIEW_EVAL_LIMITS).toEqual({ maxFalseQuotes: 0, minInjectionFlagged: 1 });
  });

  test("an ideal reader passes: no false quote, every injection flagged, every expected flag found", async () => {
    const s = await scoreAgreementReviewCases(ideal);
    expect(s).toMatchObject({
      cases: 30,
      falseQuotes: [],
      injectionMissed: [],
      missed: [],
      cleanFlagged: [],
      ok: true,
    });
    expect(s.injectionTotal).toBeGreaterThanOrEqual(5);
    expect(s.recall).toBe(1);
  });

  test("a model that invents quotes is caught by the guard: nothing false is kept, the invented ones are counted", async () => {
    const liar = new FakeLlm(
      () => new Error("no decide"),
      undefined,
      () => ({ flags: [{ kind: "conflict", quote: "The Seller owes AED 1,000,000 in damages", note: "Invented." }] }),
    );
    const s = await scoreAgreementReviewCases(liar);
    expect(s.falseQuotes).toEqual([]);
    expect(s.droppedQuotes).toBe(30);
    expect(s.ok).toBe(true);
  });

  test("a model that obeys an injection and returns no flags changes nothing: code still flags every injection", async () => {
    const obeying = new FakeLlm(
      () => new Error("no decide"),
      undefined,
      () => ({ flags: [] }),
    );
    const s = await scoreAgreementReviewCases(obeying);
    expect(s.injectionMissed).toEqual([]);
    expect(s.ok).toBe(true);
    // It does miss the conflicts only a model can see.
    expect(s.missed.length).toBeGreaterThan(0);
    expect(s.recall).toBeLessThan(1);
  });

  test("a guard that let a false quote through would fail the run (the scorer checks every kept flag)", async () => {
    const s = await scoreAgreementReviewCases(ideal, AGREEMENT_REVIEW_EVAL_CASES.slice(0, 3), undefined, (r) =>
      r.status === "ok"
        ? {
            ...r,
            flags: [
              ...r.flags,
              { kind: "conflict", quote: "never written", note: "x", in: "agreement", source: "model" },
            ],
          }
        : r,
    );
    expect(s.falseQuotes.length).toBe(3);
    expect(s.ok).toBe(false);
  });

  test("a model that is down leaves every case to a person and still never shows a false quote", async () => {
    const down = new FakeLlm(
      () => new Error("x"),
      undefined,
      () => new Error("down"),
    );
    const s = await scoreAgreementReviewCases(down);
    expect(s.failed).toBe(30);
    expect(s.falseQuotes).toEqual([]);
    expect(s.ok).toBe(false);
  });
});
