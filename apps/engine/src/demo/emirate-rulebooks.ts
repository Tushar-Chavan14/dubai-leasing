/**
 * Demo rulebooks for the six emirates other than Dubai (D55). They are demo seed data, not code
 * base versions: a real install stays fail-closed for these emirates until an admin publishes a
 * reviewed version. Values come from general public sources (confidence low to medium); every
 * source line says so. CONFIRM WITH LEGAL before real use.
 */
import { type CalendarDate, type Emirate, newId } from "@leasing/core";
import { type Database, rulebooks } from "@leasing/db";
import type { RulebookValues } from "@leasing/rulebook";

export interface DemoEmirateRulebook {
  version: string;
  emirate: Emirate;
  effectiveFrom: CalendarDate;
  values: RulebookValues;
}

const FROM = "2025-01-01" as CalendarDate;
const P = "From the general data available:";

function entry(
  emirate: Emirate,
  p: {
    version?: string;
    effectiveFrom?: CalendarDate;
    notice: number;
    send: number;
    repossession: number;
    lock: { residential: number; commercial: number };
    lateRent: number;
    cap: number;
    sources: string[];
  },
): DemoEmirateRulebook {
  return {
    version: p.version ?? `${emirate}-2025-01`,
    emirate,
    effectiveFrom: p.effectiveFrom ?? FROM,
    values: {
      renewalNoticeDays: p.notice,
      renewalSendAtDays: p.send,
      repossessionNoticeMonths: p.repossession,
      ownUseLockYears: p.lock,
      lateRentDaysAfterFormalReminder: p.lateRent,
      rentCapBands: [{ gapUpTo: 100, maxIncrease: p.cap }],
      aboveLastBandMaxIncrease: p.cap,
      renewalSchedule: { landlordIntentMonthsBefore: 13, assessMonthsBefore: 5, draftNoticeMonthsBefore: 4 },
      sources: p.sources.map((s) => `${P} ${s}`),
    },
  };
}

/** Versions of the demo seed rulebooks; only these may serve as a base without a code version. */
export function isDemoEmirateVersion(version: string): boolean {
  return DEMO_EMIRATE_RULEBOOKS.some((r) => r.version === version);
}

export const DEMO_EMIRATE_RULEBOOKS: readonly DemoEmirateRulebook[] = [
  entry("abu_dhabi", {
    version: "abu_dhabi-2026-06",
    effectiveFrom: "2026-06-02" as CalendarDate,
    notice: 60,
    send: 70,
    repossession: 12,
    lock: { residential: 1, commercial: 1 },
    lateRent: 30,
    cap: 0,
    sources: [
      "Law No. 20 of 2006 as amended (Laws 6/2009, 4/2010); 2-month renewal notice (low confidence; confirm with legal)",
      "ADREC 0% rent-increase freeze from 2 June 2026 (temporary; ADGM communities excluded) (low confidence; confirm with legal)",
      "Repossession notice, own-use lock and late-rent period assumed; confirm with legal",
    ],
  }),
  entry("sharjah", {
    notice: 90,
    send: 100,
    repossession: 12,
    lock: { residential: 3, commercial: 5 },
    lateRent: 15,
    cap: 0,
    sources: [
      "Law No. 5 of 2024 on landlord and tenant relations; RDRC (Law 6/2024) handles disputes",
      "No rent increase in the first 3 years of a tenancy (0% cap used)",
      "Eviction lock of 3 years residential and 5 years commercial; eviction for unpaid rent after 15 days",
      "Repossession notice: sources say 3 or 12 months; 12 months used; confirm with legal",
    ],
  }),
  entry("ajman", {
    notice: 90,
    send: 100,
    repossession: 12,
    lock: { residential: 2, commercial: 2 },
    lateRent: 30,
    cap: 0,
    sources: [
      "Law No. 3 of 2009 on landlord and tenant relations",
      "Old rule: no rent rise before 3 years (0% cap used)",
      "Notice period, repossession notice, own-use lock and late-rent period assumed; confirm with legal",
    ],
  }),
  entry("ras_al_khaimah", {
    notice: 90,
    send: 100,
    repossession: 12,
    lock: { residential: 2, commercial: 2 },
    lateRent: 30,
    cap: 5,
    sources: [
      "Amiri Decree No. 1 of 2008 on landlord and tenant relations (cited; low confidence; confirm with legal)",
      "5% residential rent-increase cap; 1-year repossession notice (low confidence; confirm with legal)",
      "Notice period, own-use lock and late-rent period assumed; confirm with legal",
    ],
  }),
  entry("fujairah", {
    notice: 90,
    send: 100,
    repossession: 12,
    lock: { residential: 2, commercial: 2 },
    lateRent: 30,
    cap: 5,
    sources: [
      "Rent increase of 5% a year (low confidence; no primary text found)",
      "Notice period, repossession notice, own-use lock and late-rent period assumed; confirm with legal",
    ],
  }),
  entry("umm_al_quwain", {
    notice: 90,
    send: 100,
    repossession: 12,
    lock: { residential: 2, commercial: 2 },
    lateRent: 30,
    cap: 10,
    sources: [
      "Law No. 3 of 2008 as amended by Law No. 2 of 2011",
      "Maximum rent increase 10% a year with 3 months' notice (90 days used as the notice period)",
      "Repossession notice, own-use lock and late-rent period assumed; confirm with legal",
    ],
  }),
];

/** Inserts the demo rulebooks as published rows (once per version). Run before `syncRulebooks`. */
export async function seedEmirateRulebooks(database: Database): Promise<void> {
  for (const r of DEMO_EMIRATE_RULEBOOKS) {
    await database.db
      .insert(rulebooks)
      .values({
        id: newId(),
        version: r.version,
        emirate: r.emirate,
        status: "published",
        basedOn: null,
        effectiveFrom: r.effectiveFrom,
        values: r.values,
        referenceRules: [],
        createdBy: "demo-seed",
        publishedBy: "demo-seed",
        // In force since its effective date (Dubai midnight), like the code base versions.
        publishedAt: new Date(`${r.effectiveFrom}T00:00:00+04:00`),
      })
      .onConflictDoNothing({ target: rulebooks.version });
  }
}
