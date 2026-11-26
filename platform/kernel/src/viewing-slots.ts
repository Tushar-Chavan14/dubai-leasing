import { addDays, startOfDubaiDay, toDubaiDate } from "./dates.ts";

/** The policy values a viewing slot grid needs (leasing company policy and SPA `viewings` policy both fit). */
export type SlotPolicy = {
  viewingDays: readonly number[];
  viewingStartHour: number;
  viewingEndHour: number;
  viewingSlotMinutes: number;
  viewingLeadHours: number;
  viewingHorizonDays: number;
};

const MINUTE = 60_000;

/**
 * Viewing slots offered to enquirers (pure; leasing D24, SPA S79). Slots follow policy in Asia/Dubai time:
 * viewing days and hours, slot length, at least `viewingLeadHours` from now and no more than
 * `viewingHorizonDays` ahead. A slot is taken when any taken instant falls within it. `now` comes from the Clock.
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
