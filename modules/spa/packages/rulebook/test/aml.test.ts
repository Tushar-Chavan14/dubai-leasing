import { describe, expect, test } from "bun:test";
import { type AmlPartyFacts, amlRules, dubaiSales2026_01 } from "../src/index.ts";
import { confirmed } from "./helpers.ts";

const clean: AmlPartyFacts = {
  partyId: "p1",
  sanctionsExactMatch: false,
  sanctionsScore: 0.1,
  pepScore: 0.1,
  country: "AE",
  isParty: true,
  cashFils: 0,
  sourceOfFundsDeclared: true,
  ownershipLayers: 0,
};
const rules = (over: Partial<AmlPartyFacts>, rb = confirmed()) =>
  amlRules([{ ...clean, ...over }], rb, { highRiskCountries: ["XX"] }).hits.map((h) => h.rule);

describe("amlRules", () => {
  test("a clean party has no hits", () => {
    expect(amlRules([clean], confirmed(), { highRiskCountries: ["XX"] })).toEqual({ hits: [], flagged: false });
  });
  test("an exact sanctions match always flags, even with the threshold pending", () => {
    expect(rules({ sanctionsExactMatch: true }, dubaiSales2026_01)).toContain("sanctions");
  });
  test("similarity at or above the threshold flags; below doesn't", () => {
    expect(rules({ sanctionsScore: 0.9 })).toEqual(["sanctions"]);
    expect(rules({ pepScore: 0.85 })).toEqual(["pep"]);
    expect(rules({ pepScore: 0.84 })).toEqual([]);
  });
  test("a pending threshold fails closed: an unconfirmed hit for a person", () => {
    expect(rules({ pepScore: 0.1 }, dubaiSales2026_01)).toEqual(["unconfirmed"]);
    expect(rules({ cashFils: 1 }, dubaiSales2026_01)).toEqual(["unconfirmed", "unconfirmed"]);
    expect(rules({}, dubaiSales2026_01)).toEqual(["unconfirmed"]);
  });
  test("cash at the threshold flags; one fil below doesn't", () => {
    expect(rules({ cashFils: 5_500_000 })).toEqual(["cash"]);
    expect(rules({ cashFils: 5_499_999 })).toEqual([]);
  });
  test("third-party payer, high-risk country, missing source of funds, layered ownership", () => {
    expect(rules({ isParty: false })).toEqual(["third_party_payer"]);
    expect(rules({ country: "XX" })).toEqual(["high_risk_country"]);
    expect(rules({ sourceOfFundsDeclared: false })).toEqual(["missing_source_of_funds"]);
    expect(rules({ ownershipLayers: 2 })).toEqual(["complex_ownership"]);
    expect(rules({ ownershipLayers: 1 })).toEqual([]);
  });
  test("review #7: a party not screened is a hit, never a silent pass; country codes ignore case", () => {
    expect(rules({ sanctionsScore: null })).toEqual(["not_screened"]);
    expect(rules({ pepScore: null }, dubaiSales2026_01)).toEqual(["not_screened", "unconfirmed"]);
    expect(rules({ country: "xx" })).toEqual(["high_risk_country"]);
  });
});
