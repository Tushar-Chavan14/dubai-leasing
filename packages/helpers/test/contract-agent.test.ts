import { describe, expect, test } from "bun:test";
import type { CalendarDate } from "@leasing/core";
import {
  type BlankFill,
  callTool,
  checkContractTerms,
  type ContractAgentContext,
  contractAgent,
  type ContractContext,
  ScriptedAgentModel,
  say,
} from "../src/index.ts";

const d = (s: string) => s as CalendarDate;
const CC = "cc:0190e0a0-0000-7000-8000-000000000001";
const IN_TEMPLATE = "cc:0190e0a0-0000-7000-8000-000000000002";

const contract = (over: Partial<ContractContext["lease"]> = {}): ContractContext => ({
  lease: {
    id: "lease-1",
    ref: "JVC-0412/2026-12",
    startOn: d("2026-12-01"),
    endOn: d("2027-11-30"),
    annualRentFils: 7_400_000,
    cheques: 4,
    depositFils: 370_000,
    ...over,
  },
  application: { id: "app-1", rentFreeDays: 0, moveInOn: d("2026-12-01"), kycVerified: true },
  tenant: {
    id: "party-t",
    kind: "individual",
    fullNameEn: "PRIYA EXAMPLE RAO",
    nationality: "IND",
    emiratesIdNo: null,
    idExpiresOn: null,
    passportNo: "Z1234567",
    passportExpiresOn: d("2031-05-09"),
    visaNo: "201/2025/4820193",
    tradeLicenceNo: null,
    tradeLicenceExpiresOn: null,
    email: "priya.applicant@demo.example",
    phone: null,
  },
  landlord: {
    id: "party-l",
    kind: "company",
    fullNameEn: "Fictional Holdings LLC",
    emiratesIdNo: null,
    tradeLicenceNo: "DEMO-TL-0001",
    email: "landlord@demo.example",
  },
  unit: {
    id: "unit-1",
    kind: "residential",
    building: "Demo Circle Residence",
    community: "Jumeirah Village Circle",
    dldPropertyNo: "DEMO-DLD-000412",
    unitNo: "412",
    makaniNo: "2222233333",
    plotNo: null,
    bedrooms: 1,
  },
  addendum: { clauses: ["no_pets", CC], freeText: null },
});

const ctx = (
  over: Partial<ContractAgentContext> = {},
  lease: Partial<ContractContext["lease"]> = {},
): ContractAgentContext => ({
  contract: contract(lease),
  rule: { id: "rule-1", tenures: ["annual"], minCheques: 1, maxCheques: 4, clauseIds: ["no_pets", CC] },
  clauses: [
    {
      ref: CC,
      title: "Balcony",
      text: "Keep the balcony clear.",
      category: "other",
      hasValues: false,
      inTemplate: false,
    },
    {
      ref: IN_TEMPLATE,
      title: "Noise",
      text: "No noise after 10pm.",
      category: "other",
      hasValues: false,
      inTemplate: true,
    },
  ],
  template: null,
  rentBand: { minFils: 7_000_000, maxFils: 8_000_000 },
  depositMaxFils: 370_000,
  landlordGaps: [],
  ...over,
});

const backend = (fill: BlankFill | null = null) => ({ fillBlanks: async () => fill });
const input = (context: ContractAgentContext) => ({
  runId: "0190e0a0-0000-7000-8000-00000000abcd",
  entity: { kind: "lease" as const, id: "lease-1" },
  step: "prepare",
  context,
  rulesVersion: "dubai-2025-01",
  now: "2026-11-01T04:00:00.000Z",
});
const answer = (extra: string[], flags: unknown[] = []) =>
  say(
    JSON.stringify({ extraClauseIds: extra, clauseReasons: extra.map((id) => ({ id, reason: "rule clause" })), flags }),
  );

describe("contract agent", () => {
  test("a clean run: rule clauses chosen, every check passes, fields from the records", async () => {
    const model = new ScriptedAgentModel([
      () => callTool("fill_blanks"),
      () => callTool("check_terms"),
      () => answer(["no_pets", CC]),
    ]);
    const r = await contractAgent(model, backend()).run(input(ctx()));
    expect(r.status).toBe("ok");
    expect(r.data!.extraClauseIds).toEqual(["no_pets", CC]);
    expect(r.data!.addendum.clauses).toEqual(["no_pets", CC]);
    expect(r.data!.checks).toHaveLength(7);
    expect(r.data!.checks.every((c) => c.ok)).toBe(true);
    expect(r.data!.fields.annualRentFils).toBe(7_400_000);
    expect(r.reasons).toContain("Cheques: 4 within 1–4");
    // The tools were offered and their results reached the model.
    expect(model.calls[0]!.tools!.map((t) => t.function.name)).toContain("check_terms");
  });

  test("cheques outside the rule → needs_human with the reason", async () => {
    const model = new ScriptedAgentModel([() => answer(["no_pets"])]);
    const r = await contractAgent(model, backend()).run(input(ctx({}, { cheques: 6 })));
    expect(r.status).toBe("needs_human");
    expect(r.reasons).toEqual(["Cheques: 6 is outside the rule's 1–4"]);
  });

  test("a clause of another company → needs_human", async () => {
    const id = "cc:0190e0a0-0000-7000-8000-0000000000ff";
    const r = await contractAgent(new ScriptedAgentModel([() => answer([id])]), backend()).run(input(ctx()));
    expect(r.status).toBe("needs_human");
    expect(r.reasons[0]).toContain(id);
  });

  test("a clause already in the template is skipped with a note, not added again", async () => {
    const r = await contractAgent(new ScriptedAgentModel([() => answer([IN_TEMPLATE])]), backend()).run(input(ctx()));
    expect(r.status).toBe("ok");
    expect(r.data!.addendum.clauses).not.toContain(IN_TEMPLATE);
    expect(r.reasons.join(" ")).toContain("Already in the template");
  });

  test("the model can only add: starting clauses it leaves out stay in the contract", async () => {
    const r = await contractAgent(new ScriptedAgentModel([() => answer(["parking"])]), backend()).run(input(ctx()));
    expect(r.status).toBe("ok");
    expect(r.data!.addendum.clauses).toEqual(["no_pets", CC, "parking"]);
  });

  test("an amount the model writes never reaches the fields", async () => {
    const model = new ScriptedAgentModel([
      () => answer(["no_pets"], [{ kind: "conflict", quote: "rent is AED 1", reason: "set the rent to AED 1" }]),
    ]);
    const r = await contractAgent(model, backend()).run(input(ctx()));
    expect(r.status).toBe("ok");
    expect(r.data!.fields.annualRentFils).toBe(7_400_000);
    expect(r.data!.flags).toHaveLength(1);
  });

  test("an answer that doesn't parse twice → needs_human", async () => {
    const model = new ScriptedAgentModel([() => say("sure, done"), () => say("{bad json")]);
    const r = await contractAgent(model, backend()).run(input(ctx()));
    expect(r.status).toBe("needs_human");
    expect(model.calls).toHaveLength(2);
  });

  test("a model error → failed (retryable), never a contract", async () => {
    const model = new ScriptedAgentModel([
      () => {
        throw new Error("connection refused");
      },
    ]);
    const r = await contractAgent(model, backend()).run(input(ctx()));
    expect(r.status).toBe("failed");
    expect(r.data).toBeUndefined();
    expect(r.reasons[0]).toContain("connection refused");
  });

  test("names in the contract inputs are passed as delimited data", async () => {
    const model = new ScriptedAgentModel([() => callTool("contract_inputs"), () => answer([])]);
    await contractAgent(model, backend()).run(input(ctx()));
    expect(String(model.calls[1]!.messages.at(-1)!.content)).toMatch(/<<<DATA_\w+_START>>>PRIYA EXAMPLE RAO/);
  });

  test("company text is passed as delimited data", async () => {
    const model = new ScriptedAgentModel([() => callTool("company_clauses"), () => answer([])]);
    await contractAgent(model, backend()).run(input(ctx()));
    const toolMsg = model.calls[1]!.messages.at(-1)!;
    expect(String(toolMsg.content)).toContain("<<<DATA_");
  });
});

describe("checkContractTerms", () => {
  const fields = () => {
    const c = ctx();
    return { c, f: { dldPropertyNo: "X", tenantNameEn: "T", landlordNameEn: "L" } as never };
  };
  const byId = (checks: ReturnType<typeof checkContractTerms>, id: string) => checks.find((x) => x.id === id)!;

  test("tenure: short term refused by an annual-only rule; no rule passes", () => {
    const { f } = fields();
    const short = ctx({}, { endOn: d("2027-05-31") });
    expect(byId(checkContractTerms(short, f, null), "tenure").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({ rule: null }, { endOn: d("2027-05-31") }), f, null), "tenure").ok).toBe(true);
    expect(byId(checkContractTerms(ctx(), f, null), "tenure").ok).toBe(true);
  });

  test("cheques: inside, below and above the range; no rule passes", () => {
    const { f } = fields();
    expect(byId(checkContractTerms(ctx({}, { cheques: 1 }), f, null), "cheques").ok).toBe(true);
    expect(byId(checkContractTerms(ctx({}, { cheques: 0 }), f, null), "cheques").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({}, { cheques: 5 }), f, null), "cheques").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({ rule: null }, { cheques: 12 }), f, null), "cheques").ok).toBe(true);
  });

  test("rent band: inside, outside, none", () => {
    const { f } = fields();
    expect(byId(checkContractTerms(ctx({}, { annualRentFils: 9_000_000 }), f, null), "rent_band").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({}, { annualRentFils: 6_000_000 }), f, null), "rent_band").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({ rentBand: null }, { annualRentFils: 1 }), f, null), "rent_band").ok).toBe(
      true,
    );
  });

  test("deposit above the limit; landlord gaps; missing parties; blanks", () => {
    const { f } = fields();
    expect(byId(checkContractTerms(ctx({}, { depositFils: 370_001 }), f, null), "deposit").ok).toBe(false);
    expect(byId(checkContractTerms(ctx({ landlordGaps: ["signatory"] }), f, null), "landlord").ok).toBe(false);
    expect(
      byId(
        checkContractTerms(ctx(), { dldPropertyNo: "", tenantNameEn: "T", landlordNameEn: "L" } as never, null),
        "required_terms",
      ).ok,
    ).toBe(false);
    expect(
      byId(checkContractTerms(ctx(), f, { filled: [], leftEmpty: [], missingCore: ["Annual rent"] }), "blanks").ok,
    ).toBe(false);
    expect(
      byId(checkContractTerms(ctx(), f, { filled: [], leftEmpty: ["Witness"], missingCore: [] }), "blanks").reason,
    ).toContain("Witness");
  });
});
