import { describe, expect, test } from "bun:test";
import {
  blockedMessage,
  cardStatus,
  clampDate,
  feeText,
  registrationRecordSpec,
  registrationRejectedSpec,
} from "../components/chat-ui/decision-card-helpers.ts";

const card = {
  leaseId: "l1",
  submissionId: "s1",
  portalName: "Sanad",
  reference: "R-1",
  issuedOn: "2026-11-01",
  today: "2026-11-09",
  feePaidAed: "25",
};

describe("registration record card", () => {
  test("prefills what the user typed, hides ids, requires reference and date", () => {
    const s = registrationRecordSpec(card);
    expect(s.hidden).toEqual({ leaseId: "l1", submissionId: "s1" });
    expect(s.reference).toMatchObject({ label: "Sanad reference", required: true, maxLength: 60, defaultValue: "R-1" });
    expect(s.issuedOn).toEqual({ required: true, max: "2026-11-09", defaultValue: "2026-11-01" });
    expect(s.fee).toMatchObject({ required: false, defaultValue: "25" });
  });
  test("date is clamped to today", () => {
    expect(clampDate("2026-12-01", "2026-11-09")).toBe("2026-11-09");
    expect(clampDate("2026-11-09", "2026-11-09")).toBe("2026-11-09");
    expect(clampDate("", "2026-11-09")).toBe("");
    expect(registrationRecordSpec({ ...card, issuedOn: "2027-01-01" }).issuedOn.defaultValue).toBe("2026-11-09");
  });
  test("fee text", () => {
    expect(feeText("25")).toBe("AED 25");
    expect(feeText("  ")).toBe("No fee given");
  });
});

describe("registration rejected card", () => {
  test("reasons required, labelled with the portal", () => {
    const s = registrationRejectedSpec({ ...card, reasons: "Wrong plot" });
    expect(s.hidden).toEqual({ leaseId: "l1", submissionId: "s1" });
    expect(s.reasons).toEqual({
      label: "Why Sanad refused it",
      required: true,
      maxLength: 1000,
      defaultValue: "Wrong plot",
    });
  });
});

describe("blocked card", () => {
  test("status and message", () => {
    expect(cardStatus("Managers only")).toEqual({ label: "Not yours to decide", tone: "neutral" });
    expect(cardStatus()).toEqual({ label: "Your decision", tone: "waiting" });
    expect(blockedMessage("Managers only")).toBe("Managers only");
    expect(blockedMessage(undefined)).toBeNull();
  });
});
