import { describe, expect, test } from "bun:test";
import {
  contractWordingFor,
  DEFAULT_CONTRACT_WORDING,
  DEFAULT_REGISTRATION_SETTINGS,
  documentKeyLabel,
  EMIRATES,
  RegistrationSettings,
} from "../src/index.ts";

const base = DEFAULT_REGISTRATION_SETTINGS.sharjah;

describe("RegistrationSettings", () => {
  test("defaults are valid for all 7 emirates and their examples match", () => {
    expect(Object.keys(DEFAULT_REGISTRATION_SETTINGS).toSorted()).toEqual([...EMIRATES].toSorted());
    for (const e of EMIRATES) {
      const s = RegistrationSettings.parse(DEFAULT_REGISTRATION_SETTINGS[e]);
      expect(new RegExp(s.referencePattern).test(s.referenceExample)).toBe(true);
      expect(s.sources.every((x) => x.startsWith("From the general data available:"))).toBe(true);
    }
  });
  test("mock references pass", () => {
    expect(new RegExp(DEFAULT_REGISTRATION_SETTINGS.dubai.referencePattern).test("SIM-2026-0000123")).toBe(true);
    expect(new RegExp(DEFAULT_REGISTRATION_SETTINGS.abu_dhabi.referencePattern).test("SIM-TWQ-2026-0000123")).toBe(
      true,
    );
  });
  test("risky or match-everything patterns and long patterns are rejected", () => {
    for (const referencePattern of [
      "^(a+)+$",
      "^([a-z]*)*$",
      "^(\\d+){2,}$",
      "^(a|a)*$",
      "^(x|y)+$",
      "^(ab|cd){2,}$",
      "^.*$",
      "^.+$",
      `^${"a".repeat(130)}$`,
    ])
      expect(RegistrationSettings.safeParse({ ...base, referencePattern }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, referencePattern: "^[A-Z]{3}-\\d{4,8}$" }).success).toBe(true);
  });
  test("bad regex, unanchored pattern, extra keys, http url, duplicate docs rejected", () => {
    expect(RegistrationSettings.safeParse({ ...base, referencePattern: "^(abc$" }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, referencePattern: "[A-Z]+" }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, extra: 1 }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, portalUrl: "http://x.ae" }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, requiredDocuments: ["title_deed", "title_deed"] }).success).toBe(
      false,
    );
    expect(RegistrationSettings.safeParse({ ...base, requiredDocuments: [] }).success).toBe(false);
  });
});

describe("checklist items (D62)", () => {
  test("old keys read as their KYC documents", () => {
    const r = RegistrationSettings.parse({
      ...base,
      requiredDocuments: ["signed_contract", "tenant_identity", "tenant_visa", "kyc:passport"],
    });
    expect(r.requiredDocuments).toEqual(["signed_contract", "kyc:emirates_id", "kyc:passport", "kyc:visa"]);
  });
  test("company fields and answers by key; anything else is refused", () => {
    const ok: string[] = ["kyc:other:employer_letter", "answer:employer", "kyc:trade_licence", "title_deed"];
    expect(RegistrationSettings.parse({ ...base, requiredDocuments: ok }).requiredDocuments as string[]).toEqual(ok);
    for (const bad of ["kyc:selfie", "answer:", "answer:Bad Key", "kyc:other:x", "tenant_photo"])
      expect(RegistrationSettings.safeParse({ ...base, requiredDocuments: [bad] }).success).toBe(false);
  });
  test("labels: fixed, standard, and company fields from their form", () => {
    expect(documentKeyLabel("kyc:passport")).toBe("Tenant passport");
    expect(documentKeyLabel("kyc:other:employer_letter", new Map([["employer_letter", "Letter from employer"]]))).toBe(
      "Tenant document: Letter from employer",
    );
    expect(documentKeyLabel("answer:pet_count")).toBe("Applicant's answer: Pet count");
  });
  test("D74: every emirate has contract wording by default, and a row saved without it falls back to it", () => {
    for (const e of EMIRATES) {
      const w = DEFAULT_REGISTRATION_SETTINGS[e].contractWording;
      expect(w).toEqual(DEFAULT_CONTRACT_WORDING[e]);
      for (const v of Object.values(w)) expect(v.length).toBeGreaterThan(0);
    }
    expect(DEFAULT_CONTRACT_WORDING.dubai).toMatchObject({ registrationSystem: "Ejari", utilityProvider: "DEWA" });
    expect(DEFAULT_CONTRACT_WORDING.sharjah).toMatchObject({
      registeringAuthority: "Sharjah Municipality",
      utilityProvider: "SEWA",
    });
    const { contractWording: _, ...old } = DEFAULT_REGISTRATION_SETTINGS.sharjah;
    const parsed = RegistrationSettings.parse(old);
    expect(parsed.contractWording).toBeUndefined();
    expect(contractWordingFor(parsed, "sharjah")).toEqual(DEFAULT_CONTRACT_WORDING.sharjah);
  });
  test("D74: contract wording is checked: no empty or long text, no extra keys", () => {
    const w = DEFAULT_CONTRACT_WORDING.dubai;
    expect(
      RegistrationSettings.safeParse({ ...base, contractWording: { ...w, utilityProvider: "FEWA" } }).success,
    ).toBe(true);
    expect(RegistrationSettings.safeParse({ ...base, contractWording: { ...w, governingLaw: "  " } }).success).toBe(
      false,
    );
    expect(
      RegistrationSettings.safeParse({ ...base, contractWording: { ...w, disputeBody: "x".repeat(201) } }).success,
    ).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, contractWording: { ...w, extra: "x" } }).success).toBe(false);
    expect(RegistrationSettings.safeParse({ ...base, contractWording: { registrationSystem: "Ejari" } }).success).toBe(
      false,
    );
    expect(contractWordingFor({ contractWording: { ...w, utilityProvider: "FEWA" } }, "sharjah").utilityProvider).toBe(
      "FEWA",
    );
  });
  test("D74: wording is one line of plain text", () => {
    const w = DEFAULT_CONTRACT_WORDING.dubai;
    for (const bad of ["two\nlines", "tab\there", "zero\u200bwidth", "bell\u0007"])
      expect(RegistrationSettings.safeParse({ ...base, contractWording: { ...w, governingLaw: bad } }).success).toBe(
        false,
      );
  });
  test("D74: wording carries no period or amount; a law citation is fine", () => {
    const w = DEFAULT_CONTRACT_WORDING.dubai;
    for (const bad of [
      "notice of 60 days",
      "within 12 months",
      "2 years",
      "30 calendar days",
      "AED 500",
      "500 dirhams",
    ]) {
      const r = RegistrationSettings.safeParse({ ...base, contractWording: { ...w, governingLaw: bad } });
      expect(r.success).toBe(false);
      expect(JSON.stringify(r.error?.issues)).toContain("Periods and amounts come from the rulebook and the lease");
    }
    const ok = RegistrationSettings.safeParse({
      ...base,
      contractWording: { ...w, governingLaw: "Law No. 26 of 2007 as amended by Law No. 33 of 2008" },
    });
    expect(ok.success).toBe(true);
    for (const e of EMIRATES)
      expect(RegistrationSettings.safeParse(DEFAULT_REGISTRATION_SETTINGS[e]).success).toBe(true);
  });
});
