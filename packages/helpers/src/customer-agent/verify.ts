import { toDubaiDate } from "@leasing/core";

/**
 * Value post-check for agent answers (AGENTS rule 1, decision D36). Every AED amount and date in
 * the answer must appear in this turn's tool results (or in the filters the visitor already set). Anything
 * else is "unverified": the turn retries once, then falls back to a fixed reply. The same check
 * rejects a claim of an action (booked, applied, sent) that no tool confirmed this turn.
 * Arabic-Indic digits are read as digits; Arabic month names count as months.
 */
export interface Verification {
  unverified: string[];
  checked: number;
}

const EN_MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const AR_MONTHS = [
  ["يناير", "كانون الثاني"],
  ["فبراير", "شباط"],
  ["مارس", "آذار"],
  ["أبريل", "ابريل", "نيسان"],
  ["مايو", "أيار"],
  ["يونيو", "حزيران"],
  ["يوليو", "تموز"],
  ["أغسطس", "آب"],
  ["سبتمبر", "أيلول"],
  ["أكتوبر", "تشرين الأول"],
  ["نوفمبر", "تشرين الثاني"],
  ["ديسمبر", "كانون الأول"],
];
const MONTH_EN = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\\.?";
const MONTH_AR = `(?:${AR_MONTHS.flat().join("|")})`;
const MONTH = `(${MONTH_EN}|${MONTH_AR})`;
const NUM = "([0-9][0-9,]*(?:\\.[0-9]+)?)";
const NOT_LETTER_BEFORE = "(?<![\\p{L}\\d])";

const AMOUNT = new RegExp(
  `(?:AED|Dhs?\\.?|dirhams?|درهم|د\\.إ)\\s*${NUM}(\\s*(?:k|K|thousand|ألف)(?![\\p{L}]))?|${NUM}(\\s*(?:k|K|ألف)(?![\\p{L}]))?\\s*(?:AED|Dhs?\\.?|dirhams?|درهم|د\\.إ)`,
  "giu",
);
/** A bare yearly figure ("85,000 a year", "٨٥٬٠٠٠ سنويا") counts as an amount even without a currency word. */
const BARE_YEARLY = new RegExp(
  `(?<![\\d,.])${NUM}(?!\\d)\\s*(?:a year|per year|/\\s?year|yearly|annually|سنوي[اًّ]?|في السنة)`,
  "giu",
);
/** A clock time, optionally with am/pm (or ص/م). */
const TIME = /(?<![\d:])(\d{1,2}):(\d{2})(?![\d:]\d)(?:\s?(am|pm|a\.m\.|p\.m\.|ص|م)(?![\p{L}]))?/giu;
const WEEKDAYS_EN = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const WEEKDAY_ABBR = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const WEEKDAYS_AR = [
  ["الأحد", "الاحد"],
  ["الاثنين", "الإثنين"],
  ["الثلاثاء"],
  ["الأربعاء", "الاربعاء"],
  ["الخميس"],
  ["الجمعة"],
  ["السبت"],
];
const WEEKDAY = new RegExp(
  `${NOT_LETTER_BEFORE}(${WEEKDAYS_EN.map((d) => `[${d[0]!.toUpperCase()}${d[0]}]${d.slice(1)}`).join("|")}|(?:Mon|Tue|Tues|Wed|Thu|Thur|Thurs|Fri|Sat|Sun)(?![\\p{L}])|${WEEKDAYS_AR.flat().join("|")})`,
  "gu",
);
const weekdayIndex = (name: string): number => {
  const n = name.toLowerCase();
  const full = WEEKDAYS_EN.indexOf(n);
  if (full >= 0) return full;
  const abbr = WEEKDAY_ABBR.indexOf(n.slice(0, 3));
  if (abbr >= 0 && /^[a-z]/.test(n)) return abbr;
  return WEEKDAYS_AR.findIndex((names) => names.includes(name));
};
const timeKey = (h: string, m: string, ap: string | undefined) => {
  let hour = Number(h);
  const mer = ap?.toLowerCase().replace(/\./g, "");
  if (mer === "pm" || mer === "م") hour = (hour % 12) + 12;
  else if (mer === "am" || mer === "ص") hour = hour % 12;
  return `${pad(hour)}:${m}`;
};
const ISO_DATE = /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+(?:Z|[+-]\d{2}:?\d{2})?)?/g;
const DAY_MONTH = new RegExp(`${NOT_LETTER_BEFORE}(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH}(?:,?\\s+(\\d{4}))?`, "giu");
const MONTH_DAY = new RegExp(
  `${NOT_LETTER_BEFORE}${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?(?!\\d)`,
  "giu",
);

/**
 * "I booked / I have applied / your viewing is confirmed": only the system's own confirmation (a
 * tool's fixed text) may say so. Negations ("I can't book") are not claims.
 */
const CLAIM_EN = new RegExp(
  [
    // Done: "I've booked", "your viewing is confirmed", "I sent you an email".
    "\\bI(?:'ve| have)?\\s+(?:just\\s+|now\\s+)?(?:booked|applied|submitted|scheduled|reserved|registered)\\b",
    "\\byour (?:viewing|application) (?:is|has been|was) (?:now\\s+)?(?:booked|confirmed|submitted|scheduled|received)\\b",
    "\\bI(?:'ve| have)?\\s+(?:just\\s+)?(?:sent|emailed)\\b",
    // Promised: only a tool can do these, so a promise without a call is as wrong as a claim.
    "\\bI(?:'ll| will|'m going to|am going to)\\s+(?:now\\s+|go ahead and\\s+)?(?:book|apply|submit|schedule|reserve|send|email|register|hand|pass|forward)\\b",
    "\\bwill\\s+(?:contact|call|reach out to|get back to|be in touch with|follow up with|reply to)\\s+you\\b",
    // Asking leave to do what a tool should just do.
    "\\b(?:would you like me to|shall I|do you want me to|want me to)\\s+(?:send|book|apply|hand|check|submit|do (?:that|this|it))\\b",
    "\\bI(?:'ll| will)?\\s+(?:need|have) to\\s+(?:send|connect|hand|pass|arrange|forward)\\b",
    "\\b(?:hold on|please wait|bear with me|one moment) while I\\b",
  ].join("|"),
  "i",
);
const CLAIM_AR =
  /تم\s+(?:حجز|تقديم|إرسال)|(?:قمت\s+ب)?حجزت|قدّمت\s+طلب|أرسلت\s+(?:لك|إلى)|(?:سأ|سوف\s+أ)(?:قوم|رسل|حجز|قدّم|قدم|تقدم)|سيتواصل/;

/** A percentage ("5%", "٥٪", "5 percent", "5 بالمئة"). */
const PERCENT = /(?<![\d.,])(\d+(?:\.\d+)?)\s?(?:%|٪|percent\b|per cent\b|بالمئة|بالمائة|في المئة|في المائة)/giu;
/** A bare figure of 1,000 or more (an amount without a currency word). Years and clock times are other checks. */
const BIG_NUMBER = /(?<![\d,.:-])(\d{1,3}(?:,\d{3})+|\d{4,})(?:\.\d+)?(?![\d:-])/g;
const EN_WORDS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
const AR_WORDS = [
  ["واحد", "واحدة"],
  ["اثنان", "اثنين", "اثنتين", "إثنين"],
  ["ثلاثة", "ثلاث"],
  ["أربعة", "اربعة", "أربع", "اربع"],
  ["خمسة", "خمس"],
  ["ستة", "ست"],
  ["سبعة", "سبع"],
  ["ثمانية", "ثماني", "ثمان"],
  ["تسعة", "تسع"],
  ["عشرة", "عشر"],
  ["أحد عشر", "احد عشر"],
  ["اثنا عشر", "اثني عشر", "إثنا عشر", "إثني عشر"],
];
const UNIT_EN = "(day|week|month|year)s?";
const UNIT_AR =
  "(يوم|أيام|ايام|يومًا|يوما|أسبوع|اسبوع|أسابيع|اسابيع|شهر|أشهر|اشهر|شهور|شهرًا|شهرا|سنة|سنوات|سنه|سنين|عامًا|عاما|عام|أعوام|اعوام)";
const WORD_NUM = `(?:${EN_WORDS.join("|")}|${AR_WORDS.flat().join("|")})`;
/** "30 days", "twelve months", "12-month", "ثلاثة أشهر". */
const DURATION_EN = new RegExp(`${NOT_LETTER_BEFORE}(\\d+|${EN_WORDS.join("|")})[\\s-]*${UNIT_EN}(?![\\p{L}])`, "giu");
const DURATION_AR = new RegExp(`(?<![\\p{L}\\d])(\\d+|${WORD_NUM})\\s+${UNIT_AR}(?![\\p{L}])`, "gu");
/** Dual forms: "شهرين" is two months. */
const DURATION_DUAL =
  /(?<![\p{L}\d])(يومين|يومان|أسبوعين|اسبوعين|أسبوعان|شهرين|شهران|سنتين|سنتان|عامين|عامان)(?![\p{L}])/gu;
const unitClass = (u: string): string => {
  const n = u.toLowerCase();
  if (/^(day|يوم|أيام|ايام)/.test(n)) return "day";
  if (/^(week|أسبوع|اسبوع|أسابيع|اسابيع)/.test(n)) return "week";
  if (/^(month|شهر|أشهر|اشهر|شهور)/.test(n)) return "month";
  return "year";
};
const wordNumber = (w: string): number => {
  if (/^\d+$/.test(w)) return Number(w);
  const en = EN_WORDS.indexOf(w.toLowerCase());
  if (en >= 0) return en + 1;
  return AR_WORDS.findIndex((names) => names.includes(w)) + 1;
};
function* durations(text: string): Generator<{ span: string; key: string }> {
  for (const m of text.matchAll(DURATION_EN)) yield { span: m[0], key: `${wordNumber(m[1]!)}:${unitClass(m[2]!)}` };
  for (const m of text.matchAll(DURATION_AR)) yield { span: m[0], key: `${wordNumber(m[1]!)}:${unitClass(m[2]!)}` };
  for (const m of text.matchAll(DURATION_DUAL))
    yield { span: m[0], key: `2:${unitClass(m[1]!.startsWith("سنت") || m[1]!.startsWith("عام") ? "سنة" : m[1]!)}` };
}

/** Contact details the model must never make up: phone numbers, email addresses, links. */
const PHONE = /\+\d[\d\s-]{7,}\d|(?<![\d,.])0\d{8,10}(?!\d)/g;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]*\w/g;
const LINK = /\bhttps?:\/\/[^\s)]+|\bwww\.[^\s)]+/gi;
const contactKey = (s: string) =>
  s.includes("@") || /^(?:https?:|www\.)/i.test(s) ? s.toLowerCase().replace(/[.,;:]+$/, "") : s.replace(/\D/g, "");

const MONTH_INDEX = (name: string): number => {
  const n = name.toLowerCase();
  const en = EN_MONTHS.indexOf(n.slice(0, 3));
  if (en >= 0 && /^[a-z]/.test(n)) return en + 1;
  const ar = AR_MONTHS.findIndex((names) => names.includes(name));
  return ar >= 0 ? ar + 1 : 0;
};
const pad = (n: number) => String(n).padStart(2, "0");

/** Arabic-Indic and Persian digits to ASCII. */
export const asciiDigits = (s: string) =>
  s
    // Arabic thousands (U+066C) and decimal (U+066B) separators.
    .replace(/\u066C/g, ",")
    .replace(/\u066B/g, ".")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));

interface Known {
  contacts: Set<string>;
  fils: Set<number>;
  dates: Set<string>;
  monthDays: Set<string>;
  times: Set<string>;
  weekdays: Set<number>;
  percents: Set<number>;
  numbers: Set<number>;
  durations: Set<string>;
}

const toFils = (num: string, thousands: boolean) =>
  Math.round(Number(num.replaceAll(",", "")) * 100 * (thousands ? 1000 : 1));

function addDate(k: Known, y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1 || d > 31) return;
  k.dates.add(`${y}-${pad(m)}-${pad(d)}`);
  k.monthDays.add(`${pad(m)}-${pad(d)}`);
}

function learnText(k: Known, raw: string) {
  const text = asciiDigits(raw);
  for (const re of [PHONE, EMAIL, LINK]) for (const m of text.matchAll(re)) k.contacts.add(contactKey(m[0]));
  for (const m of text.matchAll(AMOUNT)) {
    if (m[1]) k.fils.add(toFils(m[1], !!m[2]));
    if (m[3]) k.fils.add(toFils(m[3], !!m[4]));
  }
  for (const m of text.matchAll(BARE_YEARLY)) k.fils.add(toFils(m[1]!, false));
  for (const m of text.matchAll(PERCENT)) k.percents.add(Number(m[1]));
  for (const m of text.matchAll(BIG_NUMBER)) k.numbers.add(Number(m[1]!.replaceAll(",", "")));
  for (const d of durations(text)) k.durations.add(d.key);
  for (const m of text.matchAll(TIME)) k.times.add(timeKey(m[1]!, m[2]!, m[3]));
  for (const m of text.matchAll(WEEKDAY)) k.weekdays.add(weekdayIndex(m[1]!));
  for (const m of text.matchAll(ISO_DATE)) {
    addDate(k, Number(m[1]), Number(m[2]), Number(m[3]));
    if (m[0].includes("T")) {
      const at = new Date(m[0]);
      if (!Number.isNaN(at.getTime())) {
        const [y, mo, d] = toDubaiDate(at).split("-").map(Number) as [number, number, number];
        addDate(k, y, mo, d);
        const dubai = new Date(at.getTime() + 4 * 3_600_000);
        k.times.add(`${pad(dubai.getUTCHours())}:${pad(dubai.getUTCMinutes())}`);
      }
    }
  }
  for (const m of text.matchAll(DAY_MONTH)) if (m[3]) addDate(k, Number(m[3]), MONTH_INDEX(m[2]!), Number(m[1]));
  for (const m of text.matchAll(MONTH_DAY)) if (m[3]) addDate(k, Number(m[3]), MONTH_INDEX(m[1]!), Number(m[2]));
}

function learn(k: Known, value: unknown, key = "") {
  if (typeof value === "number") {
    if (/fils$/i.test(key)) {
      k.fils.add(value);
      k.numbers.add(value / 100);
    } else if (/percent|pct/i.test(key)) k.percents.add(value);
    else if (/days?$/i.test(key)) k.durations.add(`${value}:day`);
    else if (/weeks?$/i.test(key)) k.durations.add(`${value}:week`);
    else if (/months?$/i.test(key)) k.durations.add(`${value}:month`);
    else if (/years?$/i.test(key)) k.durations.add(`${value}:year`);
    if (value >= 1000 && !/fils$/i.test(key)) k.numbers.add(value);
  } else if (typeof value === "string") {
    // Unit descriptions and other outsider text prove nothing.
    learnText(k, value.replace(/<untrusted>[\s\S]*?<\/untrusted>/g, " "));
  } else if (Array.isArray(value)) {
    for (const v of value) learn(k, v, key);
  } else if (value && typeof value === "object") {
    for (const [kk, v] of Object.entries(value)) learn(k, v, kk);
  }
}

/** @param sources this turn's tool results and anything else that may be quoted (the filters in force). */
export function verifyAnswer(answer: string, sources: unknown[]): Verification {
  const k: Known = {
    contacts: new Set(),
    fils: new Set(),
    dates: new Set(),
    monthDays: new Set(),
    times: new Set(),
    weekdays: new Set(),
    percents: new Set(),
    numbers: new Set(),
    durations: new Set(),
  };
  for (const s of sources) learn(k, s);
  for (const d of k.dates) k.weekdays.add(new Date(`${d}T00:00:00Z`).getUTCDay());
  const text = asciiDigits(answer);
  const unverified: string[] = [];
  let checked = 0;
  const flag = (span: string) => {
    const clean = span.trim().replace(/\.$/, "");
    if (!unverified.includes(clean)) unverified.push(clean);
  };

  for (const re of [PHONE, EMAIL, LINK])
    for (const m of text.matchAll(re)) {
      checked++;
      if (!k.contacts.has(contactKey(m[0]))) flag(m[0]);
    }
  for (const m of text.matchAll(AMOUNT)) {
    checked++;
    const thousands = !!(m[2] || m[4]);
    const fils = m[1] ? toFils(m[1], !!m[2]) : toFils(m[3]!, !!m[4]);
    // "AED 89k" may round a tool value to the thousand.
    if (!(k.fils.has(fils) || (thousands && [...k.fils].some((f) => Math.abs(f - fils) < 100_000)))) flag(m[0]);
  }
  for (const m of text.matchAll(BARE_YEARLY)) {
    const fils = toFils(m[1]!, false);
    if (fils < 100_000) continue; // under 1,000: a count, not a rent
    checked++;
    if (!k.fils.has(fils)) flag(m[0]);
  }
  for (const m of text.matchAll(TIME)) {
    if (Number(m[1]) > 24 || Number(m[2]) > 59) continue;
    checked++;
    if (!k.times.has(timeKey(m[1]!, m[2]!, m[3]))) flag(m[0]);
  }
  for (const m of text.matchAll(WEEKDAY)) {
    checked++;
    if (!k.weekdays.has(weekdayIndex(m[1]!))) flag(m[0]);
  }
  for (const m of text.matchAll(ISO_DATE)) {
    checked++;
    if (!k.dates.has(`${m[1]}-${m[2]}-${m[3]}`)) flag(m[0]);
  }
  const monthDay = (day: string, month: string, year: string | undefined, span: string) => {
    checked++;
    const mo = pad(MONTH_INDEX(month));
    const dd = pad(Number(day));
    if (year ? !k.dates.has(`${year}-${mo}-${dd}`) : !k.monthDays.has(`${mo}-${dd}`)) flag(span);
  };
  for (const m of text.matchAll(DAY_MONTH)) monthDay(m[1]!, m[2]!, m[3], m[0]);
  for (const m of text.matchAll(MONTH_DAY)) monthDay(m[2]!, m[1]!, m[3], m[0]);
  for (const m of text.matchAll(PERCENT)) {
    checked++;
    if (!k.percents.has(Number(m[1]))) flag(m[0]);
  }
  for (const d of durations(text)) {
    checked++;
    if (!k.durations.has(d.key)) flag(d.span);
  }
  // Bare figures of 1,000 or more, once the amounts, times, dates and contacts above are blanked out.
  const rest = [AMOUNT, BARE_YEARLY, TIME, ISO_DATE, PHONE, EMAIL, LINK, PERCENT].reduce<string>(
    (t, re) => t.replace(re, " "),
    text,
  );
  for (const m of rest.matchAll(BIG_NUMBER)) {
    const n = Number(m[1]!.replaceAll(",", ""));
    if (n >= 1900 && n <= 2100 && !m[1]!.includes(",")) continue; // a year
    checked++;
    if (!k.numbers.has(n)) flag(m[0]);
  }
  return { unverified, checked };
}

/** A claim or promise of an action in model-written text (nothing but a tool may do or promise one), or null. */
export function actionClaim(answer: string): string | null {
  const m = CLAIM_EN.exec(answer) ?? CLAIM_AR.exec(answer);
  return m ? m[0] : null;
}
