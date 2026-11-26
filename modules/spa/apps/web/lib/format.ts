/** "Wednesday 18 November 2026" for a calendar date (an Asia/Dubai day, written as YYYY-MM-DD). */
export function weekdayDate(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(d);
}

export const initials = (name: string): string =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "?";

/** "AED 1,500,000" from integer fils (fils shown only when not a whole dirham). Integer arithmetic only, never a float. */
export function formatMoneyFils(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(Math.trunc(fils));
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return `${sign}AED ${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** A share in basis points as an exact percentage ("33.33%"), by integer arithmetic. */
export function shareLabel(bps: number | null | undefined): string | null {
  if (bps === null || bps === undefined) return null;
  const whole = Math.floor(bps / 100);
  const frac = String(bps % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return `${whole}${frac ? `.${frac}` : ""}%`;
}

const SHORT = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "Asia/Dubai",
});
const TIME = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Asia/Dubai",
});

/** "4 Dec 2026" for a calendar date (`YYYY-MM-DD`) or a timestamp (read as Asia/Dubai). Empty when it isn't a date. */
export function shortDate(value: string): string {
  const day = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const d = new Date(day ? `${value}T00:00:00Z` : value);
  if (Number.isNaN(d.getTime())) return "";
  return SHORT.format(d);
}

/** "4 Dec 2026, 10:00" in UAE time, for the activity log. */
export function dubaiDateTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : `${SHORT.format(d)}, ${TIME.format(d)}`;
}

/** An age the engine counted in whole days, in words. */
export const ageLabel = (days: number): string => (days <= 0 ? "Today" : days === 1 ? "1 day" : `${days} days`);

/** "November 2026" from `yyyy-mm`; anything else comes back as it is. */
export function monthLabel(period: string): string {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) return period;
  return new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${period}-01T00:00:00Z`),
  );
}

/** "20 KB" from a byte count, by integer arithmetic (rounded up to the next whole KB, never zero for a file). */
export function sizeLabel(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.ceil(bytes / 1024)} KB`;
  return `${Math.ceil(bytes / (1024 * 1024))} MB`;
}

/** Whole fils as the text a price box takes ("1500000" or "1500000.5"), for filling a form: integer arithmetic only. */
export function filsToAedInput(fils: number): string {
  const whole = Math.floor(fils / 100);
  const rest = fils % 100;
  return rest ? `${whole}.${String(rest).padStart(2, "0").replace(/0$/, "")}` : String(whole);
}
