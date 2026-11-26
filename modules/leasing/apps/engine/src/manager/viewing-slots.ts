import { addDays, type CompanyPolicy, startOfDubaiDay } from "@leasing/core";

export { freeViewingSlots } from "@platform/kernel/viewing-slots";

const MINUTE = 60_000;

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
