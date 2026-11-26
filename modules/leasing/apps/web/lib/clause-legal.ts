/** Clause categories where a wrong word can change a legal right: staff confirm them with legal first. */
const LEGAL_CATEGORIES = new Set(["termination", "payment", "subletting"]);

export const needsLegalCheck = (category: string | undefined | null) => !!category && LEGAL_CATEGORIES.has(category);
