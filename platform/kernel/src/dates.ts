/**
 * Calendar dates for legal deadlines. A `CalendarDate` is an ISO `YYYY-MM-DD` string meaning a
 * day in Asia/Dubai, with no time and no timezone. Arithmetic is done on whole days so it never
 * drifts across midnight UTC.
 */

export const DUBAI_TZ = "Asia/Dubai";

export type CalendarDate = string & { readonly __calendarDate: unique symbol };

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

export function isCalendarDate(value: string): value is CalendarDate {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function calendarDate(value: string): CalendarDate {
  if (!isCalendarDate(value)) throw new Error(`invalid calendar date: ${value}`);
  return value;
}

function parts(date: CalendarDate): [number, number, number] {
  const [y, m, d] = date.split("-").map(Number) as [number, number, number];
  return [y, m, d];
}

function fromParts(y: number, m: number, d: number): CalendarDate {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}` as CalendarDate;
}

export function isLeapYear(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeapYear(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** Days since 1970-01-01 for a calendar date (pure arithmetic, no timezone). */
function toEpochDay(date: CalendarDate): number {
  const [y, m, d] = parts(date);
  return Date.UTC(y, m - 1, d) / MS_PER_DAY;
}

function fromEpochDay(day: number): CalendarDate {
  const t = new Date(day * MS_PER_DAY);
  return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function addDays(date: CalendarDate, days: number): CalendarDate {
  return fromEpochDay(toEpochDay(date) + days);
}

/**
 * Adds calendar months. When the target month is shorter, the day is clamped to its last day
 * (2026-03-31 − 1 month = 2026-02-28).
 */
export function addMonths(date: CalendarDate, months: number): CalendarDate {
  const [y, m, d] = parts(date);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return fromParts(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

export function addYears(date: CalendarDate, years: number): CalendarDate {
  return addMonths(date, years * 12);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: CalendarDate, b: CalendarDate): number {
  return toEpochDay(b) - toEpochDay(a);
}

export function compareDates(a: CalendarDate, b: CalendarDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export const isBefore = (a: CalendarDate, b: CalendarDate) => a < b;
export const isAfter = (a: CalendarDate, b: CalendarDate) => a > b;
export const minDate = (a: CalendarDate, b: CalendarDate) => (a < b ? a : b);
export const maxDate = (a: CalendarDate, b: CalendarDate) => (a > b ? a : b);

const dubaiFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: DUBAI_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Asia/Dubai calendar date of an instant. */
export function toDubaiDate(instant: Date): CalendarDate {
  return calendarDate(dubaiFormatter.format(instant));
}

/**
 * The instant a Dubai calendar day starts (00:00 Asia/Dubai). Dubai is UTC+4 all year (no DST),
 * which we check against Intl once at load so a tzdata change can't silently shift deadlines.
 */
const DUBAI_OFFSET_MS = 4 * 3_600_000;
if (toDubaiDate(new Date(Date.UTC(2025, 0, 1) - DUBAI_OFFSET_MS)) !== "2025-01-01") {
  throw new Error("Asia/Dubai offset is no longer UTC+4; update dates.ts");
}

export function startOfDubaiDay(date: CalendarDate): Date {
  return new Date(toEpochDay(date) * MS_PER_DAY - DUBAI_OFFSET_MS);
}
