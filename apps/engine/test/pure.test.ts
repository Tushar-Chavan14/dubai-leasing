import { describe, expect, test } from "bun:test";
import { calendarDate as d } from "@leasing/core";
import { issueToken, verifyToken } from "../src/api/auth.ts";
import { parseCsv } from "../src/import/csv.ts";
import { importedLeaseState } from "../src/import/lease-row.ts";
import { parseUnitRow, toUnitFields, UnitImportRow } from "../src/import/unit-row.ts";
import { checkDecision } from "../src/manager/gate-rules.ts";

describe("parseCsv", () => {
  test("quotes, escaped quotes, CRLF, BOM, blank lines", () => {
    const rows = parseCsv('﻿a,B\r\n"x, y","say ""hi"""\r\n\r\n1,2');
    expect(rows).toEqual([
      { a: "x, y", b: 'say "hi"' },
      { a: "1", b: "2" },
    ]);
  });
  test("missing trailing fields are empty", () => {
    expect(parseCsv("a,b\n1")).toEqual([{ a: "1", b: "" }]);
  });
  test("unterminated quote throws", () => {
    expect(() => parseCsv('a\n"oops')).toThrow();
  });
  test("header only → no rows", () => {
    expect(parseCsv("a,b\n")).toEqual([]);
  });
});

describe("unit import row", () => {
  const COMPANY = "0190e0a0-0000-7000-8000-000000000001";
  const good = {
    unit_code: "mrn-1204",
    building: "Marina Test Tower",
    community: "Dubai Marina",
    unit_no: "1204",
    makani_no: "12345 67890",
    bedrooms: "2",
    furnished: "Yes",
    asking_rent_aed: "AED 85,000",
    landlord_name: "Test Landlord",
    landlord_email: "landlord@test.example",
  };
  test("good row → UnitFields", () => {
    const r = parseUnitRow(good, COMPANY);
    expect(r).toMatchObject({
      ok: true,
      fields: {
        code: "MRN-1204",
        category: "residential",
        companyId: COMPANY,
        subtype: null,
        makaniNo: "1234567890",
        bedrooms: 2,
        furnished: true,
        askingRentFils: 8_500_000,
        bathrooms: null,
      },
    });
  });
  test("asking_rent 'AED 85,000' → fils", () => {
    const row = UnitImportRow.parse({ ...good, asking_rent_aed: "AED 85,000" });
    expect(toUnitFields(row, COMPANY).askingRentFils).toBe(8_500_000);
  });
  test("bad Makani is reported by CSV column", () => {
    const r = parseUnitRow({ ...good, makani_no: "12345" }, COMPANY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons).toEqual(["makani_no: Makani numbers have 10 digits"]);
  });
  test("company column: by name or slug, unknown → error, none and no default → error", () => {
    const known = [
      { id: "0190e0a0-0000-7000-8000-000000000002", name: "Silverline Properties", slug: "silverline", active: true },
    ];
    expect(parseUnitRow({ ...good, company: "silverline" }, null, known)).toMatchObject({
      ok: true,
      fields: { companyId: "0190e0a0-0000-7000-8000-000000000002" },
    });
    expect(parseUnitRow({ ...good, company: " SILVERLINE properties " }, null, known)).toMatchObject({ ok: true });
    const unknown = parseUnitRow({ ...good, company: "Nobody" }, COMPANY, known);
    expect(unknown.ok).toBe(false);
    expect(parseUnitRow(good, null, known).ok).toBe(false);
    expect(parseUnitRow(good, COMPANY, known)).toMatchObject({ ok: true, fields: { companyId: COMPANY } });
  });
  test("bad code and out-of-range bedrooms map to CSV columns", () => {
    const r = parseUnitRow({ ...good, unit_code: "X", bedrooms: "11" }, COMPANY);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.map((x) => x.split(":")[0]).toSorted()).toEqual(["bedrooms", "unit_code"]);
  });
  test("non-number bedrooms → error", () => {
    expect(parseUnitRow({ ...good, bedrooms: "two" }, COMPANY).ok).toBe(false);
  });
});

describe("importedLeaseState", () => {
  const today = d("2026-10-19");
  const v = "dubai-2025-01";
  test("ended → refused", () =>
    expect(importedLeaseState({ start_on: d("2025-01-01"), end_on: d("2026-10-18"), ejari_no: "E" }, today, v).ok).toBe(
      false,
    ));
  test("ends today → still running", () =>
    expect(importedLeaseState({ start_on: d("2025-10-20"), end_on: d("2026-10-19"), ejari_no: "E" }, today, v)).toEqual(
      { ok: true, state: "RENEWAL" },
    ));
  test("future with Ejari → MOVE_IN", () =>
    expect(importedLeaseState({ start_on: d("2026-10-20"), end_on: d("2027-10-19"), ejari_no: "E" }, today, v)).toEqual(
      { ok: true, state: "MOVE_IN" },
    ));
  test("future without Ejari → REGISTRATION", () =>
    expect(
      importedLeaseState({ start_on: d("2026-10-20"), end_on: d("2027-10-19"), ejari_no: null }, today, v),
    ).toEqual({ ok: true, state: "REGISTRATION" }));
  test("running without Ejari → refused", () =>
    expect(
      importedLeaseState({ start_on: d("2026-01-01"), end_on: d("2027-10-19"), ejari_no: null }, today, v).ok,
    ).toBe(false));
  test("T−5m boundary: on the day → RENEWAL, day before → ACTIVE", () => {
    // end 2027-03-19 → T−5m = 2026-10-19
    expect(importedLeaseState({ start_on: d("2026-03-20"), end_on: d("2027-03-19"), ejari_no: "E" }, today, v)).toEqual(
      { ok: true, state: "RENEWAL" },
    );
    expect(importedLeaseState({ start_on: d("2026-03-21"), end_on: d("2027-03-20"), ejari_no: "E" }, today, v)).toEqual(
      { ok: true, state: "ACTIVE" },
    );
  });
});

describe("session tokens", () => {
  test("round trip, expiry, tampering, wrong secret", () => {
    const t = issueToken("s1", "user-1", 1_000);
    expect(verifyToken("s1", t, 2_000)).toBe("user-1");
    expect(verifyToken("s1", t, 1_000 + 12 * 3_600_000 + 1)).toBeNull();
    expect(verifyToken("s2", t, 2_000)).toBeNull();
    const [body, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", exp: 9e15 })).toString("base64url");
    expect(verifyToken("s1", `${forged}.${sig}`, 2_000)).toBeNull();
    expect(verifyToken("s1", `${body}`, 2_000)).toBeNull();
    expect(verifyToken("s1", "garbage", 2_000)).toBeNull();
  });
});

describe("renewal_notice decision rules", () => {
  const proposal = {
    leaseId: "l1",
    leaseRef: "X/2026-06",
    rulesVersion: "dubai-2025-01",
    currentRentFils: 8_000_000,
    proposedRentFils: 8_000_000,
    sriAverageFils: 9_500_000, // 15.8% below → 5% cap → 8,400,000
    leaseEndOn: "2027-05-31",
    sendOn: "2027-02-20",
    legalDeadline: "2027-03-02",
    newTermStartOn: "2027-06-01",
    newTermEndOn: "2028-05-31",
  };
  const early = d("2027-01-31");
  test("approve same rent", () =>
    expect(checkDecision("renewal_notice", proposal, { decision: "approve" }, early)).toEqual([]));
  test("edit up to the cap", () =>
    expect(
      checkDecision("renewal_notice", proposal, { decision: "edit", proposal: { proposedRentFils: 8_400_000 } }, early),
    ).toEqual([]));
  test("edit one fil over the cap", () =>
    expect(
      checkDecision("renewal_notice", proposal, { decision: "edit", proposal: { proposedRentFils: 8_400_001 } }, early),
    ).toHaveLength(1));
  test("increase on T−90 allowed, on T−89 refused", () => {
    const edit = { decision: "edit" as const, proposal: { proposedRentFils: 8_200_000 } };
    expect(checkDecision("renewal_notice", proposal, edit, d("2027-03-02"))).toEqual([]);
    expect(checkDecision("renewal_notice", proposal, edit, d("2027-03-03"))).toHaveLength(1);
  });
  test("locked fields", () =>
    expect(
      checkDecision("renewal_notice", proposal, { decision: "edit", proposal: { sriAverageFils: 20_000_000 } }, early),
    ).toEqual(["sriAverageFils can't be edited"]));
  test("malformed proposal is refused", () =>
    expect(
      checkDecision("renewal_notice", { ...proposal, proposedRentFils: 1.5 }, { decision: "approve" }, early).length,
    ).toBeGreaterThan(0));
  test("vacate notice: must already be served, by T−12 months", () => {
    const v = {
      leaseId: "l1",
      rulesVersion: "dubai-2025-01",
      leaseEndOn: "2028-12-31",
      ground: "sale",
      servedOn: "2026-11-01",
      deliveryMethod: "notary",
      propertyKind: "residential",
    };
    expect(checkDecision("vacate_notice", v, { decision: "approve" }, d("2026-10-19"))).toEqual([
      "served date 2026-11-01 is in the future; approve after it is served",
    ]);
    expect(checkDecision("vacate_notice", v, { decision: "approve" }, d("2026-11-01"))).toEqual([]);
    expect(
      checkDecision("vacate_notice", { ...v, servedOn: "2028-01-01" }, { decision: "approve" }, d("2028-02-01")),
    ).toHaveLength(1);
    expect(
      checkDecision("vacate_notice", v, { decision: "edit", proposal: { servedOn: "2026-10-01" } }, d("2026-11-01")),
    ).toHaveLength(1);
  });
  test("gates without edit rules can't be edited", () =>
    expect(checkDecision("vacate_notice", {}, { decision: "edit", proposal: { a: 1 } }, early)).toHaveLength(1));
});
