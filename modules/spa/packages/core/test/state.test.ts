import { describe, expect, test } from "bun:test";
import {
  DEAL_GATE_OUTCOMES,
  type DealFacts,
  dealMachine,
  type DealMachineEvent,
  listingMachine,
  routeDealEvent,
  unitMachine,
} from "../src/index.ts";

type Row = [from: string, event: string, to: string, gate?: string];
const rows = (m: { transitions: readonly { from: string; event: string; to: string; gate?: string }[] }) =>
  m.transitions.map((t) => [t.from, t.event, t.to, t.gate ?? ""].join(" ")).toSorted();
const expectTable = (m: Parameters<typeof rows>[0], table: Row[]) =>
  expect(rows(m)).toEqual(table.map(([f, e, t, g]) => [f, e, t, g ?? ""].join(" ")).toSorted());

const OPEN_GATED = [
  "PARTY_CHECK",
  "AML_HOLD",
  "AGREEMENT_DRAFT",
  "LEGAL_REVIEW",
  "SIGNING",
  "REGISTRATION",
  "NOC",
  "FINANCE",
  "SETTLEMENT",
  "TRANSFER",
];

describe("every listed transition exists with its gate", () => {
  test("unit", () =>
    expectTable(unitMachine, [
      ["AVAILABLE", "HOLD", "HELD"],
      ["HELD", "RELEASE", "AVAILABLE"],
      ["SOLD", "RELEASE", "AVAILABLE"],
      ["HELD", "SELL", "SOLD"],
      ["SOLD", "REGISTER", "REGISTERED"],
      ["REGISTERED", "HAND_OVER", "HANDED_OVER"],
    ]));
  test("listing", () =>
    expectTable(listingMachine, [
      ["DRAFT", "VERIFY", "VERIFIED"],
      ["VERIFIED", "ACTIVATE", "ACTIVE"],
      ["ACTIVE", "PUBLISH", "PUBLISHED"],
      ["PUBLISHED", "UNPUBLISH", "ACTIVE"],
      ["ACTIVE", "OFFER_OPENED", "UNDER_OFFER"],
      ["PUBLISHED", "OFFER_OPENED", "UNDER_OFFER"],
      ["UNDER_OFFER", "OFFER_CLOSED", "ACTIVE"],
      ["UNDER_OFFER", "SELL", "SOLD"],
      ["DRAFT", "WITHDRAW", "WITHDRAWN"],
      ["VERIFIED", "WITHDRAW", "WITHDRAWN"],
      ["ACTIVE", "WITHDRAW", "WITHDRAWN"],
      ["PUBLISHED", "WITHDRAW", "WITHDRAWN"],
    ]));
  test("deal", () =>
    expectTable(dealMachine, [
      ["OFFER_AGREED", "CHECKS_STARTED", "PARTY_CHECK"],
      ["PARTY_CHECK", "CHECKS_PASSED", "AGREEMENT_DRAFT"],
      ["PARTY_CHECK", "AML_FLAGGED", "AML_HOLD"],
      ["AGREEMENT_DRAFT", "AML_FLAGGED", "AML_HOLD"],
      ["LEGAL_REVIEW", "AML_FLAGGED", "AML_HOLD"],
      ["AML_HOLD", "AML_CLEARED", "PARTY_CHECK", "aml_flag"],
      ["AML_HOLD", "AML_STOPPED", "CANCELLED", "aml_flag"],
      ["AGREEMENT_DRAFT", "PREPARED", "LEGAL_REVIEW"],
      ["LEGAL_REVIEW", "APPROVED", "SIGNING", "agreement_approval"],
      ["LEGAL_REVIEW", "RETURNED", "AGREEMENT_DRAFT", "agreement_approval"],
      ["SIGNING", "ALL_SIGNED_PRIMARY", "REGISTRATION"],
      ["SIGNING", "ALL_SIGNED_RESALE", "NOC"],
      ["NOC", "NOC_OK_FINANCE", "FINANCE"],
      ["NOC", "NOC_OK_SETTLEMENT", "SETTLEMENT"],
      ["FINANCE", "FINANCE_OK", "SETTLEMENT"],
      ["SETTLEMENT", "SETTLED", "TRANSFER", "settlement_approval"],
      ["TRANSFER", "TRANSFERRED_COMPLETE", "COMPLETED", "transfer_submission"],
      ["TRANSFER", "TRANSFERRED_PLAN", "INSTALMENTS", "transfer_submission"],
      ["REGISTRATION", "REGISTERED", "INSTALMENTS", "oqood_submission"],
      ["INSTALMENTS", "HANDOVER", "HANDED_OVER"],
      ["OFFER_AGREED", "CANCEL", "CANCELLED"],
      ...OPEN_GATED.map((s): Row => [s, "CANCEL", "CANCELLED", "cancellation"]),
    ]));
});

const ALL: DealFacts = {
  type: "primary_offplan",
  sellerMortgage: false,
  buyerMortgage: false,
  planTakenOver: false,
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
};
const guard = (event: DealMachineEvent, from: string, facts: DealFacts) => {
  const t = dealMachine.transitions.find((x) => x.event === event && x.from === from)!;
  return t.guard ? t.guard(facts) : { ok: true as const };
};

describe("routing by deal type", () => {
  test("branching events go to the type's step; others map to themselves", () => {
    expect(routeDealEvent("ALL_SIGNED", { ...ALL, type: "primary_offplan" })).toBe("ALL_SIGNED_PRIMARY");
    expect(routeDealEvent("ALL_SIGNED", { ...ALL, type: "resale_ready" })).toBe("ALL_SIGNED_RESALE");
    expect(routeDealEvent("ALL_SIGNED", { ...ALL, type: "resale_offplan" })).toBe("ALL_SIGNED_RESALE");
    expect(routeDealEvent("NOC_OK", { ...ALL, type: "resale_ready", buyerMortgage: true })).toBe("NOC_OK_FINANCE");
    expect(routeDealEvent("NOC_OK", { ...ALL, type: "resale_ready", sellerMortgage: true })).toBe("NOC_OK_FINANCE");
    expect(routeDealEvent("NOC_OK", { ...ALL, type: "resale_ready" })).toBe("NOC_OK_SETTLEMENT");
    expect(routeDealEvent("TRANSFERRED", { ...ALL, type: "resale_offplan", planTakenOver: true })).toBe(
      "TRANSFERRED_PLAN",
    );
    expect(routeDealEvent("TRANSFERRED", { ...ALL, type: "resale_offplan" })).toBe("TRANSFERRED_COMPLETE");
    expect(routeDealEvent("TRANSFERRED", { ...ALL, type: "resale_ready" })).toBe("TRANSFERRED_COMPLETE");
    expect(routeDealEvent("CANCEL", ALL)).toBe("CANCEL");
    expect(routeDealEvent("REGISTERED", ALL)).toBe("REGISTERED");
  });
});

describe("type guards refuse the other type's branch", () => {
  test.each([
    ["ALL_SIGNED_PRIMARY", "SIGNING", { type: "resale_ready" }],
    ["ALL_SIGNED_RESALE", "SIGNING", { type: "primary_offplan" }],
    ["NOC_OK_FINANCE", "NOC", { type: "resale_ready" }],
    ["NOC_OK_SETTLEMENT", "NOC", { type: "resale_ready", buyerMortgage: true }],
    ["TRANSFERRED_PLAN", "TRANSFER", { type: "resale_ready" }],
    ["TRANSFERRED_COMPLETE", "TRANSFER", { type: "resale_offplan", planTakenOver: true }],
    ["REGISTERED", "REGISTRATION", { type: "resale_ready" }],
    ["NOC_OK_SETTLEMENT", "NOC", { type: "primary_offplan" }],
  ] as const)("%s from %s", (event, from, over) => {
    const r = guard(event, from, { ...ALL, ...over });
    expect(r.ok).toBe(false);
  });
});

describe("each fact guard refuses when its fact is false", () => {
  const RESALE: Partial<DealFacts> = { type: "resale_ready" };
  test.each([
    ["CHECKS_STARTED", "OFFER_AGREED", {}, ["documentsRequested"]],
    ["CHECKS_PASSED", "PARTY_CHECK", {}, ["kycOk", "companyChecksOk"]],
    ["AML_FLAGGED", "PARTY_CHECK", {}, ["amlFlaggedByRule"]],
    ["AML_FLAGGED", "AGREEMENT_DRAFT", {}, ["amlFlaggedByRule"]],
    ["AML_FLAGGED", "LEGAL_REVIEW", {}, ["amlFlaggedByRule"]],
    ["PREPARED", "AGREEMENT_DRAFT", {}, ["agreementPrepared"]],
    ["ALL_SIGNED_PRIMARY", "SIGNING", {}, ["allSigned"]],
    ["ALL_SIGNED_RESALE", "SIGNING", RESALE, ["allSigned", "depositRecorded"]],
    ["NOC_OK_SETTLEMENT", "NOC", RESALE, ["nocOk"]],
    ["NOC_OK_FINANCE", "NOC", { ...RESALE, buyerMortgage: true }, ["nocOk"]],
    ["FINANCE_OK", "FINANCE", RESALE, ["bankLettersConfirmed"]],
    ["SETTLED", "SETTLEMENT", RESALE, ["statementBalanced", "nocOk"]],
    ["TRANSFERRED_COMPLETE", "TRANSFER", RESALE, ["transferIssued", "nocOk"]],
    ["TRANSFERRED_PLAN", "TRANSFER", { type: "resale_offplan", planTakenOver: true }, ["transferIssued", "nocOk"]],
    ["REGISTERED", "REGISTRATION", {}, ["oqoodIssued"]],
    ["HANDOVER", "INSTALMENTS", {}, ["instalmentsPaid", "handoverRecorded"]],
  ] as const)("%s", (event, from, over, facts) => {
    expect(guard(event, from, { ...ALL, ...over }).ok).toBe(true);
    for (const f of facts) expect(guard(event, from, { ...ALL, ...over, [f]: false }).ok).toBe(false);
  });
  test("company checks gate PARTY_CHECK only when the deal has a company party (C20, S52)", () => {
    // A deal with company parties needs `companyChecksOk`; one with only people never has company checks to pass.
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: true, companyChecksOk: false }).ok).toBe(
      false,
    );
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: true, companyChecksOk: true }).ok).toBe(
      true,
    );
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: false, companyChecksOk: false }).ok).toBe(
      true,
    );
    // The other checks still apply to a people-only deal.
    expect(
      guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: false, companyChecksOk: false, kycOk: false })
        .ok,
    ).toBe(false);
    const r = guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: true, companyChecksOk: false });
    expect(!r.ok && r.reasons.join(" ")).toContain("Company checks");
  });
  test("a NOC that is no longer valid blocks settlement and transfer, and says why (S48)", () => {
    const f = { ...ALL, type: "resale_offplan", planTakenOver: true, nocOk: false } as const;
    for (const [event, from] of [
      ["SETTLED", "SETTLEMENT"],
      ["TRANSFERRED_COMPLETE", "TRANSFER"],
      ["TRANSFERRED_PLAN", "TRANSFER"],
    ] as const) {
      const r = guard(event, from, event === "TRANSFERRED_COMPLETE" ? { ...f, planTakenOver: false } : f);
      expect(r.ok).toBe(false);
      expect(!r.ok && r.reasons.join(" ")).toContain("NOC");
    }
  });
  test("an open AML flag blocks CHECKS_PASSED", () => {
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, openAmlFlag: true }).ok).toBe(false);
  });
  // Review finding 1: an open flag holds every forward step after the agreement, with neutral wording.
  test.each([
    ["APPROVED", "LEGAL_REVIEW", {}],
    ["ALL_SIGNED_PRIMARY", "SIGNING", {}],
    ["ALL_SIGNED_RESALE", "SIGNING", { type: "resale_ready" }],
    ["REGISTERED", "REGISTRATION", {}],
    ["NOC_OK_FINANCE", "NOC", { type: "resale_ready", buyerMortgage: true }],
    ["NOC_OK_SETTLEMENT", "NOC", { type: "resale_ready" }],
    ["FINANCE_OK", "FINANCE", { type: "resale_ready" }],
    ["SETTLED", "SETTLEMENT", { type: "resale_ready" }],
    ["TRANSFERRED_COMPLETE", "TRANSFER", { type: "resale_ready" }],
    ["TRANSFERRED_PLAN", "TRANSFER", { type: "resale_offplan", planTakenOver: true }],
    ["HANDOVER", "INSTALMENTS", {}],
  ] as const)("an open compliance flag holds %s", (event, from, over) => {
    expect(guard(event, from, { ...ALL, ...over }).ok).toBe(true);
    const r = guard(event, from, { ...ALL, ...over, openAmlFlag: true });
    expect(r.ok).toBe(false);
    const text = !r.ok ? r.reasons.join(" ") : "";
    expect(text).toContain("A compliance review is open.");
    expect(text).not.toMatch(/aml/i);
  });
  test("the CHECKS_PASSED reason is neutral too", () => {
    const r = guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, openAmlFlag: true });
    expect(!r.ok && r.reasons.join(" ")).toContain("A compliance review is open.");
    expect(!r.ok && r.reasons.join(" ")).not.toMatch(/aml/i);
  });
  test("an undefined hasCompanyParty blocks like an unchecked company (review 6)", () => {
    const f = { ...ALL, companyChecksOk: false } as Record<string, unknown>;
    delete f.hasCompanyParty;
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", f as unknown as DealFacts).ok).toBe(false);
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, hasCompanyParty: false, companyChecksOk: false }).ok).toBe(
      true,
    );
  });
  test("a resale needs ownershipOk to pass its checks; a primary deal doesn't (review 9)", () => {
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, type: "resale_ready", ownershipOk: false }).ok).toBe(false);
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, type: "resale_offplan", ownershipOk: false }).ok).toBe(
      false,
    );
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, type: "resale_ready", ownershipOk: true }).ok).toBe(true);
    expect(guard("CHECKS_PASSED", "PARTY_CHECK", { ...ALL, type: "primary_offplan", ownershipOk: false }).ok).toBe(
      true,
    );
  });
  test("SETTLED also needs the bank letters when a mortgage exists (review 8)", () => {
    const m = { type: "resale_ready", sellerMortgage: true } as const;
    expect(guard("SETTLED", "SETTLEMENT", { ...ALL, ...m }).ok).toBe(true);
    expect(guard("SETTLED", "SETTLEMENT", { ...ALL, ...m, bankLettersConfirmed: false }).ok).toBe(false);
    expect(guard("SETTLED", "SETTLEMENT", { ...ALL, type: "resale_ready", bankLettersConfirmed: false }).ok).toBe(true);
  });
});

describe("cancel", () => {
  test("no gate from OFFER_AGREED, the cancellation gate from every later open state, none from INSTALMENTS", () => {
    const cancels = dealMachine.transitions.filter((t) => t.event === "CANCEL");
    expect(cancels.find((t) => t.from === "OFFER_AGREED")?.gate).toBeUndefined();
    for (const s of OPEN_GATED) expect(cancels.find((t) => t.from === s)?.gate).toBe("cancellation");
    for (const s of ["INSTALMENTS", "HANDED_OVER", "COMPLETED", "CANCELLED"])
      expect(cancels.some((t) => t.from === s)).toBe(false);
  });
});

describe("listing guards", () => {
  const ctx = { today: "2026-11-18", agreementSigned: true, ownershipMatched: true, permitExpiresOn: "2026-11-18" };
  const g = (event: string, from: string, c: typeof ctx | Record<string, unknown>) =>
    listingMachine.transitions.find((t) => t.event === event && t.from === from)!.guard!(c as never);
  test("a permit valid today is enough; yesterday or none is not", () => {
    expect(g("ACTIVATE", "VERIFIED", ctx).ok).toBe(true);
    expect(g("ACTIVATE", "VERIFIED", { ...ctx, permitExpiresOn: "2026-11-17" }).ok).toBe(false);
    expect(g("ACTIVATE", "VERIFIED", { ...ctx, permitExpiresOn: null }).ok).toBe(false);
    expect(g("PUBLISH", "ACTIVE", { ...ctx, permitExpiresOn: "2026-11-17" }).ok).toBe(false);
  });
  test("verifying needs the signed agreement and matched ownership", () => {
    expect(g("VERIFY", "DRAFT", ctx).ok).toBe(true);
    expect(g("VERIFY", "DRAFT", { ...ctx, agreementSigned: false }).ok).toBe(false);
    expect(g("VERIFY", "DRAFT", { ...ctx, ownershipMatched: false }).ok).toBe(false);
  });
});

describe("gate outcomes", () => {
  test("DEAL_GATE_OUTCOMES covers every gated deal transition", () => {
    for (const t of dealMachine.transitions.filter((x) => x.gate))
      expect(DEAL_GATE_OUTCOMES[t.event]?.length ?? 0).toBeGreaterThan(0);
    expect(DEAL_GATE_OUTCOMES.APPROVED).toEqual(["approved"]);
    expect(DEAL_GATE_OUTCOMES.RETURNED).toEqual(["rejected"]);
    expect(DEAL_GATE_OUTCOMES.AML_CLEARED).toEqual(["clear"]);
    expect(DEAL_GATE_OUTCOMES.AML_STOPPED).toEqual(["stop", "stop_and_report"]);
    expect(DEAL_GATE_OUTCOMES.CANCEL).toEqual(["approved"]);
  });
});
