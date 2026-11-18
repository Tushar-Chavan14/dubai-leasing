import { addDays, type CompanyPolicy, startOfDubaiDay, toDubaiDate } from "@leasing/core";

type SlotPolicy = Pick<
  CompanyPolicy,
  | "viewingDays"
  | "viewingStartHour"
  | "viewingEndHour"
  | "viewingSlotMinutes"
  | "viewingLeadHours"
  | "viewingHorizonDays"
>;

const MINUTE = 60_000;

/**
 * Viewing slots offered to Telegram enquirers (pure; decision D24). Slots follow company policy
 * in Asia/Dubai time: viewing days and hours, slot length, at least `viewingLeadHours` from now
 * and no more than `viewingHorizonDays` ahead. A slot is taken when any booked viewing on the
 * unit (staff or Telegram) falls within it. `now` comes from the Clock.
 */
export function freeViewingSlots(now: Date, policy: SlotPolicy, taken: readonly Date[], max = 8): Date[] {
  const slotMs = policy.viewingSlotMinutes * MINUTE;
  const earliest = now.getTime() + policy.viewingLeadHours * 60 * MINUTE;
  const latest = now.getTime() + policy.viewingHorizonDays * 24 * 60 * MINUTE;
  const today = toDubaiDate(now);
  const out: Date[] = [];
  for (let d = 0; d <= policy.viewingHorizonDays && out.length < max; d++) {
    const day = addDays(today, d);
    // The weekday of a calendar date doesn't depend on the time zone.
    if (!policy.viewingDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
    const dayStart = startOfDubaiDay(day).getTime();
    for (
      let m = policy.viewingStartHour * 60;
      m + policy.viewingSlotMinutes <= policy.viewingEndHour * 60 && out.length < max;
      m += policy.viewingSlotMinutes
    ) {
      const at = dayStart + m * MINUTE;
      if (at < earliest || at > latest) continue;
      if (taken.some((t) => t.getTime() > at - slotMs && t.getTime() < at + slotMs)) continue;
      out.push(new Date(at));
    }
  }
  return out;
}

/** Callback data for a slot: minutes since the epoch (fits Telegram's 64-byte limit). */
export const slotKey = (at: Date) => `slot:${Math.round(at.getTime() / MINUTE)}`;
export function parseSlotKey(data: string): Date | null {
  const m = /^slot:(\d{7,9})$/.exec(data);
  return m ? new Date(Number(m[1]) * MINUTE) : null;
}

const INSPECTION_MINUTES = 60;

/**
 * Move-out inspection slots (step 10): one-hour slots on viewing days and hours (Asia/Dubai),
 * from `inspectionBookingWindowDays` before the move-out date up to that date, at least
 * `viewingLeadHours` from now. Pure; `now` comes from the Clock.
 */
export function inspectionSlots(
  now: Date,
  policy: Pick<
    CompanyPolicy,
    "viewingDays" | "viewingStartHour" | "viewingEndHour" | "viewingLeadHours" | "inspectionBookingWindowDays"
  >,
  moveOutOn: string,
): Date[] {
  const earliest = now.getTime() + policy.viewingLeadHours * 60 * MINUTE;
  const out: Date[] = [];
  for (let d = -policy.inspectionBookingWindowDays; d <= 0; d++) {
    const day = addDays(moveOutOn as Parameters<typeof addDays>[0], d);
    if (!policy.viewingDays.includes(new Date(`${day}T00:00:00Z`).getUTCDay())) continue;
    const dayStart = startOfDubaiDay(day).getTime();
    for (
      let m = policy.viewingStartHour * 60;
      m + INSPECTION_MINUTES <= policy.viewingEndHour * 60;
      m += INSPECTION_MINUTES
    ) {
      const at = dayStart + m * MINUTE;
      if (at >= earliest) out.push(new Date(at));
    }
  }
  return out;
}
