import { existsSync } from "node:fs";
import { describe, expect, test } from "bun:test";
import { isValidEmiratesId } from "@platform/kernel/emirates-id";
import { makeTd3 } from "@platform/kernel/mrz";
import { FakeLlm } from "@platform/llm";
import { KYC_EVAL_LIMITS, loadKycCases, scoreKycCases } from "../src/kyc/evals/score.ts";

const cases = loadKycCases();
const hi = (value: string | null) => ({ value, confidence: 0.97 });
const dmy = (iso: string) => iso.split("-").toReversed().join("/");

/** What a perfect reader would answer for a case, built from its label only. */
function perfect(c: (typeof cases)[number]) {
  const [given, ...rest] = c.applicant.nameEn.split(" ");
  const f = c.expect.fields;
  if (c.document.kind === "passport") {
    const [l1, l2] = makeTd3({
      issuingState: "UTO",
      surname: rest.join(" "),
      givenNames: given!,
      passportNo: f.passportNo!,
      nationality: "UTO",
      birthDate: f.birthDate!,
      sex: "F",
      expiresOn: f.passportExpiresOn!,
    });
    return {
      documentType: "passport",
      passportNo: hi(f.passportNo!),
      surname: hi(rest.join(" ").toUpperCase()),
      givenNames: hi(given!.toUpperCase()),
      nationality: hi("UTO"),
      birthDate: hi(dmy(f.birthDate!)),
      sex: hi("F"),
      expiryDate: hi(dmy(f.passportExpiresOn!)),
      mrzLine1: hi(l1),
      mrzLine2: hi(l2),
    };
  }
  return {
    documentType: "identity_card_front",
    idNumber: hi(f.emiratesIdNo!),
    name: hi(c.applicant.nameEn),
    nationality: hi("Utopia"),
    birthDate: hi(dmy(f.birthDate!)),
    sex: hi("F"),
    expiryDate: hi(dmy(f.idExpiresOn!)),
  };
}

describe("spa:kyc eval fixtures (fictional, labelled)", () => {
  test("40 cases, half expired, every file there, every label valid in form", () => {
    expect(cases).toHaveLength(40);
    expect(cases.filter((c) => c.expect.expired)).toHaveLength(20);
    expect(new Set(cases.map((c) => c.id)).size).toBe(40);
    for (const c of cases) {
      expect(existsSync(new URL(`../src/kyc/evals/specimens/${c.document.file}`, import.meta.url))).toBe(true);
      if (c.expect.fields.emiratesIdNo) expect(isValidEmiratesId(c.expect.fields.emiratesIdNo)).toBe(true);
    }
  });

  test("a perfect reader scores every field and lets no expired document pass", async () => {
    const byFile = new Map(cases.map((c) => [c.document.file, c]));
    const llm = new FakeLlm(
      () => new Error("no decide"),
      (images) => perfect(byFile.get(new TextDecoder().decode(images[0]))!),
    );
    const s = await scoreKycCases(llm, cases, async (file) => new TextEncoder().encode(file));
    expect(s.fieldsRight).toBe(s.fieldsTotal);
    expect(s.expiredPassed).toBe(0);
    expect(s.expiredBlocked).toBe(20);
    // A lone Emirates ID front still lacks the starter form's required passport, so only the 10 passports are clean.
    expect(s.validVerified).toBe(10);
    expect(s.ok).toBe(true);
  });

  test("a reader that gets a field wrong fails the limit; one that reads an expired date as valid fails the hard limit", async () => {
    const byFile = new Map(cases.map((c) => [c.document.file, c]));
    const wrong = new FakeLlm(
      () => new Error("no decide"),
      (images) => {
        const c = byFile.get(new TextDecoder().decode(images[0]))!;
        const r = perfect(c) as Record<string, { value: string | null } | string>;
        if ("birthDate" in r) r.birthDate = hi("01/01/1970");
        return r;
      },
    );
    const s = await scoreKycCases(wrong, cases, async (file) => new TextEncoder().encode(file));
    expect(s.fieldsRight / s.fieldsTotal).toBeLessThan(KYC_EVAL_LIMITS.minFieldsExact);
    expect(s.ok).toBe(false);

    const lying = new FakeLlm(
      () => new Error("no decide"),
      (images) => {
        const c = byFile.get(new TextDecoder().decode(images[0]))!;
        const r = perfect({
          ...c,
          expect: {
            ...c.expect,
            fields: { ...c.expect.fields, passportExpiresOn: "2031-01-01", idExpiresOn: "2031-01-01" },
          },
        });
        return r;
      },
    );
    const l = await scoreKycCases(lying, cases, async (file) => new TextEncoder().encode(file));
    // The reader says "not expired", and nothing in the check can see the date is wrong: the eval must say so.
    expect(l.expiredPassed).toBeGreaterThan(0);
    expect(l.ok).toBe(false);
  });
});
