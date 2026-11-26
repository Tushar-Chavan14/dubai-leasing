/**
 * Viewing times on the public form (S79). The engine sends ISO instants; the page shows Dubai wall time, grouped by day.
 * Pure: `Intl` with a fixed zone, so the server and the browser print the same words.
 */
const ZONE = "Asia/Dubai";
const part = (d: Date, opts: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, ...opts }).format(d);

export interface SlotDay {
  /** The Dubai calendar day, `2026-11-26`. */
  day: string;
  /** "Thursday 26 Nov". */
  label: string;
  times: { iso: string; label: string }[];
}

export function groupSlotsByDay(slots: readonly string[]): SlotDay[] {
  const days = new Map<string, SlotDay>();
  for (const iso of slots) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) continue;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
    const entry = days.get(parts) ?? {
      day: parts,
      label: part(d, { weekday: "long", day: "numeric", month: "short" }),
      times: [],
    };
    entry.times.push({ iso, label: part(d, { hour: "2-digit", minute: "2-digit", hour12: false }) });
    days.set(parts, entry);
  }
  return [...days.values()];
}

/** "Thu 26 Nov 2026, 14:00 (Dubai)". */
export const viewingTimeLabel = (iso: string): string => {
  const d = new Date(iso);
  const date = part(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" }).replace(",", "");
  return `${date}, ${part(d, { hour: "2-digit", minute: "2-digit", hour12: false })} (Dubai)`;
};

/** The Dubai calendar day of an instant, `2026-11-26` (for the day a lead was created). */
export const dubaiDay = (iso: string): string =>
  new Intl.DateTimeFormat("en-CA", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(
    new Date(iso),
  );
