/** Lower case, accents removed, anything that is not a letter or digit becomes a space, spaces collapsed. */
export function normaliseName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const sortedTokens = (name: string): string => normaliseName(name).split(" ").filter(Boolean).toSorted().join(" ");

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++)
      row[j] = Math.min(prev[j]! + 1, row[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length]!;
}

/** 0..1, by code only: names are normalised, their tokens sorted, then compared by edit distance. Empty never matches. */
export function nameSimilarity(a: string, b: string): number {
  const x = sortedTokens(a);
  const y = sortedTokens(b);
  if (!x || !y) return 0;
  return 1 - levenshtein(x, y) / Math.max(x.length, y.length);
}
