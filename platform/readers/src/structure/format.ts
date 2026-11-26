const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "AED 85,000" (fils shown only when not a whole dirham). Integer arithmetic, no floats. */
export function formatMoneyFils(fils: number): string {
  const sign = fils < 0 ? "-" : "";
  const abs = Math.abs(fils);
  const whole = Math.floor(abs / 100).toLocaleString("en-US");
  const rest = abs % 100;
  return `${sign}AED ${whole}${rest ? `.${String(rest).padStart(2, "0")}` : ""}`;
}

/** "15 March 2027" from a `YYYY-MM-DD` Dubai calendar date; no time zone is involved. */
export function formatCalendarDate(d: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return null;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${Number(m[3])} ${month} ${m[1]}` : null;
}
