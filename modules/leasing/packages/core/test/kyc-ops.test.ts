import { describe, expect, test } from "bun:test";
import {
  applyKycOps,
  defaultBaseRules,
  DocumentForm,
  KycOp,
  KycOpError,
  KycRules,
  STARTER_FORM,
} from "../src/index.ts";

const base = defaultBaseRules({ kycMinValidityDays: 30, kycMinConfidence: 0.8 });
const start = () => ({ form: structuredClone(STARTER_FORM), rules: KycRules.parse({ base, company: [] }) });

describe("KYC edits (D50)", () => {
  test("a check and a number on a field named by its category, starting from the defaults", () => {
    const r = applyKycOps(start(), [
      { op: "set_number", field: "passport", setting: "validity_days", value: 180 },
      {
        op: "set_check",
        field: "Passport data page",
        check: "valid_long_enough",
        severity: "blocker",
        emailApplicant: true,
      },
      { op: "set_number", field: "eid front", setting: "read_confidence_pct", value: 90 },
    ]);
    const pp = r.form.find((f) => f.documentKind === "passport")!;
    expect(pp.rules!.validityDays).toBe(180);
    expect(pp.rules!.checks.valid_long_enough).toEqual({ severity: "blocker", emailApplicant: true });
    expect(r.form.find((f) => f.documentKind === "emirates_id_front")!.rules!.minConfidence).toBe(0.9);
    expect(DocumentForm.safeParse(r.form).success).toBe(true);
    expect(r.publish).toBe(false);
  });

  test("email only sticks on a blocker", () => {
    const r = applyKycOps(start(), [
      { op: "set_check", field: "visa", check: "readable", severity: "warning", emailApplicant: true },
    ]);
    expect(r.form.find((f) => f.documentKind === "visa")!.rules!.checks.readable).toEqual({
      severity: "warning",
      emailApplicant: false,
    });
  });

  test("checks across documents, the name match and custom checks", () => {
    const r = applyKycOps(start(), [
      { op: "set_check", field: "across documents", check: "names_consistent", severity: "blocker" },
      { op: "set_name_match", mode: "exact" },
      { op: "add_rule", rule: { type: "min_age", label: "21 or older", years: 21, severity: "blocker" } },
      { op: "set_rule", rule: "21 or older", severity: "warning" },
    ]);
    expect(r.rules.base.checks!.cross.names_consistent!.severity).toBe("blocker");
    expect(r.rules.base.checks!.applicantNameMode).toBe("exact");
    expect(r.rules.company[0]).toMatchObject({ type: "min_age", years: 21, severity: "warning" });
    const gone = applyKycOps(r, [{ op: "remove_rule", rule: "21 or older" }]);
    expect(gone.rules.company).toHaveLength(0);
  });

  test("adding and removing fields; a custom document gets its own checks", () => {
    const r = applyKycOps(start(), [
      {
        op: "add_document_field",
        label: "Salary certificate",
        category: "custom",
        hasExpiry: false,
        required: true,
        shownTo: "individual",
      },
      { op: "add_question_field", label: "Employer", type: "text", required: true, shownTo: "individual" },
      { op: "remove_field", field: "visa" },
      { op: "publish" },
    ]);
    const salary = r.form.find((f) => f.label === "Salary certificate")!;
    expect(salary).toMatchObject({
      key: "salary_certificate",
      documentKind: "custom",
      customCategory: { hasExpiry: false },
    });
    expect(Object.keys(salary.rules!.checks).toSorted()).toEqual([
      "issued_recently",
      "name_matches",
      "readable",
      "right_document",
    ]);
    expect(r.form.some((f) => f.key === "employer")).toBe(true);
    expect(r.form.some((f) => f.documentKind === "visa")).toBe(false);
    expect(DocumentForm.safeParse(r.form).success).toBe(true);
    expect(r.publish).toBe(true);
  });

  test("unknown fields, wrong checks and fields used by custom checks are refused with a reason", () => {
    expect(() => applyKycOps(start(), [{ op: "remove_field", field: "salary slip" }])).toThrow(KycOpError);
    expect(() => applyKycOps(start(), [{ op: "set_check", field: "visa", check: "mrz", severity: "off" }])).toThrow(
      'has no check "mrz"',
    );
    expect(() =>
      applyKycOps(start(), [{ op: "set_number", field: "eid back", setting: "validity_days", value: 10 }]),
    ).toThrow("no expiry date");
    const withRule = applyKycOps(start(), [
      { op: "add_question_field", label: "Employer", type: "text", required: true, shownTo: "both" },
      { op: "add_rule", rule: { type: "answer_required", label: "Employer given", fieldKey: "employer" } },
    ]);
    expect(() => applyKycOps(withRule, [{ op: "remove_field", field: "Employer" }])).toThrow("remove them first");
  });

  test("the input config is never changed", () => {
    const s = start();
    const before = JSON.stringify(s);
    applyKycOps(s, [{ op: "set_number", field: "passport", setting: "validity_days", value: 180 }]);
    expect(JSON.stringify(s)).toBe(before);
  });
});

describe("KYC edits: names the copilot may use", () => {
  test("fields by label with punctuation, checks by their question, settings by plain words", () => {
    const op = KycOp.parse({
      op: "set_number",
      field: "Emirates ID front",
      setting: "valid at least days",
      value: "20",
    });
    const r = applyKycOps(start(), [
      op,
      { op: "set_check", field: "emirates id, front", check: "Read clearly?", severity: "blocker" },
    ]);
    const eid = r.form.find((f) => f.documentKind === "emirates_id_front")!;
    expect(eid.rules!.validityDays).toBe(20);
    expect(eid.rules!.checks.readable!.severity).toBe("blocker");
  });

  test("a setting name in the field slot is refused with the real fields listed", () => {
    expect(() =>
      applyKycOps(start(), [{ op: "set_number", field: "validity_days", setting: "validity_days", value: 20 }]),
    ).toThrow('"Emirates ID, front"');
  });
});
