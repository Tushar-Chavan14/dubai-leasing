import { addMonths, type CalendarDate, diffDays } from "./dates.ts";
import { splitFils } from "./money.ts";

export interface Instalment {
  /** 1-based within the term. */
  n: number;
  dueOn: CalendarDate;
  amountFils: number;
}

/**
 * The rent instalments of one term (pure; no model, no rulebook value). `cheques` equal parts
 * (the remainder fils go to the first ones), due on the start date and then every
 * 12 / cheques months, so 4 cheques fall on months 0, 3, 6, 9 of the term. Terms of other
 * lengths spread the instalments over their own months.
 */
export function paymentSchedule(term: {
  startOn: CalendarDate;
  endOn: CalendarDate;
  annualRentFils: number;
  cheques: number;
}): Instalment[] {
  if (!Number.isInteger(term.cheques) || term.cheques < 1 || term.cheques > 12)
    throw new RangeError("cheques must be 1–12");
  if (term.endOn <= term.startOn) throw new RangeError("the term must end after it starts");
  const months = Math.max(1, Math.round(diffDays(term.startOn, term.endOn) / 30.4375));
  const step = months / term.cheques;
  const amounts = splitFils(term.annualRentFils, term.cheques);
  return amounts.map((amountFils, i) => ({
    n: i + 1,
    dueOn: addMonths(term.startOn, Math.floor(i * step)),
    amountFils,
  }));
}
