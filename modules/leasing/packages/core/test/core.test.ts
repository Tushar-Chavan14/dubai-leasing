import { describe, expect, test } from "bun:test";
import {
  addDays,
  AUTOPILOT_NUMBERS,
  AUTOPILOT_STEPS,
  AutopilotPatch,
  AutopilotStep,
  DEFAULT_AUTOPILOT,
  DEFAULT_AUTOPILOT_NUMBERS,
  LOCKED_STEPS,
  postponeOutOfQuietHours,
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
  test("per-helper chat models are optional and independent", () => {
    const none = loadEnv(base);
    expect(none.LEASING_ASSISTANT_MODEL).toBeUndefined();
    expect(none.CONTRACT_AI_MODEL).toBeUndefined();
    const set = loadEnv({
      ...base,
      CHAT_MODEL: "gemma4:e4b",
      LEASING_ASSISTANT_MODEL: "qwen3.5:9b  # pinned",
      CONTRACT_AI_MODEL: "",
    });
    expect(set.CHAT_MODEL).toBe("gemma4:e4b");
    expect(set.LEASING_ASSISTANT_MODEL).toBe("qwen3.5:9b");
    expect(set.CONTRACT_AI_MODEL).toBeUndefined();
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

describe("company policy autopilot", () => {
  test("older stored policy without autopilot parses with the defaults", () => {
    const { autopilot: _drop, ...old } = defaultCompanyPolicy;
    expect(CompanyPolicy.parse(old).autopilot).toEqual({ ...DEFAULT_AUTOPILOT, ...DEFAULT_AUTOPILOT_NUMBERS });
  });
  test("a policy stored with only the first six switches keeps them and fills the rest", () => {
    const six = {
      chat_viewing_booking: false,
      apply_without_viewing: true,
      auto_kyc_verify: false,
      auto_send_offer: false,
      auto_send_counter: true,
      auto_prepare_contract: false,
    };
    const a = CompanyPolicy.parse({ ...defaultCompanyPolicy, autopilot: six }).autopilot;
    expect(a.chat_viewing_booking).toBe(false);
    expect(a.apply_without_viewing).toBe(true);
    expect(a.viewing_reminder).toBe(true);
    expect(a.held_offer_auto_release).toBe(false);
    expect(a.kyc_chase_hours).toBe(48);
    expect(a.agent_daily_action_cap).toBe(5);
  });
  test("defaults: the new switches start at today's behaviour or the safer option", () => {
    const off = [
      "no_show_followup",
      "held_offer_auto_release",
      "contract_ai_auto_approve_valueless",
      "copilot_proactive_drafts",
    ];
    for (const id of off) expect(DEFAULT_AUTOPILOT[id as AutopilotStep]).toBe(false);
    expect(DEFAULT_AUTOPILOT_NUMBERS).toMatchObject({
      kyc_chase_hours: 48,
      sign_reminder_days: 3,
      held_offer_release_hours: 24,
      quiet_hours_start: 22,
      quiet_hours_end: 8,
      agent_daily_action_cap: 5,
    });
  });
  test("numbers are bounded: a save outside the bounds is refused", () => {
    for (const [k, v] of Object.entries(AUTOPILOT_NUMBERS)) {
      expect(AutopilotPatch.safeParse({ [k]: v.min }).success).toBe(true);
      expect(AutopilotPatch.safeParse({ [k]: v.max }).success).toBe(true);
      expect(AutopilotPatch.safeParse({ [k]: v.min - 1 }).success).toBe(false);
      expect(AutopilotPatch.safeParse({ [k]: v.max + 1 }).success).toBe(false);
    }
    expect(AutopilotPatch.safeParse({ kyc_chase_hours: 1.5 }).success).toBe(false);
    expect(AutopilotPatch.safeParse({ bogus: true }).success).toBe(false);
  });
  test("every step is listed once in a group, and none is a locked gate", () => {
    const ids = AUTOPILOT_STEPS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.toSorted()).toEqual(AutopilotStep.options.toSorted());
    const locked = LOCKED_STEPS.map((l) => l.label.toLowerCase());
    for (const s of AUTOPILOT_STEPS) {
      expect(locked).not.toContain(s.label.toLowerCase());
      expect(s.id).not.toMatch(/final_contract|ejari_submission|ejari_submit|submit|reservation|kyc_review/);
    }
    expect(LOCKED_STEPS.map((l) => l.label)).toEqual([
      "Final contract",
      "Ejari submission",
      "Offer or price outside limits",
      "Flagged KYC",
      "Recording a reservation payment",
    ]);
  });
});

describe("quiet hours", () => {
  // Dubai is UTC+4: 22:00 Dubai = 18:00 UTC.
  const at = (iso: string) => new Date(iso);
  test("outside the window nothing moves", () => {
    expect(postponeOutOfQuietHours(at("2026-11-02T08:00:00Z"), 22, 8)).toEqual(at("2026-11-02T08:00:00Z"));
  });
  test("late evening moves to the next morning, early morning to the same morning", () => {
    expect(postponeOutOfQuietHours(at("2026-11-02T19:30:00Z"), 22, 8)).toEqual(at("2026-11-03T04:00:00Z"));
    expect(postponeOutOfQuietHours(at("2026-11-03T01:00:00Z"), 22, 8)).toEqual(at("2026-11-03T04:00:00Z"));
  });
  test("a window that does not wrap, and an empty one", () => {
    expect(postponeOutOfQuietHours(at("2026-11-02T10:00:00Z"), 12, 15)).toEqual(at("2026-11-02T11:00:00Z"));
    expect(postponeOutOfQuietHours(at("2026-11-02T19:30:00Z"), 5, 5)).toEqual(at("2026-11-02T19:30:00Z"));
  });
});
