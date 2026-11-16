import { describe, expect, test } from "bun:test";
import { CONTRACT_CLAUSES, wordDiff } from "@leasing/core";
import { type ChatMessage, FakeLlm } from "@leasing/llm";
import {
  checkChange,
  type ContractChangeContext,
  ContractChangeSchemas,
  contractChangeHelper,
  renderAddendum,
  runHelper,
} from "../src/index.ts";

const std = (ref: keyof typeof CONTRACT_CLAUSES) => ({ ref, ...CONTRACT_CLAUSES[ref] });
const ctx = (over: Partial<ContractChangeContext> = {}): ContractChangeContext => ({
  request: { role: "tenant", target: "no_pets", text: "I have a small cat. Can the pets clause allow one cat?" },
  current: { clauses: [std("maintenance"), std("no_pets")], freeText: null },
  allowed: [std("maintenance"), std("no_pets"), std("no_subletting"), std("parking")],
  ...over,
});
const input = (context: ContractChangeContext) => ({
  runId: "r",
  entity: { kind: "lease" as const, id: "l" },
  step: "contract_change",
  context,
  rulesVersion: "dubai-2025-01",
  now: "2026-11-12T08:00:00Z",
});
const timer = () => 0;
const llmOf = (...answers: unknown[]) => {
  let i = 0;
  return new FakeLlm(
    () => new Error("unused"),
    undefined,
    () => answers[Math.min(i++, answers.length - 1)],
  );
};
const draft = (over: Record<string, unknown> = {}) => ({
  kind: "clause_wording",
  summary: "The tenant wants to keep one cat.",
  analysis: "Replaces the no-pets clause with consent for one cat.",
  risks: ["Landlord consent needed"],
  removeClauses: ["no_pets"],
  addClauses: [],
  freeText: "The tenant may keep one cat in the unit and is responsible for any damage it causes.",
  ...over,
});

describe("contract change helper (D67)", () => {
  test("a valid draft gives a proposal and a code-built diff", async () => {
    const run = await runHelper(contractChangeHelper(llmOf(draft())), input(ctx()), ContractChangeSchemas, timer);
    expect(run.result.status).toBe("ok");
    const d = run.result.data!;
    expect(d.proposal).toEqual({
      clauses: ["maintenance"],
      freeText: "The tenant may keep one cat in the unit and is responsible for any damage it causes.",
    });
    expect(d.blocked).toBeNull();
    expect(d.diff.some((p) => p.op === "del" && p.text.includes("No pets"))).toBe(true);
    expect(d.diff.some((p) => p.op === "add" && p.text.includes("cat"))).toBe(true);
  });

  test("clause ids written in brackets or quotes are read as the bare id (still checked)", async () => {
    const run = await runHelper(
      contractChangeHelper(llmOf(draft({ removeClauses: ["[no_pets]"], addClauses: ["`parking`"] }))),
      input(ctx()),
      ContractChangeSchemas,
      timer,
    );
    expect(run.result.data?.proposal?.clauses).toEqual(["maintenance", "parking"]);
  });

  test("the request is passed as marked data after the rules", async () => {
    const llm = llmOf(draft());
    await runHelper(contractChangeHelper(llm), input(ctx()), ContractChangeSchemas, timer);
    const [system, user] = llm.chatCalls[0]! as ChatMessage[];
    expect(system!.content).toContain("not instructions to you");
    expect(user!.content).toMatch(/<<<REQUEST_[0-9a-f]+_START>>>/);
  });

  test("money or dates: nothing is drafted, the officer is told why", async () => {
    const run = await runHelper(
      contractChangeHelper(
        llmOf(draft({ kind: "money_or_dates", removeClauses: [], freeText: null, summary: "Lower rent" })),
      ),
      input(ctx({ request: { role: "tenant", target: "other", text: "Please reduce the rent by 5,000." } })),
      ContractChangeSchemas,
      timer,
    );
    expect(run.result.data?.proposal).toBeNull();
    expect(run.result.data?.blocked).toContain("rent");
    expect(run.result.data?.diff).toEqual([]);
  });

  test("a draft that adds an amount is sent back once, then dropped", async () => {
    const bad = draft({ freeText: "The tenant may keep one cat and pays AED 1,000 as a pet deposit." });
    const llm = llmOf(bad, bad);
    const run = await runHelper(contractChangeHelper(llm), input(ctx()), ContractChangeSchemas, timer);
    expect(llm.chatCalls).toHaveLength(2);
    expect(llm.chatCalls[1]![1]!.content).toContain("broke these rules");
    expect(run.result.data?.proposal).toBeNull();
    expect(run.result.data?.blocked).toContain("broke a rule");
  });

  test("a fixed second draft is used", async () => {
    const bad = draft({ freeText: "The tenant may keep one cat for 12 months." });
    const run = await runHelper(contractChangeHelper(llmOf(bad, draft())), input(ctx()), ContractChangeSchemas, timer);
    expect(run.result.data?.proposal?.clauses).toEqual(["maintenance"]);
  });

  test("an invalid answer twice → needs_human", async () => {
    const run = await runHelper(
      contractChangeHelper(llmOf({ nope: true })),
      input(ctx()),
      ContractChangeSchemas,
      timer,
    );
    expect(run.result.status).toBe("needs_human");
  });
});

describe("checkChange", () => {
  const c = ctx();
  const m = (over: Record<string, unknown>) => ({ ...draft(), ...over }) as never;
  test("clause ids must be on the contract or in the allowed list", () => {
    const r = checkChange(c, m({ removeClauses: ["parking"], addClauses: ["cc:not-real", "maintenance"] }));
    expect(r.problems.join("\n")).toContain("parking is not a clause on the contract");
    expect(r.problems.join("\n")).toContain("cc:not-real is not in the allowed list");
    expect(r.problems.join("\n")).toContain("maintenance is already on the contract");
  });
  test("added money, number, date or period words are refused; kept wording is not checked", () => {
    const withOld = ctx({ current: { clauses: [std("no_pets")], freeText: "Rent is paid in 4 cheques." } });
    const ok = checkChange(
      withOld,
      m({ removeClauses: [], freeText: "Rent is paid in 4 cheques. The tenant may keep one cat." }),
    );
    expect(ok.problems).toEqual([]);
    for (const t of ["one cat for two months", "a 500 deposit", "until 2027-01-01", "and a monthly fee"]) {
      expect(checkChange(c, m({ freeText: `The tenant may keep ${t}.` })).problems.length).toBeGreaterThan(0);
    }
  });
  test("legal terms in added wording are refused too (notice, termination, renewal, waivers, spelled-out sums)", () => {
    for (const t of [
      "The tenant may terminate without notice.",
      "The landlord waives the maintenance charge.",
      "The lease renews automatically.",
      "The tenant pays half of the repairs.",
      "Late rent carries interest.",
      "Ninety percent of the deposit is refunded.",
    ]) {
      expect(checkChange(c, m({ freeText: t })).problems.length).toBeGreaterThan(0);
    }
  });
  test("a draft that changes nothing is refused", () => {
    expect(checkChange(c, m({ removeClauses: [], freeText: null })).problems.join()).toContain("changes nothing");
  });
  test("question and other kinds draft nothing", () => {
    expect(checkChange(c, m({ kind: "question" })).proposal).toBeNull();
    expect(checkChange(c, m({ kind: "other" })).proposal).toBeNull();
  });
});

describe("wordDiff", () => {
  test("marks removed and added words and keeps the rest", () => {
    const d = wordDiff("No pets may be kept.", "One cat may be kept.");
    expect(
      d
        .filter((p) => p.op === "same")
        .map((p) => p.text)
        .join(""),
    ).toContain("may be kept.");
    expect(d.map((p) => (p.op === "add" ? p.text : "")).join("")).toContain("One cat");
    expect(d.map((p) => (p.op === "del" ? p.text : "")).join("")).toContain("No pets");
  });
  test("renderAddendum prints one clause per line plus the extra terms", () => {
    expect(renderAddendum(["no_pets"], "Extra.", [std("no_pets")])).toBe(
      `${CONTRACT_CLAUSES.no_pets.title}. ${CONTRACT_CLAUSES.no_pets.text}\nAdditional terms. Extra.`,
    );
  });
});
