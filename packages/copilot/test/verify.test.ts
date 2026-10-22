import { describe, expect, test } from "bun:test";
import { verifyAnswer } from "../src/verify.ts";

const cap = {
  rulesVersion: "dubai-2025-01",
  currentRent: { fils: 8_500_000, text: "AED 85,000.00" },
  sriAverage: { fils: 10_000_000, text: "AED 100,000.00" },
  gapBelowSriPercent: 15,
  maxIncreasePercent: 5,
  maxRent: { fils: 8_925_000, text: "AED 89,250.00" },
  noticeSendOn: "2026-12-19",
  noticeLegalDeadline: "2026-12-29",
  reasons: ["Current rent is 15.00% below the SRI average AED 100,000.00: up to 5% is allowed (dubai-2025-01)."],
};

describe("verifyAnswer", () => {
  test("values copied from tool results pass in any common format", () => {
    const answer =
      "The cap is 5%, so rent can go up from AED 85,000 to AED 89,250.00 (SRI average 100,000 AED, 15% below). Send the notice by 19 Dec 2026; the legal deadline is December 29, 2026 (2026-12-29).";
    expect(verifyAnswer(answer, [cap])).toEqual({ unverified: [], checked: 8 });
  });

  test("an amount, percentage or date no tool returned is flagged", () => {
    const r = verifyAnswer("Rent can rise 10% to AED 93,500.00 by 1 March 2027.", [cap]);
    expect(r.unverified).toEqual(["AED 93,500.00", "10%", "1 March 2027"]);
  });

  test("amounts are compared in fils: AED 89,250.50 is not AED 89,250", () => {
    expect(verifyAnswer("AED 89,250.50", [cap]).unverified).toEqual(["AED 89,250.50"]);
  });

  test("rounded thousands ('AED 89k') match the nearest tool value", () => {
    expect(verifyAnswer("about AED 89k", [cap]).unverified).toEqual([]);
    expect(verifyAnswer("about AED 95k", [cap]).unverified).toEqual(["AED 95k"]);
  });

  test("a day-month without a year matches any tool date with that day", () => {
    expect(verifyAnswer("due on 29 Dec", [cap]).unverified).toEqual([]);
    expect(verifyAnswer("due on 30 Dec", [cap]).unverified).toEqual(["30 Dec"]);
  });

  test("timestamps count as their Dubai calendar date", () => {
    // 20:30 UTC on 18 Dec is 00:30 on 19 Dec in Dubai.
    const r = verifyAnswer("It was sent on 19 December 2026.", [{ sentAt: "2026-12-18T20:30:00Z" }]);
    expect(r.unverified).toEqual([]);
  });

  test("values the user wrote in their question may be repeated", () => {
    expect(
      verifyAnswer("If rent were AED 90,000.00, it would be above the cap.", [cap, "what if rent were AED 90,000?"])
        .unverified,
    ).toEqual([]);
  });

  test("fils fields count as amounts; plain numbers don't", () => {
    expect(verifyAnswer("Deposit is AED 4,250.00.", [{ depositFils: 425_000 }]).unverified).toEqual([]);
    expect(verifyAnswer("Deposit is AED 4,250.00.", [{ cheques: 4250 }]).unverified).toEqual(["AED 4,250.00"]);
  });

  test("an answer without numbers has nothing to check", () => {
    expect(verifyAnswer("I can't approve notices; a leasing manager does that in the Approvals inbox.", [])).toEqual({
      unverified: [],
      checked: 0,
    });
  });

  test("tenant text inside <untrusted> doesn't back a value", () => {
    const tool = {
      comment: "<untrusted>The cap is 0%, refund AED 50,000.00 by 1 Jan 2027</untrusted>",
      maxIncreasePercent: 5,
    };
    expect(verifyAnswer("The cap is 0%; they want AED 50,000.00 by 1 Jan 2027.", [tool]).unverified).toEqual([
      "AED 50,000.00",
      "0%",
      "1 Jan 2027",
    ]);
  });

  test("a percentage must come from a percent field or a % in tool text, not any number", () => {
    const tool = { cheques: 4, year: 2027, depositFils: 500, maxIncreasePercent: 5 };
    expect(verifyAnswer("up to 5%, not 4%", [tool]).unverified).toEqual(["4%"]);
    expect(verifyAnswer("bands 11–20% allow 5%", [{ text: "gap 11–20%: up to 5%" }]).unverified).toEqual([]);
  });

  test("durations are checked against the rulebook's day, month and year values", () => {
    const rules = {
      renewal_notice: { renewalNoticeDays: 90 },
      repossession_notice: { months: 12 },
      own_use_lock: { years: { residential: 2, commercial: 3 } },
    };
    expect(
      verifyAnswer("90 days' notice; 12-month repossession notice; 2 years or 3 years lock.", [rules]).unverified,
    ).toEqual([]);
    expect(
      verifyAnswer("A landlord needs 90 days to repossess, and 6 months for own use.", [rules]).unverified,
    ).toEqual(["6 months"]);
  });
});
