import { describe, expect, test } from "bun:test";
import { SpaRole } from "@spa/core";
import { asksAboutCompliance, bannedFor, COMPLIANCE_OPEN_REPLY, hasAmlWord } from "../src/guard.ts";

describe("the AML word guard (C36, S68)", () => {
  test("it trips on each word the ruling names, in any case, whole words only", () => {
    for (const w of [
      "AML",
      "aml",
      "screening",
      "Sanctions",
      "sanctioned",
      "PEP",
      "peps",
      "EDD",
      "risk",
      "Risks",
      "risky",
      "anti-money laundering",
    ])
      expect(hasAmlWord(`about the ${w} result`)).toBe(true);
    for (const w of ["amlet", "pepper", "eddy", "frisk", "Compliance review", "On hold · review open", "screens"])
      expect(hasAmlWord(`about ${w}`)).toBe(false);
  });

  test("underscore tokens and the wider vocabulary trip it too (AML_HOLD, edd_signoff, money laundering)", () => {
    for (const w of [
      "AML_HOLD",
      "aml_hold",
      "edd_signoff",
      "EDD_SIGNOFF",
      "aml_flag",
      "money laundering",
      "laundering",
      "politically exposed",
      "suspicious",
      "flagged",
    ])
      expect(hasAmlWord(`the state is ${w} today`)).toBe(true);
    // Accepted false positive: a party named Edd is caught like the word EDD (S68).
    expect(hasAmlWord("Buyer Edd Smith")).toBe(true);
    expect(hasAmlWord("the deal state is AGREEMENT_DRAFT")).toBe(false);
  });

  test("a message asks about compliance only in the compliance sense of risk", () => {
    for (const t of [
      "What is the risk assessment?",
      "show the risk level",
      "risk score of D-1",
      "a high-risk buyer",
      "AML_HOLD?",
    ])
      expect(asksAboutCompliance(t)).toBe(true);
    for (const t of ["Is there a risk of delay?", "any risk the seller pulls out", "Is it risky to wait?"])
      expect(asksAboutCompliance(t)).toBe(false);
  });

  test("the neutral reply holds none of the words", () => {
    expect(COMPLIANCE_OPEN_REPLY).toBe("Compliance review is open.");
    expect(hasAmlWord(COMPLIANCE_OPEN_REPLY)).toBe(false);
  });

  test("only the two compliance roles are exempt: admin is guarded too", () => {
    const guarded: string[] = SpaRole.options.filter((r) => bannedFor(r));
    expect(guarded.sort()).toEqual(
      ["admin", "finance", "legal", "sales_admin", "sales_manager", "sales_officer"].sort(),
    );
    expect(bannedFor("mlro")).toBeUndefined();
    expect(bannedFor("compliance_officer")).toBeUndefined();
  });
});
