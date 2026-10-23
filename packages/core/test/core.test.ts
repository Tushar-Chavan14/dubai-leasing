import { describe, expect, test } from "bun:test";
import {
  addDays,
  addMonths,
  aed,
  calendarDate as d,
  DemoClock,
  diffDays,
  FixedClock,
  formatAed,
  isCalendarDate,
  isValidEmiratesId,
  loadEnv,
  maskPii,
  maskPiiText,
  parseAed,
  percentOfFloor,
  splitFils,
  startOfDubaiDay,
  toDubaiDate,
  CompanyPolicy,
  defaultCompanyPolicy,
  DepositResponse,
  VacateNotice,
} from "../src/index.ts";

describe("calendar dates", () => {
  test("validation", () => {
    expect(isCalendarDate("2028-02-29")).toBe(true);
    expect(isCalendarDate("2027-02-29")).toBe(false);
    expect(isCalendarDate("2026-13-01")).toBe(false);
    expect(isCalendarDate("2026-1-01")).toBe(false);
    expect(() => d("nope")).toThrow();
  });
  test("addDays across year end and leap day", () => {
    expect(addDays(d("2026-12-31"), 1)).toBe(d("2027-01-01"));
    expect(addDays(d("2028-03-01"), -1)).toBe(d("2028-02-29"));
    expect(addDays(d("2027-03-01"), -1)).toBe(d("2027-02-28"));
  });
  test("addMonths clamps to month end", () => {
    expect(addMonths(d("2026-03-31"), -1)).toBe(d("2026-02-28"));
    expect(addMonths(d("2028-03-31"), -1)).toBe(d("2028-02-29"));
    expect(addMonths(d("2026-01-31"), 1)).toBe(d("2026-02-28"));
    expect(addMonths(d("2026-12-31"), -13)).toBe(d("2025-11-30"));
    expect(addMonths(d("2026-05-15"), 12)).toBe(d("2027-05-15"));
  });
  test("diffDays", () => {
    expect(diffDays(d("2026-01-01"), d("2026-12-31"))).toBe(364);
    expect(diffDays(d("2028-01-01"), d("2028-12-31"))).toBe(365);
  });
  test("Dubai date of an instant: 21:00 UTC is already the next day in Dubai", () => {
    expect(toDubaiDate(new Date("2026-09-21T19:59:59Z"))).toBe(d("2026-09-21"));
    expect(toDubaiDate(new Date("2026-09-21T20:00:00Z"))).toBe(d("2026-09-22"));
  });
  test("start of a Dubai day is 20:00 UTC the day before", () => {
    expect(startOfDubaiDay(d("2026-09-22")).toISOString()).toBe("2026-09-21T20:00:00.000Z");
  });
});

describe("clocks", () => {
  test("FixedClock today is the Dubai date", () => {
    const c = new FixedClock(new Date("2026-09-21T22:00:00Z"));
    expect(c.today()).toBe(d("2026-09-22"));
    c.advanceDays(10);
    expect(c.today()).toBe(d("2026-10-02"));
  });
  test("DemoClock applies the offset on every call", () => {
    let offset = 0;
    const base = new FixedClock(new Date("2026-01-01T08:00:00Z"));
    const c = new DemoClock(() => offset, base);
    expect(c.today()).toBe(d("2026-01-01"));
    offset = 30 * 86_400_000;
    expect(c.today()).toBe(d("2026-01-31"));
  });
});

describe("money", () => {
  test("parseAed without floats", () => {
    expect<number>(parseAed("85,000")).toBe(8_500_000);
    expect<number>(parseAed("85000.5")).toBe(8_500_050);
    expect<number>(parseAed("AED 1,234.56")).toBe(123_456);
    expect<number>(parseAed("0.1")).toBe(10);
    expect(() => parseAed("85,00")).toThrow();
    expect(() => parseAed("1.234")).toThrow();
    expect(() => parseAed("abc")).toThrow();
  });
  test("formatAed", () => {
    expect(formatAed(aed(85_000))).toBe("AED 85,000.00");
    expect(formatAed(123_456)).toBe("AED 1,234.56");
    expect(formatAed(-5)).toBe("-AED 0.05");
  });
  test("percentOfFloor rounds down", () => {
    expect<number>(percentOfFloor(999, 5)).toBe(49);
    expect(() => percentOfFloor(100, 2.5)).toThrow();
  });
  test("splitFils keeps the total", () => {
    const parts = splitFils(10_000_001, 4);
    expect<number[]>(parts).toEqual([2_500_001, 2_500_000, 2_500_000, 2_500_000]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10_000_001);
    expect(() => splitFils(100, 0)).toThrow();
  });
});

describe("maskPii", () => {
  test("ID number fields are masked by name, whatever their shape", () => {
    const out = maskPii({
      tenantIdNo: "123456789",
      landlordIdNo: "DEMO-TL-0001",
      tenantTradeLicenceNo: "CN-99881",
      ejariNo: "SIM-1",
    });
    expect(out.tenantIdNo).toBe("*******89");
    expect(out.landlordIdNo).not.toContain("0001");
    expect(out.tenantTradeLicenceNo).not.toContain("998");
    expect(out.ejariNo).toBe("SIM-1");
  });
  test("Emirates ID", () => {
    expect(maskPiiText("ID 784-1990-1234567-1 ok")).toBe("ID ***-****-*****67-1 ok");
  });
  test("keeps only the tail of each identifier", () => {
    const out = maskPiiText("EID 784-1990-1234567-1, passport N1234567, phone +971 50 123 4567");
    expect(out).not.toContain("1234567");
    expect(out).not.toContain("123 4567");
    expect(out).toContain("67-1");
    expect(out).toContain("567");
  });
  test("local phone format", () => {
    expect(maskPiiText("call 050-123-4567")).toBe("call ***-***-**67");
  });
  test("objects: sensitive keys fully masked, text masked", () => {
    const out = maskPii({
      name: "Test Person",
      phone: "0501234567",
      note: "EID 784199012345671",
      nested: [{ passportNo: "X9" }],
    });
    expect(out.name).toBe("Test Person");
    expect(out.phone).toBe("********67");
    expect(out.note).not.toContain("12345671");
    expect(out.nested[0]?.passportNo).toBe("X9");
  });
  test("leaves dates and amounts alone", () => {
    expect(maskPiiText("Due 2026-10-02 for AED 85,000.00")).toBe("Due 2026-10-02 for AED 85,000.00");
  });
});

describe("Emirates ID", () => {
  test("valid Luhn", () => {
    expect(isValidEmiratesId("784-1990-1234567-0")).toBe(false);
    // Fictional number with a correct check digit.
    const valid = ["784-1985-4021973-", "784-2001-7720154-"].map((p) => {
      for (let c = 0; c <= 9; c++) if (isValidEmiratesId(`${p}${c}`)) return `${p}${c}`;
      return null;
    });
    expect(valid.every((v) => v !== null)).toBe(true);
  });
  test("wrong prefix or length", () => {
    expect(isValidEmiratesId("785-1990-1234567-1")).toBe(false);
    expect(isValidEmiratesId("784-1990-123456-1")).toBe(false);
  });
});

describe("env", () => {
  const base = { DATABASE_URL: "postgres://u:p@localhost/db", DEMO_MODE: "true" };
  test("empty strings and inline comments count as unset", () => {
    const env = loadEnv({
      ...base,
      COPILOT_MODEL: "                 # staff copilot",
      TELEGRAM_MODE: "polling          # polling | webhook",
    });
    expect(env.COPILOT_MODEL).toBeUndefined();
    expect(env.TELEGRAM_MODE).toBe("polling");
    expect(env.ENGINE_PORT).toBe(4000);
    expect(env.DEMO_MODE).toBe(true);
  });
  test("rejects a non-Dubai timezone", () => {
    expect(() => loadEnv({ ...base, TIMEZONE: "UTC" })).toThrow(/TIMEZONE/);
  });
  test("session secret required outside demo mode", () => {
    expect(() => loadEnv({ ...base, DEMO_MODE: "false" })).toThrow(/SESSION_SECRET/);
  });
  test("missing DATABASE_URL", () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("move-out forms (step 10)", () => {
  test("IBANs are masked in text and under an `iban` key", () => {
    expect(maskPiiText("refund to AE07 0331 2345 6789 0123 456 please")).toBe(
      "refund to **** **** **** **** ***3 456 please",
    );
    expect(maskPii({ iban: "AE070331234567890123456" }).iban).toBe("*********************56");
  });
  test("deposit response: accept needs account and IBAN (normalised); dispute needs a reason", () => {
    const ok = DepositResponse.parse({
      revision: 1,
      choice: "accept",
      accountName: "A Tenant",
      iban: "ae07 0331 2345 6789 0123 456",
    });
    expect(ok.iban).toBe("AE070331234567890123456");
    expect(DepositResponse.safeParse({ revision: 1, choice: "accept", accountName: "A Tenant" }).success).toBe(false);
    expect(DepositResponse.safeParse({ revision: 1, choice: "accept", accountName: "A", iban: "12345" }).success).toBe(
      false,
    );
    expect(DepositResponse.safeParse({ revision: 1, choice: "dispute" }).success).toBe(false);
    expect(
      DepositResponse.safeParse({ revision: 1, choice: "dispute", reason: "the wall was cracked at move-in" }).success,
    ).toBe(true);
  });
  test("notice to vacate needs the confirmation tick", () => {
    expect(VacateNotice.safeParse({ moveOutOn: "2027-01-31" }).success).toBe(false);
    expect(VacateNotice.safeParse({ moveOutOn: "2027-01-31", confirmVacate: true }).success).toBe(true);
  });
  test("the default price list parses and every id is unique", () => {
    const ids = defaultCompanyPolicy.deductionPriceList.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(CompanyPolicy.parse(defaultCompanyPolicy).deductionPriceList).toHaveLength(ids.length);
  });
});
