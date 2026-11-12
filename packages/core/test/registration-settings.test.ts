import { describe, expect, test } from "bun:test";
import { DEFAULT_REGISTRATION_SETTINGS, documentKeyLabel, EMIRATES, RegistrationSettings } from "../src/index.ts";

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
});
