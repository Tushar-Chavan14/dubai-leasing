import { describe, expect, test } from "bun:test";
import {
  emirateWordingProblems,
  legalPeriodProblems,
  sampleValueProblems,
  templateEmirateProblems,
} from "../src/index.ts";

const rules = { renewalNoticeDays: 90, repossessionNoticeMonths: 12, lateRentDaysAfterFormalReminder: 30 };
const p = (text: string, r = rules) => legalPeriodProblems([{ key: "s1:0", text }], r);

describe("legalPeriodProblems", () => {
  test("renewal notice days must equal the rulebook", () => {
    expect(p("Any rent increase needs written notice at least 90 days before the term ends.")).toEqual([]);
    expect(p("Any rent increase needs written notice at least 60 days before the term ends.")).toHaveLength(1);
    expect(p("To renew, the landlord gives ninety (90) days written notice.")).toEqual([]);
    expect(p("To renew, the landlord gives sixty days written notice.")).toHaveLength(1);
    expect(p("Notice of a rent change is given ninety days before expiry.")).toEqual([]);
  });
  test("uses the rules passed in", () => {
    expect(p("Any rent increase needs 60 days notice.", { ...rules, renewalNoticeDays: 60 })).toEqual([]);
  });
  test("repossession months", () => {
    expect(p("The landlord may evict only on 12 months' notice by notary public or registered mail.")).toEqual([]);
    expect(p("The landlord may evict on 6 months' notice by notary public or registered mail.")).toHaveLength(1);
    expect(p("Twelve (12) months' notice to vacate for own use.")).toEqual([]);
    expect(p("Six months notice to vacate for own use.")).toHaveLength(1);
  });
  test("formal reminder days", () => {
    expect(p("Eviction may start 30 days after a formal reminder of late payment.")).toEqual([]);
    expect(p("Eviction may start 15 days after a formal reminder of late payment.")).toHaveLength(1);
    expect(p("Eviction may start fifteen days after a formal reminder.")).toHaveLength(1);
  });
  test("sentences with no number or about other things pass", () => {
    expect(p("The landlord will give written notice of any rent increase.")).toEqual([]);
    expect(p("The deposit is returned within 30 days of handover.")).toEqual([]);
    expect(p("The landlord may inspect with 24 hours' notice.")).toEqual([]);
    expect(p("The tenant pays within 7 days.")).toEqual([]);
  });
  test("each sentence is judged alone", () => {
    const out = p("Rent increases need 90 days notice. Deposits are returned within 60 days.");
    expect(out).toEqual([]);
  });
});

describe("emirateWordingProblems", () => {
  const t = (text: string) => [{ key: "k", text }];
  test("Dubai wording in a non-Dubai unit", () => {
    expect(
      emirateWordingProblems(t("Governed by Law No. 26 of 2007 and the Rental Disputes Centre in Dubai."), "abu_dhabi"),
    ).toHaveLength(1);
    expect(emirateWordingProblems(t("The tenant pays DEWA and registers on Ejari."), "sharjah")).toHaveLength(1);
    expect(emirateWordingProblems(t("Governed by Law No. 26 of 2007 and RERA."), "dubai")).toEqual([]);
  });
  test("other emirates' wording", () => {
    expect(emirateWordingProblems(t("The tenant registers on Tawtheeq."), "dubai")).toHaveLength(1);
    expect(emirateWordingProblems(t("The tenant registers on Tawtheeq."), "abu_dhabi")).toEqual([]);
    expect(emirateWordingProblems(t("SEWA bills are paid by the tenant."), "ajman")).toHaveLength(1);
    expect(emirateWordingProblems(t("The tenant keeps the unit clean."), "abu_dhabi")).toEqual([]);
  });
  test("template emirates", () => {
    const txt = t("Governed by the laws of Dubai.");
    expect(templateEmirateProblems(txt, [])).toEqual([
      "This template cites Dubai law or authorities; set its emirates to Dubai.",
    ]);
    expect(templateEmirateProblems(txt, ["dubai"])).toEqual([]);
    expect(templateEmirateProblems(txt, ["dubai", "sharjah"])).toHaveLength(1);
    expect(templateEmirateProblems(t("Plain wording."), [])).toEqual([]);
  });
});

describe("sampleValueProblems", () => {
  const own = ["ARR-0042", "DLD-77", "Silver Fern Properties LLC"];
  test("a code from the sample is a problem, the lease's own is not", () => {
    const out = sampleValueProblems([{ key: "a", text: "Property DEMO-DLD-000017 in Dubai." }], own);
    expect(out).toHaveLength(1);
    expect(out[0]!.problem).toContain(`reference code "DEMO-DLD-000017"`);
    expect(sampleValueProblems([{ key: "a", text: "Unit ARR-0042 is let." }], own)).toEqual([]);
    expect(sampleValueProblems([{ key: "a", text: "Unit arr-0042 is let." }], own)).toEqual([]);
  });
  test("company names and other values", () => {
    expect(sampleValueProblems([{ key: "a", text: "Landlord: Al Noor Family Holdings." }], own)).toHaveLength(1);
    expect(sampleValueProblems([{ key: "a", text: "Landlord: Silver Fern Properties LLC." }], own)).toEqual([]);
    expect(sampleValueProblems([{ key: "a", text: "Pay AED 5,000 monthly." }], own)).toHaveLength(1);
  });
  test("blank tokens and plain wording pass", () => {
    expect(sampleValueProblems([{ key: "a", text: "Unit {{b3}} is let to {{b4}}." }], own)).toEqual([]);
  });
});

describe("false positives (D70 review)", () => {
  const q = (text: string) => legalPeriodProblems([{ key: "k", text }], rules);
  test("periods not tied to a rulebook notice pass", () => {
    expect(q("The Ejari renewal fee is payable within 7 days.")).toEqual([]);
    expect(q("Renewal terms are sent 14 days before the term ends.")).toEqual([]);
    expect(q("If rent is unpaid, the landlord may serve notice within 15 days.")).toEqual([]);
    expect(q("The deposit is refunded within 1 month of vacating.")).toEqual([]);
  });
  test("real mismatches still flag", () => {
    expect(q("Notice of a rent increase must be given 60 days before the term ends.")).toHaveLength(1);
    expect(q("The landlord may repossess on 6 months' notice by notary.")).toHaveLength(1);
    expect(q("Eviction may start 15 days after a formal reminder or notice.")).toHaveLength(1);
    expect(q("Eviction may start 30 days after a formal notice.")).toEqual([]);
  });
  test("authority names are not sample companies", () => {
    const s = (text: string) => sampleValueProblems([{ key: "a", text }], []);
    expect(s("Dubai Real Estate Regulatory Agency applies.")).toEqual([]);
    expect(s("The Landlord Properties are let. Group rules apply.")).toEqual([]);
    expect(s("Dubai Land Department rules.")).toEqual([]);
  });
});
