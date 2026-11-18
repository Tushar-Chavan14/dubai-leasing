import { toDubaiDate } from "@leasing/core";

/**
 * Post-check for copilot answers (architecture §8b, safeguard 1). Every AED amount, percentage
 * and date in the answer must appear in this turn's tool results (or the user's own question).
 * Anything that doesn't is returned as "unverified" and highlighted in the UI. It is a check on
 * the answer's text, not on its reasoning: a value copied from the wrong field still matches.
 */
export interface Verification {
  /** Exact substrings of the answer that no tool result backs. */
  unverified: string[];
  /** How many values were checked. */
  checked: number;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = "(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const NUM = "([0-9][0-9,]*(?:\\.[0-9]+)?)";

const AMOUNT = new RegExp(
  `(?:AED|Dhs?\\.?|dirhams?)\\s*${NUM}(\\s*(?:k|K|thousand)\\b)?|${NUM}(\\s*(?:k|K))?\\s*(?:AED|dirhams?)\\b`,
  "gi",
);
const PERCENT = /(\d+(?:\.\d+)?)\s?%/g;
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const DAY_MONTH = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+(\\d{4}))?`, "gi");
const MONTH_DAY = new RegExp(`\\b${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, "gi");

const toFils = (num: string, thousands: boolean) => {
  const v = Number(num.replaceAll(",", ""));
  return Math.round(v * 100 * (thousands ? 1000 : 1));
};
const monthIndex = (m: string) => MONTHS.indexOf(m.slice(0, 3).toLowerCase()) + 1;
const pad = (n: number) => String(n).padStart(2, "0");

interface Known {
  fils: Set<number>;
  /** Values a tool gave as percentages (`*Percent` fields, or "15%" in its text). */
  percents: Set<number>;
  /** "90 day", "12 month", "2 year": durations a tool stated. */
  durations: Set<string>;
  dates: Set<string>;
  monthDays: Set<string>;
}

const DURATION = /\b(\d+)[\s-](day|month|year)s?\b/gi;
const UNTRUSTED_BLOCK = /<untrusted>[\s\S]*?<\/untrusted>/g;

function addDate(k: Known, y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return;
  k.dates.add(`${y}-${pad(m)}-${pad(d)}`);
  k.monthDays.add(`${pad(m)}-${pad(d)}`);
}

function learnText(k: Known, text: string) {
  for (const m of text.matchAll(AMOUNT)) {
    if (m[1]) k.fils.add(toFils(m[1], !!m[2]));
    if (m[3]) k.fils.add(toFils(m[3], !!m[4]));
  }
  for (const m of text.matchAll(PERCENT)) k.percents.add(Number(m[1]));
  // Ranges give both ends: "11–20%".
  for (const m of text.matchAll(/(\d+(?:\.\d+)?)\s?[–-]\s?\d+(?:\.\d+)?\s?%/g)) k.percents.add(Number(m[1]));
  for (const m of text.matchAll(DURATION)) k.durations.add(`${Number(m[1])} ${m[2]!.toLowerCase()}`);
  for (const m of text.matchAll(ISO_DATE)) {
    addDate(k, Number(m[1]), Number(m[2]), Number(m[3]));
    // A timestamp also stands for its Dubai calendar date.
    if (m[0].includes("T")) {
      const dubai = toDubaiDate(new Date(m[0]));
      const [y, mo, d] = dubai.split("-").map(Number) as [number, number, number];
      addDate(k, y, mo, d);
    }
  }
  for (const m of text.matchAll(DAY_MONTH)) if (m[3]) addDate(k, Number(m[3]), monthIndex(m[2]!), Number(m[1]));
  for (const m of text.matchAll(MONTH_DAY)) if (m[3]) addDate(k, Number(m[3]), monthIndex(m[1]!), Number(m[2]));
}

/** `path` is the field names leading to the value, so `ownUseLockYears.residential` reads as years. */
function learn(k: Known, value: unknown, path = "") {
  if (typeof value === "number") {
    const key = path.split(".").at(-1) ?? "";
    if (/fils$/i.test(key)) k.fils.add(value);
    if (/percent|pct/i.test(key)) k.percents.add(value);
    const unit = /(day|month|year)s?\b|(Day|Month|Year)s?(?=$|[A-Z.])/.exec(path);
    if (unit) k.durations.add(`${value} ${(unit[1] ?? unit[2])!.toLowerCase()}`);
  } else if (typeof value === "string") {
    // Tenant-written text proves nothing: a comment saying "AED 50,000" doesn't back that value.
    learnText(k, value.replace(UNTRUSTED_BLOCK, " "));
  } else if (Array.isArray(value)) {
    for (const v of value) learn(k, v, path);
  } else if (value && typeof value === "object") {
    for (const [kk, v] of Object.entries(value)) learn(k, v, path ? `${path}.${kk}` : kk);
  }
}

const hasNumber = (set: Set<number>, v: number) => [...set].some((n) => Math.abs(n - v) < 0.005);

/**
 * @param sources this turn's tool results (as returned to the model) and anything else that
 *   may be quoted: the user's question, today's date.
 */
export function verifyAnswer(answer: string, sources: unknown[]): Verification {
  const k: Known = {
    fils: new Set(),
    percents: new Set(),
    durations: new Set(),
    dates: new Set(),
    monthDays: new Set(),
  };
  for (const s of sources) learn(k, s);
  const unverified: string[] = [];
  let checked = 0;
  const flag = (span: string) => {
    if (!unverified.includes(span.trim())) unverified.push(span.trim());
  };

  for (const m of answer.matchAll(AMOUNT)) {
    checked++;
    const fils = m[1] ? toFils(m[1], !!m[2]) : toFils(m[3]!, !!m[4]);
    // "AED 89k" may round a tool value: accept it when it is the rounded thousand.
    const thousands = !!(m[2] || m[4]);
    const ok = k.fils.has(fils) || (thousands && [...k.fils].some((f) => Math.abs(f - fils) < 100_000));
    if (!ok) flag(m[0]);
  }
  for (const m of answer.matchAll(PERCENT)) {
    checked++;
    if (!hasNumber(k.percents, Number(m[1]))) flag(m[0]);
  }
  for (const m of answer.matchAll(DURATION)) {
    checked++;
    if (!k.durations.has(`${Number(m[1])} ${m[2]!.toLowerCase()}`)) flag(m[0]);
  }
  for (const m of answer.matchAll(ISO_DATE)) {
    checked++;
    if (!k.dates.has(`${m[1]}-${m[2]}-${m[3]}`)) flag(m[0]);
  }
  for (const m of answer.matchAll(DAY_MONTH)) {
    checked++;
    const mo = pad(monthIndex(m[2]!));
    const key = m[3] ? `${m[3]}-${mo}-${pad(Number(m[1]))}` : null;
    if (key ? !k.dates.has(key) : !k.monthDays.has(`${mo}-${pad(Number(m[1]))}`)) flag(m[0]);
  }
  for (const m of answer.matchAll(MONTH_DAY)) {
    checked++;
    const mo = pad(monthIndex(m[1]!));
    const key = m[3] ? `${m[3]}-${mo}-${pad(Number(m[2]))}` : null;
    if (key ? !k.dates.has(key) : !k.monthDays.has(`${mo}-${pad(Number(m[2]))}`)) flag(m[0]);
  }
  return { unverified, checked };
}
