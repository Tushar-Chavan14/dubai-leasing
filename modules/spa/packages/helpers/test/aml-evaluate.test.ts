import { describe, expect, test } from "bun:test";
import { DEFAULT_SPA_AML_POLICY, type SpaAmlPolicy } from "@spa/core";
import { dubaiSales2026_01, type SalesRulebook } from "@spa/rulebook";
import { type AmlSubject, evaluateAml, FAKE_PEPS, FAKE_SANCTIONS, FakeScreening } from "../src/aml/index.ts";

const RB: SalesRulebook = { ...dubaiSales2026_01, pending: [] };
const subject = (o: Partial<AmlSubject> = {}): AmlSubject => ({
  key: "p1",
  partyId: "p1",
  name: "Priya Example Rao",
  kind: "person",
  isParty: true,
  country: "IN",
  sourceOfFundsDeclared: true,
  ownershipLayers: 0,
  cashFils: 0,
  ...o,
});
const run = (s: AmlSubject[], opts: { adapter?: FakeScreening; policy?: SpaAmlPolicy; rb?: SalesRulebook } = {}) =>
  evaluateAml(opts.adapter ?? new FakeScreening(), s, opts.rb ?? RB, opts.policy ?? DEFAULT_SPA_AML_POLICY);
const rules = async (...a: Parameters<typeof run>) => (await run(...a)).results[0]!.hits.map((h) => h.rule);

describe("a name that normalises to nothing (review 16)", () => {
  test.each(["", "   ", "!!! ---", "\u0301\u0302"])("%j is not screened and the adapter is not asked", async (name) => {
    let asked = 0;
    const adapter = new FakeScreening({ failFor: () => (asked++, false) });
    const r = (await run([subject({ name })], { adapter })).results[0]!;
    expect(r.screening).toBeNull();
    expect(r.hits.map((h) => [h.rule, h.severity, h.flags])).toContainEqual(["not_screened", "flag", true]);
    expect(asked).toBe(0);
  });
});

describe("evaluateAml: screening then code rules", () => {
  test("a clean party has no hits and a screening result", async () => {
    const r = (await run([subject()])).results[0]!;
    expect(r.hits).toEqual([]);
    expect(r.screening).toMatchObject({ exact: false });
  });
  test("an exact sanctions name flags", async () => {
    const r = (await run([subject({ name: FAKE_SANCTIONS[0]!.name })])).results[0]!;
    expect(r.hits.map((h) => [h.rule, h.severity, h.flags])).toContainEqual(["sanctions", "flag", true]);
  });
  test("a near match at the rulebook threshold flags and just below does not", async () => {
    const near = "Tavish Orlenko Brey"; // one letter from "Tavish Orlenko-Bray"
    expect(await rules([subject({ name: near })])).toContain("sanctions");
    expect(await rules([subject({ name: near })], { rb: { ...RB, amlNameMatchThreshold: 0.999 } })).not.toContain(
      "sanctions",
    );
  });
  test("a pending name threshold makes the hit unconfirmed (S36), which always flags", async () => {
    const r = (await run([subject()], { rb: { ...RB, pending: ["amlNameMatchThreshold"] } })).results[0]!;
    expect(r.hits.map((h) => [h.rule, h.flags])).toContainEqual(["unconfirmed", true]);
  });
  test("a PEP flags under the default policy and only warns when the policy says warning", async () => {
    const pep = subject({ name: FAKE_PEPS[0]!.name });
    expect((await run([pep])).results[0]!.hits.find((h) => h.rule === "pep")?.flags).toBe(true);
    const lenient: SpaAmlPolicy = {
      ...DEFAULT_SPA_AML_POLICY,
      rules: { ...DEFAULT_SPA_AML_POLICY.rules, pep: { on: true, severity: "warning", points: 10 } },
    };
    const h = (await run([pep], { policy: lenient })).results[0]!.hits.find((x) => x.rule === "pep");
    expect([h?.severity, h?.flags]).toEqual(["warning", false]);
  });
  test("a rule the policy switched off leaves no hit, but sanctions cannot be switched off", async () => {
    const off: SpaAmlPolicy = {
      ...DEFAULT_SPA_AML_POLICY,
      rules: {
        ...DEFAULT_SPA_AML_POLICY.rules,
        pep: { on: false, severity: "flag", points: 0 },
        sanctions: { on: false, severity: "warning", points: 0 },
      },
    };
    const s = [subject({ name: FAKE_PEPS[1]!.name })];
    expect(await rules(s, { policy: off })).not.toContain("pep");
    // The policy schema refuses it; even a hand-built policy cannot make a sanctions hit stop flagging.
    const r = (await run([subject({ name: FAKE_SANCTIONS[1]!.name })], { policy: off })).results[0]!;
    expect(r.hits.find((h) => h.rule === "sanctions")?.flags).toBe(true);
  });
  test("a service that fails leaves the party not screened, which flags", async () => {
    const adapter = new FakeScreening({ failFor: (n) => n === "Priya Example Rao" });
    const r = (await run([subject()], { adapter })).results[0]!;
    expect(r.screening).toBeNull();
    expect(r.hits.map((h) => [h.rule, h.flags])).toContainEqual(["not_screened", true]);
  });
  test("payer, high-risk country, missing source of funds and layers each raise their rule", async () => {
    const policy: SpaAmlPolicy = { ...DEFAULT_SPA_AML_POLICY, highRiskCountries: ["IR"] };
    const hs = await rules(
      [subject({ isParty: false, country: "ir", sourceOfFundsDeclared: false, ownershipLayers: 2 })],
      { policy },
    );
    expect(hs).toEqual(
      expect.arrayContaining([
        "third_party_payer",
        "high_risk_country",
        "missing_source_of_funds",
        "complex_ownership",
      ]),
    );
  });
  test("cash at the threshold raises cash, and a pending threshold with cash is unconfirmed", async () => {
    const withCash = subject({ cashFils: 5_000_000 });
    expect(await rules([withCash], { rb: { ...RB, amlCashThresholdFils: 5_000_000 } })).toContain("cash");
    expect(await rules([withCash], { rb: { ...RB, pending: ["amlCashThresholdFils"] } })).toContain("unconfirmed");
  });
  test("one result per subject, in order, with the subject's key", async () => {
    const r = await run([subject({ key: "a" }), subject({ key: "payer:x", partyId: null, isParty: false })]);
    expect(r.results.map((x) => x.subject.key)).toEqual(["a", "payer:x"]);
  });
});
