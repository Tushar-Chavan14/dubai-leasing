/**
 * Name comparison for KYC and Ejari matching. Ejari rejects a contract whose names don't match
 * the ID exactly, so the comparison is strict: differences only in case, spacing, punctuation or
 * accents are "typo-class"; anything else is a mismatch a person must look at.
 */
export function normaliseName(raw: string): string {
  return raw
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z\s'-]/g, " ")
    .replace(/[-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type NameMatch =
  /** Identical as written. */
  | "exact"
  /** Same letters and order; only case, spacing, punctuation or accents differ. */
  | "typo_class"
  /** Same words in a different order (e.g. surname first in the MRZ). */
  | "reordered"
  | "different";

export function compareNames(a: string, b: string): NameMatch {
  if (a.trim() === b.trim()) return "exact";
  const na = normaliseName(a);
  const nb = normaliseName(b);
  if (!na || !nb) return "different";
  if (na === nb) return "typo_class";
  const sa = na.split(" ").toSorted().join(" ");
  const sb = nb.split(" ").toSorted().join(" ");
  return sa === sb ? "reordered" : "different";
}
