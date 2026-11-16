import { type ContractFields, paymentSchedule } from "@leasing/core";
import { formatCalendarDate, formatMoneyFils } from "../contract-structure/format.ts";

/**
 * The payment schedule printed in every contract: one line per rent cheque, from the same `paymentSchedule` that
 * schedules rent collection (dates and amounts come from code, never a model). Null when the term can't be scheduled.
 */
export function scheduleLines(
  f: Pick<ContractFields, "startOn" | "endOn" | "annualRentFils" | "cheques">,
): string[] | null {
  try {
    return paymentSchedule(f).map(
      (i) => `Cheque ${i.n} – ${formatCalendarDate(i.dueOn) ?? i.dueOn} – ${formatMoneyFils(i.amountFils)}`,
    );
  } catch {
    return null;
  }
}

export type ScheduleBlock =
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] };

/** The "Payment schedule" heading, the cheque list and, when known, who the cheques are payable to. */
export function scheduleBlocks(
  f: Pick<ContractFields, "startOn" | "endOn" | "annualRentFils" | "cheques">,
  payee?: string | null,
): ScheduleBlock[] {
  const lines = scheduleLines(f);
  if (!lines) return [];
  const out: ScheduleBlock[] = [
    { kind: "heading", text: "Payment schedule" },
    { kind: "list", items: lines },
  ];
  if (payee?.trim()) out.push({ kind: "para", text: `Payable to ${payee.trim()}` });
  return out;
}

/** The "Fees" heading and one line per fee that applies (name, amount, payer); nothing when there are none. */
export function feesBlocks(fees: readonly string[] | undefined): ScheduleBlock[] {
  const lines = (fees ?? []).map((l) => l.trim()).filter(Boolean);
  return lines.length
    ? [
        { kind: "heading", text: "Fees" },
        { kind: "list", items: lines },
      ]
    : [];
}
