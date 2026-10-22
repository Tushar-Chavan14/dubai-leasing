import {
  addDays,
  addYears,
  type CalendarDate,
  CompanyPolicy,
  formatAed,
  type Helper,
  isCalendarDate,
  OfferCounter,
  OfferTerms,
  percentOfFloor,
} from "@leasing/core";
import { z } from "zod";

/**
 * Offer helper (step 4), pure code: every number comes from the unit's approved asking rent and
 * company policy. It proposes terms, applies an applicant's counter-offer, and says whether the
 * terms are inside the company limits. It never sends anything or decides on its own: the
 * Manager emails in-limits offers and asks a manager to approve anything outside them.
 */
const calDate = z.string().refine(isCalendarDate);

export const OfferContext = z.object({
  mode: z.enum(["propose", "counter", "check"]),
  today: calDate,
  unit: z.object({ askingRentFils: z.number().int().positive(), furnished: z.boolean() }),
  policy: CompanyPolicy,
  revision: z.number().int().min(1),
  requestedMoveInOn: calDate.nullable(),
  /** The current offer (for counter and check). */
  current: OfferTerms.nullable(),
  counter: OfferCounter.nullable(),
});
export type OfferContext = z.infer<typeof OfferContext>;

export const OfferData = z.object({
  terms: OfferTerms,
  inLimits: z.boolean(),
  /** Each term outside the limits, in plain words. */
  problems: z.array(z.string()),
});
export type OfferData = z.infer<typeof OfferData>;

type Unit = OfferContext["unit"];
type Policy = CompanyPolicy;

/**
 * A 12-month term ends the day before the same date a year later; a term starting 29 February
 * ends 28 February (not 27th: `addYears` clamps 29 Feb to 28 Feb before the day is taken off).
 * CONFIRM WITH LEGAL the convention for terms starting 29 February.
 */
export const termEnd = (start: CalendarDate): CalendarDate =>
  start.endsWith("-02-29")
    ? (`${Number(start.slice(0, 4)) + 1}-02-28` as CalendarDate)
    : addDays(addYears(start, 1), -1);
const depositFor = (rent: number, unit: Unit, p: Policy) =>
  percentOfFloor(rent, unit.furnished ? p.depositPercentFurnished : p.depositPercentUnfurnished);

/** The default offer: approved asking rent, policy cheques and deposit, a 12-month term. */
export function proposeOffer(c: {
  today: CalendarDate;
  unit: Unit;
  policy: Policy;
  revision: number;
  requestedMoveInOn: CalendarDate | null;
}): OfferTerms {
  const latest = addDays(c.today, c.policy.maxMoveInDays);
  const earliest = addDays(c.today, 1);
  const wanted = c.requestedMoveInOn ?? addDays(c.today, 14);
  const moveInOn = wanted < earliest ? earliest : wanted > latest ? latest : wanted;
  const rent = c.unit.askingRentFils;
  return {
    revision: c.revision,
    annualRentFils: rent,
    askingRentFils: c.unit.askingRentFils,
    cheques: Math.min(Math.max(c.policy.offerDefaultCheques, c.policy.minCheques), c.policy.maxCheques),
    depositFils: depositFor(rent, c.unit, c.policy),
    rentFreeDays: 0,
    moveInOn,
    startOn: moveInOn,
    endOn: termEnd(moveInOn),
    reservationFils: percentOfFloor(rent, c.policy.reservationPercent),
    expiresOn: addDays(c.today, c.policy.offerValidDays),
  };
}

/** A counter-offer becomes a new revision: changed terms in, everything derived recomputed. */
export function applyCounter(c: {
  today: CalendarDate;
  unit: Unit;
  policy: Policy;
  revision: number;
  current: OfferTerms;
  counter: OfferCounter;
}): OfferTerms {
  const rent = c.counter.annualRentFils ?? c.current.annualRentFils;
  const moveInOn = (c.counter.moveInOn ?? c.current.moveInOn) as CalendarDate;
  return {
    ...c.current,
    revision: c.revision,
    annualRentFils: rent,
    // The limits refer to the unit's approved asking rent today, not the one in the earlier offer.
    askingRentFils: c.unit.askingRentFils,
    cheques: c.counter.cheques ?? c.current.cheques,
    depositFils: depositFor(rent, c.unit, c.policy),
    moveInOn,
    startOn: moveInOn,
    endOn: termEnd(moveInOn),
    reservationFils: percentOfFloor(rent, c.policy.reservationPercent),
    expiresOn: addDays(c.today, c.policy.offerValidDays),
    fromCounter: true,
  };
}

/** Company limits. Empty list = inside the limits (no approval needed). */
export function offerProblems(t: OfferTerms, unit: Unit, p: Policy, today: CalendarDate): string[] {
  const problems: string[] = [];
  const minRent = unit.askingRentFils - percentOfFloor(unit.askingRentFils, p.maxRentDiscountPercent);
  if (t.annualRentFils < minRent) {
    problems.push(
      `Rent ${formatAed(t.annualRentFils)} is below the approved asking rent ${formatAed(unit.askingRentFils)}${p.maxRentDiscountPercent ? ` less ${p.maxRentDiscountPercent}%` : ""} (lowest allowed ${formatAed(minRent)}).`,
    );
  }
  if (t.cheques < p.minCheques || t.cheques > p.maxCheques) {
    problems.push(`${t.cheques} cheques is outside the allowed ${p.minCheques}–${p.maxCheques}.`);
  }
  const deposit = depositFor(t.annualRentFils, unit, p);
  if (t.depositFils < deposit) {
    problems.push(`Deposit ${formatAed(t.depositFils)} is below the policy ${formatAed(deposit)}.`);
  }
  if (t.rentFreeDays > p.maxRentFreeDays) {
    problems.push(`${t.rentFreeDays} rent-free days is more than the allowed ${p.maxRentFreeDays}.`);
  }
  const latest = addDays(today, p.maxMoveInDays);
  if (t.moveInOn <= today || t.moveInOn > latest) {
    problems.push(`Move-in ${t.moveInOn} is outside the allowed window (after ${today}, by ${latest}).`);
  }
  if (t.startOn !== t.moveInOn || t.endOn !== termEnd(t.startOn as CalendarDate)) {
    problems.push("The term must start on the move-in date and run 12 months.");
  }
  if (t.reservationFils !== percentOfFloor(t.annualRentFils, p.reservationPercent)) {
    problems.push(`Reservation must be ${p.reservationPercent}% of the annual rent.`);
  }
  return problems;
}

export const offerHelper: Helper<OfferContext, OfferData> = {
  name: "offer",
  async run(input) {
    const c = input.context;
    const today = c.today as CalendarDate;
    let terms: OfferTerms;
    if (c.mode === "propose") {
      terms = proposeOffer({
        today,
        unit: c.unit,
        policy: c.policy,
        revision: c.revision,
        requestedMoveInOn: c.requestedMoveInOn as CalendarDate | null,
      });
    } else if (c.mode === "counter") {
      if (!c.current || !c.counter)
        return { status: "failed", reasons: ["counter needs the current offer and the counter"], sourceDocIds: [] };
      terms = applyCounter({
        today,
        unit: c.unit,
        policy: c.policy,
        revision: c.revision,
        current: c.current,
        counter: c.counter,
      });
    } else {
      if (!c.current) return { status: "failed", reasons: ["check needs the terms to check"], sourceDocIds: [] };
      terms = c.current;
    }
    const problems = offerProblems(terms, c.unit, c.policy, today);
    return {
      status: "ok",
      data: { terms, inLimits: problems.length === 0, problems },
      reasons: problems.length
        ? problems
        : [
            `Rent ${formatAed(terms.annualRentFils)} (approved asking rent), ${terms.cheques} cheques, deposit ${formatAed(terms.depositFils)}, move-in ${terms.moveInOn}: within company limits.`,
          ],
      sourceDocIds: [],
    };
  },
};
