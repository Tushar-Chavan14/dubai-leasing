import { describe, expect, test } from "bun:test";
import {
  ALERT_DEFAULT_HOURS,
  alertText,
  AlertThresholds,
  COMPLIANCE_EVENTS,
  isComplianceGate,
  SpaGateId,
  STAFF_EVENTS,
} from "../src/index.ts";

describe("alerts (C23, S30, S62)", () => {
  test("every gate has a positive whole-hour default", () => {
    for (const g of SpaGateId.options) {
      expect(Number.isInteger(ALERT_DEFAULT_HOURS[g])).toBe(true);
      expect(ALERT_DEFAULT_HOURS[g]).toBeGreaterThan(0);
    }
  });
  test("the text of an ordinary gate names the gate, the deal and the hours, and no AML word", () => {
    for (const g of SpaGateId.options.filter((x) => !isComplianceGate(x))) {
      const t = alertText({ gate: g, dealRef: "D-0007", hours: 30 });
      expect(t).toContain("D-0007");
      expect(t).toContain("30 hours");
      expect(t).not.toMatch(/aml|anti-money|sanction|screen|pep\b|edd|risk|launder|suspicious|compliance|report/i);
    }
  });
  test("a compliance gate reads the one generic sentence, whatever the gate", () => {
    for (const g of SpaGateId.options.filter(isComplianceGate))
      expect(alertText({ gate: g, dealRef: "D-0007", hours: 1 })).toBe("A compliance review has been waiting 1 hour.");
  });
  test("a gate without a deal leaves the ref out; 1 hour is singular", () => {
    expect(alertText({ gate: "template_approval", dealRef: null, hours: 1 })).toBe(
      "New template version has been waiting 1 hour.",
    );
  });
  test("thresholds: whole hours from 1 to 720, known gates or the one compliance key", () => {
    expect(AlertThresholds.safeParse({ kyc_review: 12 }).success).toBe(true);
    expect(AlertThresholds.safeParse({ compliance_review: 12 }).success).toBe(true);
    expect(AlertThresholds.safeParse({ kyc_review: 0 }).success).toBe(false);
    expect(AlertThresholds.safeParse({ kyc_review: 721 }).success).toBe(false);
    expect(AlertThresholds.safeParse({ kyc_review: 1.5 }).success).toBe(false);
    expect(AlertThresholds.safeParse({ nonsense: 5 }).success).toBe(false);
    expect(AlertThresholds.safeParse({}).success).toBe(false);
  });
  test("the new events are classified: exports, retention and reports are compliance only", () => {
    for (const e of [
      "CASE_EXPORTED",
      "RETENTION_REVIEW_LISTED",
      "RETENTION_REVIEW_APPROVED",
      "COMPLIANCE_REPORT_GENERATED",
      "COMPLIANCE_REPORT_EXPORTED",
    ]) {
      expect(COMPLIANCE_EVENTS.has(e)).toBe(true);
      expect(STAFF_EVENTS.has(e)).toBe(false);
    }
    expect(STAFF_EVENTS.has("ALERT_SETTINGS_SET")).toBe(true);
  });
});
