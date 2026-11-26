/** An amount in fils written in words, by code (a model never writes a money value, rule 1). */
const ONES = [
  "Zero",
  "One",
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Eleven",
  "Twelve",
  "Thirteen",
  "Fourteen",
  "Fifteen",
  "Sixteen",
  "Seventeen",
  "Eighteen",
  "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion", "Trillion"];

const below100 = (n: number): string =>
  n < 20 ? ONES[n]! : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;

const below1000 = (n: number): string => {
  const h = Math.floor(n / 100);
  const r = n % 100;
  return [h ? `${ONES[h]} Hundred` : "", r ? below100(r) : ""].filter(Boolean).join(" ");
};

/** A whole number as English words (0 to under 10^15). */
export function wholeInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n >= 1e15) throw new RangeError("Amount out of range for words.");
  if (n === 0) return "Zero";
  const parts: string[] = [];
  let rest = n;
  for (let i = 0; rest > 0; i++) {
    const group = rest % 1000;
    if (group) parts.unshift(`${below1000(group)}${SCALES[i] ? ` ${SCALES[i]}` : ""}`);
    rest = Math.floor(rest / 1000);
  }
  return parts.join(" ");
}

/** `UAE Dirhams One Million Two Hundred Fifty Thousand Only`, with fils when there are any. */
export function moneyInWords(fils: number): string {
  if (!Number.isSafeInteger(fils) || fils < 0) throw new RangeError("Amount must be a whole number of fils.");
  const dirhams = Math.floor(fils / 100);
  const rest = fils % 100;
  const fils_ = rest ? ` and ${below100(rest)} Fils` : "";
  return `UAE Dirhams ${wholeInWords(dirhams)}${fils_} Only`;
}
