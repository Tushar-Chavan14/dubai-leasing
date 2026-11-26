import { describe, expect, test } from "bun:test";
import { type CalendarDate, calendarDate } from "@platform/kernel/dates";
import { type NocDealInput, type NocRecordInput, nocChecks, selectNocRule } from "../src/index.ts";

// The engine passes its own name normaliser; here a simple one is enough.
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
const today = calendarDate("2026-11-19");
const record = (o: Partial<NocRecordInput> = {}): NocRecordInput => ({
  unitNo: "A-101",
  sellerNames: ["Seller One", "Seller Two"],
  expiresOn: "2027-03-01",
  serviceChargesCleared: true,
  paidFils: null,
  ...o,
});
const deal = (o: Partial<NocDealInput> = {}): NocDealInput => ({
  type: "resale_ready",
  unitNo: "A-101",
  sellerNames: ["SELLER TWO", "Seller  One"],
  targetTransferOn: "2027-01-15",
  priceFils: 200_000_000,
  ...o,
});
const rule = { minPaidBps: 4000 };
const run = (r = record(), d = deal(), t: CalendarDate = today) => nocChecks(r, d, rule, t, norm);

describe("nocChecks (C15)", () => {
  test("a matching NOC has no blocker", () => expect(run()).toEqual([]));
  test("unit_mismatch: another unit, or the deal has no unit recorded", () => {
    expect(run(record({ unitNo: "B-202" }))).toEqual(["unit_mismatch"]);
    expect(run(record(), deal({ unitNo: null }))).toEqual(["unit_mismatch"]);
    expect(run(record({ unitNo: " a-101 " }))).toEqual([]);
  });
  test("seller_names_mismatch: matched one to one, not a subset", () => {
    expect(run(record({ sellerNames: ["Seller One"] }))).toEqual(["seller_names_mismatch"]);
    expect(run(record({ sellerNames: ["Seller One", "Seller One"] }))).toEqual(["seller_names_mismatch"]);
    expect(run(record({ sellerNames: ["Seller One", "Other Person"] }))).toEqual(["seller_names_mismatch"]);
  });
  test("seller_names_mismatch: an empty list on either side never matches", () => {
    expect(run(record({ sellerNames: [] }), deal({ sellerNames: [] }))).toEqual(["seller_names_mismatch"]);
    expect(run(record({ sellerNames: [] }))).toEqual(["seller_names_mismatch"]);
    expect(run(record({ sellerNames: ["!!!", "Seller One"] }), deal({ sellerNames: ["???", "Seller One"] }))).toEqual([
      "seller_names_mismatch",
    ]);
  });
  test("expired_before_transfer: expiry before the target date, equal passes", () => {
    expect(run(record({ expiresOn: "2027-01-14" }))).toEqual(["expired_before_transfer"]);
    expect(run(record({ expiresOn: "2027-01-15" }))).toEqual([]);
  });
  test("a NOC already past its expiry is blocked even with a far target date", () => {
    expect(run(record({ expiresOn: "2026-11-18" }), deal({ targetTransferOn: "2026-11-10" }))).toEqual([
      "expired_before_transfer",
    ]);
  });
  test("no_target_date: blocks, and the expiry can't be compared", () => {
    expect(run(record(), deal({ targetTransferOn: null }))).toEqual(["no_target_date"]);
  });
  test("service_charges_not_cleared", () => {
    expect(run(record({ serviceChargesCleared: false }))).toEqual(["service_charges_not_cleared"]);
  });
  test("minimum paid applies to an off-plan resale only", () => {
    const off = deal({ type: "resale_offplan" });
    expect(run(record({ paidFils: 1 }), deal())).toEqual([]);
    expect(run(record({ paidFils: null }), deal())).toEqual([]);
    expect(run(record({ paidFils: 79_999_999 }), off)).toEqual(["below_minimum_paid"]);
    expect(run(record({ paidFils: 80_000_000 }), off)).toEqual([]);
  });
  test("paid_unconfirmed: nothing a person confirmed, off-plan resale", () => {
    expect(run(record({ paidFils: null, paidReadFils: 90_000_000 }), deal({ type: "resale_offplan" }))).toEqual([
      "paid_unconfirmed",
    ]);
  });
  test("integer maths: no rounding at the boundary", () => {
    const off = deal({ type: "resale_offplan", priceFils: 3 });
    // 40% of 3 fils is 1.2: 1 fil is below, 2 is enough.
    expect(run(record({ paidFils: 1 }), off)).toEqual(["below_minimum_paid"]);
    expect(run(record({ paidFils: 2 }), off)).toEqual([]);
  });
  test("several blockers are all reported", () => {
    expect(run(record({ unitNo: "X", serviceChargesCleared: false }))).toEqual([
      "unit_mismatch",
      "service_charges_not_cleared",
    ]);
  });
});

describe("selectNocRule", () => {
  const rules = [
    { projectCode: null, minPaidBps: 4000, validityDays: 30 },
    { projectCode: "P1", minPaidBps: 2500, validityDays: 30 },
  ];
  test("the project's own rule, else the default", () => {
    expect(selectNocRule(rules, "P1").minPaidBps).toBe(2500);
    expect(selectNocRule(rules, "P2").minPaidBps).toBe(4000);
    expect(selectNocRule(rules, null).minPaidBps).toBe(4000);
  });
});
