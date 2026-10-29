/**
 * Code, not the model, decides whether a clause "contains values" (money, numbers, periods,
 * dates), so staff know to check it before it goes into a contract. Deliberately over-inclusive;
 * "one" is left out (too common: "one party").
 */
const AR = "\\u0600-\\u06FF";
const arabic = (words: string): RegExp => new RegExp(`(?<![${AR}])(?:بال|لل|ال|[بلو])?(?:${words})(?![${AR}])`);
const MONEY = /\bAED\b|\bdirhams?\b|\bdhs?\b|\bfils\b/i;
const MONEY_AR = arabic("درهم|دراهم|د\\.إ|فلس|فلوس");
const DIGIT = /[0-9\u0660-\u0669\u06F0-\u06F9\uFF10-\uFF19%\u066A\uFF05]/;
const NUMBER_WORDS =
  /\b(?:two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|(?:thir|four|fif|six|seven|eigh|nine)teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|half|double|triple|twice|dozen|percent|per\s?cent)\b/i;
const NUMBER_WORDS_AR = arabic(
  "اثنان|اثنين|اثنا|اثني|ثلاثة|ثلاث|ثلاثون|ثلاثين|أربعة|أربع|أربعون|أربعين|خمسة|خمس|خمسون|خمسين|ستة|ستون|ستين|سبعة|سبع|سبعون|سبعين|ثمانية|ثماني|ثمانون|ثمانين|تسعة|تسع|تسعون|تسعين|عشرة|عشر|عشرون|عشرين|مائة|مئة|مائتان|مئتان|ألف|الف|ألفين|مليون|نصف|ضعف|ضعفين|بالمائة|بالمئة|المائة|المئة|في المائة|في المئة",
);
const PERIOD =
  /\b(?:days?|weeks?|fortnights?|months?|years?|hours?|quarterly|annual(?:ly)?|monthly|weekly|daily|yearly|per\s+annum)\b/i;
const PERIOD_AR = arabic(
  "يوم|يوما|يومان|يومين|أيام|ايام|أسبوع|اسبوع|أسبوعا|أسبوعان|أسبوعين|أسابيع|اسابيع|شهر|شهرا|شهران|شهرين|أشهر|اشهر|شهور|سنة|سنه|سنتان|سنتين|سنوات|سنويا|عاما|عامان|عامين|أعوام|ساعة|ساعات|ساعتين|ربع سنوي|سنوي|شهري|أسبوعي|يومي",
);
const MONTHS =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const DATE = new RegExp(`\\b(?:${MONTHS})\\b\\s+\\d{1,2}|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:${MONTHS})\\b`, "i");

export function hasValues(text: string): boolean {
  return (
    MONEY.test(text) ||
    MONEY_AR.test(text) ||
    DIGIT.test(text) ||
    NUMBER_WORDS.test(text) ||
    NUMBER_WORDS_AR.test(text) ||
    PERIOD.test(text) ||
    PERIOD_AR.test(text) ||
    DATE.test(text)
  );
}

const globally = (re: RegExp) => new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`);
const ASCII = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[０-９]/g, (d) => String(d.charCodeAt(0) - 0xff10))
    .replace(/[٪％]/g, "%")
    .replace(/[٬]/g, ",")
    .replace(/[٫]/g, ".");
const WORD_TO_DIGIT: Record<string, string> = {
  one: "1",
  two: "2",
  three: "3",
  four: "4",
  five: "5",
  six: "6",
  seven: "7",
  eight: "8",
  nine: "9",
  ten: "10",
  eleven: "11",
  twelve: "12",
  thirty: "30",
  sixty: "60",
  ninety: "90",
};
const PERIOD_STEM: [RegExp, string][] = [
  [/^(?:days?|daily)$/, "day"],
  [/^(?:weeks?|weekly|fortnights?)$/, "week"],
  [/^(?:months?|monthly)$/, "month"],
  [/^(?:years?|yearly|annual(?:ly)?|per\s+annum)$/, "year"],
  [/^(?:hours?)$/, "hour"],
  [/^quarterly$/, "quarter"],
];

/**
 * The money, number, period and date tokens of a text, normalised (digits to ASCII, number words
 * up to twelve to digits, period words to a stem). Used to refuse a clause whose text introduces a
 * value its quote does not contain: the model may not make up a figure (AGENTS rule 1).
 */
export function valueTokens(raw: string): Set<string> {
  const text = ASCII(raw);
  const out = new Set<string>();
  for (const m of text.matchAll(/\d+(?:[.,]\d+)*/g)) out.add(m[0].replaceAll(",", ""));
  if (/%/.test(text)) out.add("%");
  for (const m of text.matchAll(globally(NUMBER_WORDS))) {
    const w = m[0].toLowerCase().replace(/\s+/g, "");
    out.add(w === "percent" ? "%" : (WORD_TO_DIGIT[w] ?? w));
  }
  for (const m of text.matchAll(globally(NUMBER_WORDS_AR))) out.add(m[0]);
  for (const m of text.matchAll(globally(PERIOD))) {
    const w = m[0].toLowerCase().replace(/\s+/g, " ");
    const stem = PERIOD_STEM.find(([re]) => re.test(w));
    out.add(stem ? stem[1] : w);
  }
  for (const m of text.matchAll(globally(PERIOD_AR))) out.add(m[0]);
  for (const m of text.matchAll(new RegExp(`\\b(?:${MONTHS})\\b`, "gi"))) out.add(m[0].toLowerCase().slice(0, 3));
  if (MONEY.test(text) || MONEY_AR.test(text)) out.add("aed");
  return out;
}

/** The value tokens `text` has that `quote` lacks (empty when the clause adds nothing). */
export function inventedValues(text: string, quote: string): string[] {
  const have = valueTokens(quote);
  return [...valueTokens(text)].filter((t) => !have.has(t));
}
