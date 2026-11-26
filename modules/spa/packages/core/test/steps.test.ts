import { describe, expect, test } from "bun:test";
import { DEAL_STATES, dealMachine, type DealFacts, type DealState, type DealType } from "../src/index.ts";
import { stepsFor, type StepFlags } from "../src/steps.ts";

const NONE: StepFlags = { sellerMortgage: false, buyerMortgage: false, planTakenOver: false };
const TYPES: DealType[] = ["primary_offplan", "resale_ready", "resale_offplan"];
const FLAG_SETS: StepFlags[] = [
  NONE,
  { ...NONE, buyerMortgage: true },
  { ...NONE, sellerMortgage: true },
  { ...NONE, planTakenOver: true },
  { sellerMortgage: true, buyerMortgage: true, planTakenOver: true },
];

/** The states a deal of this type can reach, walking the machine with every fact true (and no open compliance flag). */
function reachable(type: DealType, flags: StepFlags): Set<DealState> {
  const facts = Object.fromEntries(
    Object.entries({
      type,
      ...flags,
      documentsRequested: true,
      kycOk: true,
      companyChecksOk: true,
      hasCompanyParty: true,
      ownershipOk: true,
      openAmlFlag: false,
      amlFlaggedByRule: true,
      agreementPrepared: true,
      allSigned: true,
      depositRecorded: true,
      nocOk: true,
      bankLettersConfirmed: true,
      statementBalanced: true,
      transferIssued: true,
      oqoodIssued: true,
      instalmentsPaid: true,
      handoverRecorded: true,
      priceCleared: true,
    }),
  ) as unknown as DealFacts;
  const seen = new Set<DealState>([dealMachine.initial]);
  const queue: DealState[] = [dealMachine.initial];
  while (queue.length) {
    const from = queue.shift()!;
    for (const t of dealMachine.transitions) {
      if (t.from !== from || seen.has(t.to)) continue;
      if (t.guard && !t.guard(facts).ok) continue;
      seen.add(t.to);
      queue.push(t.to);
    }
  }
  return seen;
}

describe("stepsFor: each deal type has its own steps (design §4.3, §6.2)", () => {
  const keys = (type: DealType, f: Partial<StepFlags> = {}) => stepsFor(type, { ...NONE, ...f }).map((s) => s.key);
  test("primary: Oqood and instalments, no NOC, banks or settlement", () => {
    expect(keys("primary_offplan")).toEqual([
      "offer",
      "parties",
      "agreement",
      "legal",
      "signing",
      "registration",
      "instalments",
    ]);
  });
  test("ready resale: NOC, settlement, transfer; banks only with a mortgage; no Oqood", () => {
    expect(keys("resale_ready")).toEqual([
      "offer",
      "parties",
      "agreement",
      "legal",
      "signing",
      "noc",
      "settlement",
      "transfer",
    ]);
    expect(keys("resale_ready", { buyerMortgage: true })).toContain("finance");
    expect(keys("resale_ready", { sellerMortgage: true })).toContain("finance");
    expect(keys("resale_ready")).not.toContain("registration");
  });
  test("off-plan resale: instalments only with a taken-over plan", () => {
    expect(keys("resale_offplan")).not.toContain("instalments");
    expect(keys("resale_offplan", { planTakenOver: true }).at(-1)).toBe("instalments");
  });
  test("a taken-over plan adds instalments to an off-plan resale only", () => {
    expect(keys("resale_ready", { planTakenOver: true })).not.toContain("instalments");
  });
  test("labels are staff words and never an AML word", () => {
    const all = TYPES.flatMap((t) => FLAG_SETS.flatMap((f) => stepsFor(t, f).map((s) => s.label)));
    expect(all).toContain("Preparing the agreement");
    expect(all).toContain("Developer NOC");
    expect(all.join(" ")).not.toMatch(/aml|screen|sanction|pep|edd|risk/i);
  });
});

describe("stepsFor against the deal machine", () => {
  test("every state is a step in some type's list, except the three end states", () => {
    const covered = new Set<DealState>();
    for (const t of TYPES)
      for (const f of FLAG_SETS) for (const s of stepsFor(t, f)) for (const x of s.states) covered.add(x);
    const missing = DEAL_STATES.filter((s) => !covered.has(s));
    expect(missing.toSorted()).toEqual(["CANCELLED", "COMPLETED", "HANDED_OVER"]);
  });
  test("no type lists a step it cannot reach", () => {
    for (const t of TYPES)
      for (const f of FLAG_SETS) {
        const can = reachable(t, f);
        for (const s of stepsFor(t, f)) expect(s.states.some((x) => can.has(x))).toBe(true);
      }
  });
  test("and a type lists every step it can reach", () => {
    for (const t of TYPES)
      for (const f of FLAG_SETS) {
        const listed = new Set(stepsFor(t, f).flatMap((s) => s.states));
        for (const st of reachable(t, f))
          if (!["HANDED_OVER", "COMPLETED", "CANCELLED"].includes(st)) expect(listed.has(st)).toBe(true);
      }
  });
});
