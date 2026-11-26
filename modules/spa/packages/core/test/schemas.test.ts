import { describe, expect, test } from "bun:test";
import {
  AmlCase,
  BeneficialOwner,
  CompanyParty,
  DealInput,
  ListingInput,
  Party,
  PaymentPlan,
  PersonParty,
  Settlement,
  Signatory,
  spaUserActor,
  TemplateVersion,
} from "../src/index.ts";

const id = (n: number) => `0190c1d2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const buyer = { role: "buyer" as const, partyId: id(1), order: 1, shareBps: 10_000 };
const seller = { role: "seller" as const, partyId: id(2), order: 1, shareBps: 10_000 };
const primary = {
  dealType: "primary_offplan" as const,
  sellerMortgage: false,
  buyerMortgage: false,
  planTakenOver: false,
  unitId: id(9),
  priceFils: 150_000_000,
  parties: [buyer, seller],
};

describe("valid examples parse", () => {
  test("parties, signatory, beneficial owner", () => {
    const person = {
      kind: "person",
      fullNameEn: "Sample Buyer",
      nationality: "Testland",
      email: "b@example.test",
      passportNo: "X0000001",
    };
    expect(PersonParty.parse(person).kind).toBe("person");
    const company = {
      kind: "company",
      email: "c@example.test",
      details: {
        tradeName: "Fictional Holdings",
        licenceNo: "[LICENCE NO.]",
        licenceExpiresOn: "2027-06-30",
        issuingAuthority: "DED",
      },
    };
    expect(CompanyParty.parse(company).details.tradeName).toBe("Fictional Holdings");
    expect(Party.parse(company).kind).toBe("company");
    expect(
      Signatory.parse({
        companyPartyId: id(3),
        personPartyId: id(4),
        title: "Director",
        authority: "poa",
        documentId: id(5),
      }).authority,
    ).toBe("poa");
    expect(BeneficialOwner.parse({ companyPartyId: id(3), personPartyId: id(4), shareBps: 2500 }).shareBps).toBe(2500);
  });
  test("deal, listing, plan, settlement, aml case, template version", () => {
    expect(DealInput.parse(primary).dealType).toBe("primary_offplan");
    expect(
      DealInput.parse({
        ...primary,
        dealType: "resale_offplan",
        unitId: undefined,
        listingId: id(8),
        planTakenOver: true,
      }).planTakenOver,
    ).toBe(true);
    expect(
      ListingInput.parse({
        title: "2-bed",
        community: "[COMMUNITY]",
        propertyDescription: "2 bed, [BUILDING]",
        askingPriceFils: 200_000_000,
        sellers: [seller],
      }).sellers,
    ).toHaveLength(1);
    expect(
      PaymentPlan.parse({
        instalments: [
          { label: "Booking", shareBps: 1000, dueOn: "2026-12-01" },
          { label: "Handover", shareBps: 9000, milestone: "handover" },
        ],
      }).instalments,
    ).toHaveLength(2);
    expect(
      Settlement.parse({ lines: [{ payer: "buyer", payee: "seller", label: "Balance", amountFils: 100 }] }).lines,
    ).toHaveLength(1);
    expect(
      AmlCase.parse({ partyId: id(1), status: "open", hits: [{ rule: "pep", detail: "name match" }] }).status,
    ).toBe("open");
    expect(
      TemplateVersion.parse({
        documentKind: "mou",
        status: "proposed",
        sections: [],
        blanks: [{ id: "b1", key: "purchaser_name" }],
        partyBlocks: [{ role: "purchaser", repeatable: true }],
        signatureBlocks: [{ role: "seller", page: 3 }],
      }).documentKind,
    ).toBe("mou");
    expect(spaUserActor("u1")).toBe("user:u1");
  });
});

describe("schemas refuse what the spec forbids", () => {
  test("shares must add up to 100%", () => {
    expect(DealInput.safeParse({ ...primary, parties: [{ ...buyer, shareBps: 9999 }, seller] }).success).toBe(false);
  });
  test("a primary deal points to a unit, a resale to a listing; exactly one", () => {
    expect(DealInput.safeParse({ ...primary, unitId: undefined, listingId: id(8) }).success).toBe(false);
    expect(DealInput.safeParse({ ...primary, listingId: id(8) }).success).toBe(false);
    expect(DealInput.safeParse({ ...primary, dealType: "resale_ready" }).success).toBe(false);
  });
  test("only an off-plan resale takes over a plan", () => {
    expect(
      DealInput.safeParse({
        ...primary,
        dealType: "resale_ready",
        unitId: undefined,
        listingId: id(8),
        planTakenOver: true,
      }).success,
    ).toBe(false);
  });
  test("a deal needs a buyer and a seller", () => {
    expect(DealInput.safeParse({ ...primary, parties: [buyer] }).success).toBe(false);
  });
  test("plan shares are positive and add up", () => {
    expect(
      PaymentPlan.safeParse({
        instalments: [
          { label: "A", shareBps: 0, dueOn: "2026-12-01" },
          { label: "B", shareBps: 10000, dueOn: "2027-01-01" },
        ],
      }).success,
    ).toBe(false);
    expect(PaymentPlan.safeParse({ instalments: [{ label: "A", shareBps: 10000 }] }).success).toBe(false);
  });
  test("money is a whole number of fils", () => {
    expect(DealInput.safeParse({ ...primary, priceFils: -1 }).success).toBe(false);
    expect(DealInput.safeParse({ ...primary, priceFils: 1.5 }).success).toBe(false);
  });
  test("a primary deal may leave the price to the unit's price list (S64); a resale always names its price", () => {
    const { priceFils: _p, ...noPrice } = primary;
    expect(DealInput.safeParse(noPrice).success).toBe(true);
    expect(
      DealInput.safeParse({ ...noPrice, dealType: "resale_ready", unitId: undefined, listingId: id(8) }).success,
    ).toBe(false);
  });
  test("template document kinds are the four in S13", () => {
    expect(
      TemplateVersion.safeParse({
        documentKind: "lease",
        status: "proposed",
        sections: [],
        blanks: [],
        partyBlocks: [],
        signatureBlocks: [],
      }).success,
    ).toBe(false);
  });

  test("C4: shares are all-or-none per role; listing sellers follow the party rules; a person has an ID", () => {
    expect(
      DealInput.safeParse({
        ...primary,
        parties: [{ ...buyer, shareBps: 5000 }, { ...buyer, order: 2, shareBps: undefined }, seller],
      }).success,
    ).toBe(false);
    const listing = { title: "t", community: "c", propertyDescription: "x", askingPriceFils: 1 };
    expect(
      ListingInput.safeParse({
        ...listing,
        sellers: [
          { ...seller, shareBps: 5000 },
          { ...seller, order: 2, shareBps: 4000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ListingInput.safeParse({
        ...listing,
        sellers: [
          { ...seller, shareBps: 5000 },
          { ...seller, order: 1, shareBps: 5000 },
        ],
      }).success,
    ).toBe(false);
    expect(
      ListingInput.safeParse({
        ...listing,
        sellers: [
          { ...seller, shareBps: 5000 },
          { ...seller, partyId: id(7), order: 2, shareBps: 5000 },
        ],
      }).success,
    ).toBe(true);
    expect(
      PersonParty.safeParse({ kind: "person", fullNameEn: "A", nationality: "B", email: "a@example.test" }).success,
    ).toBe(false);
  });
});
