/**
 * Name comparison by code only (S14): Unicode-normalised (NFKD) with accents and marks dropped, lower case, and any run
 * of other characters as one space. "MARIA NÚÑEZ", "Maria Núñez" and "maria  nunez" compare equal.
 * A name with no letters or digits normalises to "" and never matches anything.
 */
export const normaliseName = (s: string): string =>
  s
    .normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/** What a `seller_verification` approval was given for: the document and its owners, order-independent. */
export const ownershipKey = (kind: string, ref: string, owners: readonly string[]): string =>
  `${kind}|${ref}|${owners.map(normaliseName).toSorted().join(";")}`;
