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
  type TermValues,
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

/**
 * Offer limits for one unit (D63): the company policy with `maxRentDiscountPercent` taken from the unit's rent rule
 * when the rule sets one, and the rule's lowest allowed asking rent (`offerFloorMinFils`), below which a counter
 * always needs a manager.
 */
export type OfferPolicy = Policy & { offerFloorMinFils?: number | null };

/**
 * The lowest annual rent an offer may have without a manager: the approved asking rent less the discount, but never
 * below the rent rule's lowest allowed rent (unless the asking rent itself is already below it, approved by a manager).
 * This is the negotiation limit; the rent rule's range limits the asking rent itself.
 */
export function offerRentFloorFils(
  askingRentFils: number,
  p: Pick<OfferPolicy, "maxRentDiscountPercent" | "offerFloorMinFils">,
): number {
  const discounted = askingRentFils - percentOfFloor(askingRentFils, p.maxRentDiscountPercent);
  const bandMin = p.offerFloorMinFils ?? null;
  return bandMin !== null && bandMin <= askingRentFils ? Math.max(discounted, bandMin) : discounted;
}

/** Company limits. Empty list = inside the limits (no approval needed). */
export function offerProblems(t: OfferTerms, unit: Unit, p: OfferPolicy, today: CalendarDate): string[] {
  const problems: string[] = [];
  const minRent = offerRentFloorFils(unit.askingRentFils, p);
  if (t.annualRentFils < minRent) {
    problems.push(
      `Rent ${formatAed(t.annualRentFils)} is below the approved asking rent ${formatAed(unit.askingRentFils)}${p.maxRentDiscountPercent ? ` less ${p.maxRentDiscountPercent}%` : ""} (lowest allowed ${formatAed(minRent)}${p.offerFloorMinFils !== null && p.offerFloorMinFils !== undefined && minRent === p.offerFloorMinFils && p.maxRentDiscountPercent ? ", the rent rule's lowest rent" : ""}).`,
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

/** The terms as one human-readable string for the stored before/after of a mark. */
export function termText(v: TermValues): string {
  const parts: string[] = [];
  if (v.annualRentFils !== undefined) parts.push(`Rent ${formatAed(v.annualRentFils)}`);
  if (v.depositFils !== undefined) parts.push(`Deposit ${formatAed(v.depositFils)}`);
  if (v.cheques !== undefined) parts.push(`${v.cheques} cheques`);
  if (v.moveInOn !== undefined) parts.push(`Move-in ${v.moveInOn}`);
  if (v.startOn !== undefined) parts.push(`Start ${v.startOn}`);
  return parts.join("; ");
}

/** One term as a short line for staff: "Rent AED 50,000 → AED 48,000". */
export function termLines(from: TermValues, to: TermValues): string[] {
  const out: string[] = [];
  const money = (label: string, a?: number, b?: number) => {
    if (b !== undefined) out.push(`${label} ${a === undefined ? "" : `${formatAed(a)} → `}${formatAed(b)}`);
  };
  money("Rent", from.annualRentFils, to.annualRentFils);
  money("Deposit", from.depositFils, to.depositFils);
  if (to.cheques !== undefined) out.push(`Cheques ${from.cheques ?? "?"} → ${to.cheques}`);
  if (to.moveInOn !== undefined) out.push(`Move-in ${from.moveInOn ?? "?"} → ${to.moveInOn}`);
  if (to.startOn !== undefined) out.push(`Start ${from.startOn ?? "?"} → ${to.startOn}`);
  return out;
}

export interface TermPlan {
  /** The full new terms, everything derived recomputed by code. */
  terms: OfferTerms;
  /** Only the values that change (from the current terms, to the new ones, derived values included). */
  from: TermValues;
  to: TermValues;
  /** Outside the offer limits (empty = inside). A non-empty list needs a leasing manager (rule 3). */
  problems: string[];
  /** Things finance should know (the reservation already paid is not changed). */
  notes: string[];
}

/**
 * D72: an officer's change to a lease's terms, planned by code. The new term starts on the move-in date (the offer's
 * convention; a start given alone moves the move-in with it) and ends 12 months less a day later. The deposit is the
 * policy's for the new rent unless the officer gave one. The reservation already paid and the rent-free days are not
 * changed. `problems` is `offerProblems` on the result: the move-in window is judged only when the date changes (a
 * lease in contract may already be past its original window).
 */
export function planTermChange(
  current: OfferTerms,
  change: TermValues,
  unit: Unit,
  policy: OfferPolicy,
  today: CalendarDate,
): TermPlan {
  const rent = change.annualRentFils ?? current.annualRentFils;
  const moveInOn = (change.moveInOn ?? change.startOn ?? current.moveInOn) as CalendarDate;
  const startOn = (change.startOn ?? change.moveInOn ?? current.startOn) as CalendarDate;
  const deposit =
    change.depositFils ?? (rent !== current.annualRentFils ? depositFor(rent, unit, policy) : current.depositFils);
  const terms: OfferTerms = {
    ...current,
    annualRentFils: rent,
    askingRentFils: unit.askingRentFils,
    cheques: change.cheques ?? current.cheques,
    depositFils: deposit,
    moveInOn,
    startOn,
    endOn: termEnd(startOn),
  };
  const moved = terms.moveInOn !== current.moveInOn;
  // The reservation is not recomputed: judge the rest against what the policy would ask for this rent.
  const judged = { ...terms, reservationFils: percentOfFloor(rent, policy.reservationPercent) };
  const problems = offerProblems(judged, unit, policy, today).filter((p) => moved || !p.startsWith("Move-in "));
  const notes: string[] = [];
  if (terms.reservationFils !== percentOfFloor(rent, policy.reservationPercent) || deposit !== current.depositFils)
    notes.push(
      `The reservation of ${formatAed(current.reservationFils)} already paid is not changed; finance follows up if the new rent or deposit makes it inconsistent.`,
    );
  const from: TermValues = {};
  const to: TermValues = {};
  const keys = ["annualRentFils", "depositFils", "cheques", "moveInOn", "startOn"] as const;
  for (const k of keys) {
    if (terms[k] !== current[k]) {
      (from as Record<string, unknown>)[k] = current[k];
      (to as Record<string, unknown>)[k] = terms[k];
    }
  }
  return { terms, from, to, problems, notes };
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
