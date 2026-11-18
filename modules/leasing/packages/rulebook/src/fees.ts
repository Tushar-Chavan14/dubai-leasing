import { type CalendarDate, type Emirate, type Fils, calendarDate, fils } from "@leasing/core";
import { deepFreeze } from "./schema.ts";

/**
 * Registration fees are government tariffs charged on the registration date. They are not part of
 * the lease-pinned rulebook (a published rulebook version never changes), so they live here as
 * code-versioned schedules. No model computes them (rule 1). `bp` is basis points of annual rent.
 */
export type RegistrationFeeRule =
  | { kind: "flat"; amountFils: number }
  | { kind: "percent"; bp: number; minFils?: number; plusFils?: number }
  | { kind: "tiered"; thresholdFils: number; belowFils: number; aboveBp: number };

export interface RegistrationFeeSchedule {
  emirate: Emirate;
  effectiveFrom: CalendarDate;
  rule: RegistrationFeeRule;
  sources: readonly string[];
}

const FROM = calendarDate("2025-01-01");
const src = (summary: string) => `From the general data available: ${summary}`;

export const REGISTRATION_FEE_SCHEDULES: readonly RegistrationFeeSchedule[] = deepFreeze([
  {
    emirate: "dubai",
    effectiveFrom: FROM,
    rule: { kind: "flat", amountFils: 17_775 },
    sources: [
      src("Ejari online AED 177.75 (100 registration + 10 knowledge + 10 innovation + 55 service partner + 2.75 VAT)."),
    ],
  },
  {
    emirate: "abu_dhabi",
    effectiveFrom: FROM,
    rule: { kind: "flat", amountFils: 5_000 },
    sources: [src("Tawtheeq AED 50 per contract via TAMM (low confidence; confirm with legal).")],
  },
  {
    emirate: "sharjah",
    effectiveFrom: FROM,
    rule: { kind: "percent", bp: 400, minFils: 50_000, plusFils: 10_000 },
    sources: [
      src("4% of annual rent, minimum AED 500, plus AED 100 contract form (low confidence; confirm with legal)."),
    ],
  },
  {
    emirate: "ajman",
    effectiveFrom: FROM,
    rule: { kind: "percent", bp: 200, minFils: 40_000 },
    sources: [src("Tasdeeq 2% of annual rent, minimum AED 400 (low confidence; confirm with legal).")],
  },
  {
    emirate: "umm_al_quwain",
    effectiveFrom: FROM,
    rule: { kind: "percent", bp: 200, plusFils: 4_000 },
    sources: [src("2% of annual rent plus AED 40 (low confidence; confirm with legal).")],
  },
  {
    emirate: "fujairah",
    effectiveFrom: FROM,
    rule: { kind: "tiered", thresholdFils: 1_500_000, belowFils: 30_000, aboveBp: 200 },
    sources: [
      src(
        "Ejaar AED 300 if annual rent is below AED 15,000, otherwise 2% of annual rent (low confidence; confirm with legal).",
      ),
    ],
  },
  {
    emirate: "ras_al_khaimah",
    effectiveFrom: FROM,
    rule: { kind: "percent", bp: 500, plusFils: 2_500 },
    sources: [
      src(
        "RAK Municipality (Sanad) tenancy registration, AED 25 + 5% of annual rent (medium confidence; confirm with legal)",
      ),
    ],
  },
] satisfies RegistrationFeeSchedule[]);

/** The latest schedule for the emirate with `effectiveFrom` on or before `onDate`; null if none. */
export function registrationFeeFor(emirate: Emirate, onDate: CalendarDate): RegistrationFeeSchedule | null {
  let best: RegistrationFeeSchedule | null = null;
  for (const s of REGISTRATION_FEE_SCHEDULES) {
    if (s.emirate !== emirate || s.effectiveFrom > onDate) continue;
    if (!best || s.effectiveFrom >= best.effectiveFrom) best = s;
  }
  return best;
}

/** `rent × bp / 10000` in whole fils, rounded half up, integer math only. */
function percentHalfUp(rent: number, bp: number): number {
  return Math.floor((rent * bp + 5000) / 10_000);
}

/** The fee in integer fils for the annual rent. The minimum applies before the plus amount. */
export function registrationFeeFils(rule: RegistrationFeeRule, annualRentFils: number): Fils {
  if (!Number.isSafeInteger(annualRentFils) || annualRentFils <= 0)
    throw new Error(`annual rent must be a positive integer in fils, got ${annualRentFils}`);
  switch (rule.kind) {
    case "flat":
      return fils(rule.amountFils);
    case "percent": {
      const pct = percentHalfUp(annualRentFils, rule.bp);
      return fils(Math.max(pct, rule.minFils ?? 0) + (rule.plusFils ?? 0));
    }
    case "tiered":
      return fils(annualRentFils < rule.thresholdFils ? rule.belowFils : percentHalfUp(annualRentFils, rule.aboveBp));
  }
}
