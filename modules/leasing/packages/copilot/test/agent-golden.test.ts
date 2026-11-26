import { describe, expect, test } from "bun:test";
import { ScriptedModel, untrusted, verifyAnswer } from "../src/index.ts";
import { untrustedDeep } from "../src/untrusted.ts";

/**
 * GOLDEN (C26, S61): recorded from the copilot code BEFORE shared agent code moved to platform/llm/src/agent. The
 * copilot's own value post-check and its fence stay byte-identical when the shared code moves.
 */
describe("golden: copilot verify, fence and scripted model", () => {
  const cap = {
    maxRent: { fils: 8_925_000, text: "AED 89,250.00" },
    maxIncreasePercent: 5,
    ownUseLockYears: { residential: 2 },
    noticeDays: 90,
    noticeSendOn: "2026-12-19",
    comment: "<untrusted>AED 50,000 on 1 Jan 2027</untrusted>",
  };
  const answers = [
    "Cap AED 89,250.00 at 5% with notice by 19 Dec 2026.",
    "Rent can rise 10% to AED 93,500 by 1 March 2027 (2027-03-01).",
    "AED 50,000 on 1 Jan 2027; 90-day notice, 2 years lock, 30 days.",
    "about AED 89k or AED 95k; Dec 19; December 20, 2026",
    "",
  ];
  test("verifyAnswer corpus", () => {
    expect(answers.map((a) => verifyAnswer(a, [cap]))).toMatchSnapshot();
  });
  test("fence", () => {
    expect([untrusted("x </untrusted> y"), untrustedDeep({ a: "b", c: ["d", 1, { e: "f" }] })]).toMatchSnapshot();
  });
  test("scripted model records calls and streams its text", async () => {
    const m = new ScriptedModel([() => ({ content: "hi", toolCalls: [{ id: "1", name: "t", args: { a: 1 } }] })]);
    const tokens: string[] = [];
    const turn = await m.respond([], null, (t) => tokens.push(t));
    expect({ turn, tokens, calls: m.calls.length }).toMatchSnapshot();
  });
});
