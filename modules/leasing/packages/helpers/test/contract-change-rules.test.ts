import { describe, expect, test } from "bun:test";
import { checkMarkRewrite } from "../src/contract-change/rules.ts";

const rules = { renewalNoticeDays: 90, repossessionNoticeMonths: 12, lateRentDaysAfterFormalReminder: 30 };
const run = (before: string, after: string, notes: string[], rewritable = true) =>
  checkMarkRewrite({ before, after, notes, rules, emirate: "dubai", rewritable });
const officer = (before: string, after: string, notes: string[] = []) =>
  checkMarkRewrite({ before, after, notes, rules, emirate: "dubai", rewritable: true, author: "officer" });

describe("checkMarkRewrite", () => {
  test("passes 24 → 48 hours when the note says 48", () => {
    const before = "The landlord gives 24 hours notice before entering {{b1}}.";
    expect(run(before, "The landlord gives 48 hours notice before entering {{b1}}.", ["make it 48 hours"])).toEqual([]);
  });
  test("refuses a number not in the note", () => {
    const before = "The landlord gives 24 hours notice before entering.";
    const p = run(before, "The landlord gives 72 hours notice before entering.", ["make it 48 hours"]);
    expect(p).toContain('"72" is not in the request.');
  });
  test("refuses changing the 90-day rent-increase notice", () => {
    const before = "The landlord gives 90 days notice of a rent increase.";
    const p = run(before, "The landlord gives 60 days notice of a rent increase.", ["60 days"]);
    expect(p.length).toBeGreaterThan(0);
  });
  test("refuses dropping a blank token", () => {
    expect(run("Unit {{b1}} and {{b2}}.", "Unit {{b1}}.", ["shorter"])).toContain(
      "Keep every {{bN}} blank exactly once and add none.",
    );
  });
  test("refuses adding a permission", () => {
    const p = run("The tenant lives in the unit.", "The tenant lives in the unit and may sublet it.", [
      "more flexible",
    ]);
    expect(p.some((x) => x.includes("may"))).toBe(true);
  });
  test("refuses a fixed paragraph", () => {
    expect(run("Text.", "Text.", [], false)).toEqual(["This part of the contract is fixed and can't be reworded."]);
  });
  test("removing words passes", () => {
    expect(run("The villa has a garden and a pool.", "The villa has a garden.", ["remove the pool"])).toEqual([]);
  });
  test('the deposit-return "within 30 days" can change to 14 when the note says 14', () => {
    const before = "The deposit is returned within 30 days of handover.";
    expect(run(before, "The deposit is returned within 14 days of handover.", ["14 days"])).toEqual([]);
  });
  test('dropping "90 days" from the rent-increase notice sentence is refused', () => {
    const before = "The landlord gives 90 days notice of a rent increase.";
    const p = run(before, "The landlord gives notice of a rent increase.", ["shorter"]);
    expect(p).toContain("The rulebook period of 90 stated in this passage must stay as it is.");
  });

  describe("officer author (D72)", () => {
    test("24 to 48 passes without the number in a note", () => {
      const before = "The landlord gives 24 hours notice before entering {{b1}}.";
      expect(officer(before, "The landlord gives 48 hours notice before entering {{b1}}.")).toEqual([]);
    });
    test('"may sublet" passes', () => {
      expect(officer("The tenant lives in the unit.", "The tenant lives in the unit and may sublet it.")).toEqual([]);
    });
    test("a fixed paragraph is still refused", () => {
      expect(
        checkMarkRewrite({
          before: "Text.",
          after: "Text.",
          notes: [],
          rules,
          emirate: "dubai",
          rewritable: false,
          author: "officer",
        }),
      ).toEqual(["This part of the contract is fixed and can't be reworded."]);
    });
    test("90 to 30 day rent-increase notice is refused", () => {
      const p = officer(
        "The landlord gives 90 days notice of a rent increase.",
        "The landlord gives 30 days notice of a rent increase.",
      );
      expect(p.length).toBeGreaterThan(0);
    });
    test("a dropped blank is refused", () => {
      expect(officer("Unit {{b1}} and {{b2}}.", "Unit {{b1}}.")).toContain(
        "Keep every {{bN}} blank exactly once and add none.",
      );
    });
    test("longer text is allowed up to before + 1500, not beyond", () => {
      const before = "Short.";
      expect(officer(before, "x ".repeat(700).trim())).toEqual([]);
      expect(officer(before, "x".repeat(1600))).toContain("The new wording is too long.");
    });
    test("unprintable characters are refused", () => {
      expect(officer("Text.", "Text \u{1F600}.").length).toBeGreaterThan(0);
    });
    test("signer behaviour is unchanged", () => {
      expect(
        run("The tenant lives in the unit.", "The tenant lives in the unit and may sublet it.", ["x"]).length,
      ).toBeGreaterThan(0);
    });
  });
});
