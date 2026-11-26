import { describe, expect, test } from "bun:test";
import { checkAnswers } from "@platform/kernel/kyc-form";
import { FUND_SOURCES, SPA_KYC_ROLES, SpaKycConfig, spaKycForm, starterKycConfig } from "../src/index.ts";

describe("SPA KYC configuration (S19)", () => {
  test("every role has a valid starter config; SPA document kinds are there", () => {
    expect([...SPA_KYC_ROLES]).toEqual(["buyer_person", "seller_person", "company_party", "beneficial_owner"]);
    for (const r of SPA_KYC_ROLES) expect(SpaKycConfig.safeParse(starterKycConfig(r)).success).toBe(true);
    const kinds = spaKycForm.FormDocumentKind.options;
    for (const k of ["passport", "title_deed", "oqood", "poa", "board_resolution", "memorandum", "custom", "other"])
      expect(kinds).toContain(k as never);
  });
  test("the buyer's starter form asks a required source of funds, with the AML policy's choices (S49/S50)", () => {
    const f = starterKycConfig("buyer_person").form.find((x) => x.key === "source_of_funds");
    expect(f).toMatchObject({ type: "select", required: true });
    expect(f!.options).toEqual([...FUND_SOURCES]);
    expect(checkAnswers(starterKycConfig("buyer_person").form, "individual", { full_name: "A B" })).toContain(
      "source_of_funds: " + f!.label + " is required",
    );
    expect(
      checkAnswers(starterKycConfig("buyer_person").form, "individual", { full_name: "A B", source_of_funds: "gift" }),
    ).toEqual([]);
    // A company is answered for by its owners (S50): its form has no such question, nor do seller or owner forms.
    for (const r of ["company_party", "seller_person", "beneficial_owner"] as const)
      expect(starterKycConfig(r).form.some((x) => x.key === "source_of_funds")).toBe(false);
  });
  test("an expired document can't be set to warning or off (locked)", () => {
    const cfg = starterKycConfig("buyer_person");
    const passport = cfg.form.find((f) => f.documentKind === "passport")!;
    const bad = {
      ...passport,
      rules: {
        validityDays: 30,
        minConfidence: 0.8,
        checks: { expired: { severity: "warning", emailApplicant: false } },
      },
    };
    expect(SpaKycConfig.safeParse({ ...cfg, form: cfg.form.map((f) => (f === passport ? bad : f)) }).success).toBe(
      false,
    );
  });
  test("a rule's field key or the field label it uses can't name a protected trait (S19)", () => {
    const cfg = starterKycConfig("buyer_person");
    const field = (key: string, label: string) => ({
      key,
      label,
      type: "text" as const,
      required: false,
      placeholder: "",
      help: "",
      appliesTo: "both" as const,
      options: [],
      nameAsPerDocuments: false,
    });
    const make = (key: string, label: string, severity: "blocker" | "warning") =>
      SpaKycConfig.safeParse({
        form: [...cfg.form, field(key, label)],
        rules: {
          ...cfg.rules,
          company: [{ id: "r1", label: "Answer given", type: "answer_required", fieldKey: key, severity }],
        },
      }).success;
    expect(make("home_country", "Home country", "blocker")).toBe(true);
    expect(make("ethnic_origin", "Where from", "blocker")).toBe(false);
    expect(make("marital_status", "Status", "blocker")).toBe(false);
    expect(make("applicantAge", "Applicant", "blocker")).toBe(false);
    expect(make("tribe", "Group", "warning")).toBe(false);
    expect(make("status", "Caste", "warning")).toBe(false);
    expect(make("q1", "Your age", "blocker")).toBe(false);
    expect(make("q1", "Your age", "warning")).toBe(true);
  });
  test("rules screening on protected traits are refused; an AI check can only warn; rules name real fields", () => {
    const cfg = starterKycConfig("buyer_person");
    const withRule = (rule: Record<string, unknown>) =>
      SpaKycConfig.safeParse({ ...cfg, rules: { ...cfg.rules, company: [rule] } });
    expect(withRule({ id: "r1", label: "No nationals of X", type: "min_age", years: 21 }).success).toBe(false);
    expect(
      withRule({ id: "r2", label: "Check", type: "ai_check", instruction: "Refuse buyers by religion please" }).success,
    ).toBe(false);
    expect(
      withRule({
        id: "r3",
        label: "Looks right",
        type: "ai_check",
        instruction: "Flag documents that look edited",
        severity: "blocker",
      }).success,
    ).toBe(false);
    expect(
      withRule({ id: "r4", label: "Looks right", type: "ai_check", instruction: "Flag documents that look edited" })
        .success,
    ).toBe(true);
    expect(withRule({ id: "r5", label: "Answer", type: "answer_required", fieldKey: "no_such_field" }).success).toBe(
      false,
    );
    expect(
      withRule({
        id: "r6",
        label: "Licence starts CN",
        type: "document_value_pattern",
        identityField: "licenceNo",
        pattern: "(a+)+",
      }).success,
    ).toBe(false);
  });
});
