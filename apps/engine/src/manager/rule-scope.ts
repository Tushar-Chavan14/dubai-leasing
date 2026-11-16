import type { Emirate, PropertySubtype } from "@leasing/core";

/**
 * The scope every company rule shares (D68): one emirate (or none = any, contract rules only), an optional community
 * (rent rules) and a list of unit types (empty = every type of the category).
 */
export interface RuleScope {
  emirate: Emirate | null;
  subtypes: readonly string[];
  community?: string | null | undefined;
}

/** The unit fits the rule's types: the list is empty or names the unit's type. */
export function fitsSubtype(rule: Pick<RuleScope, "subtypes">, subtype: string | null): boolean {
  return rule.subtypes.length === 0 || (subtype !== null && rule.subtypes.includes(subtype));
}

/** The unit fits the rule's whole scope (emirate, community and type). */
export function fitsUnit(
  rule: RuleScope,
  unit: { emirate: Emirate; subtype: string | null; community?: string | null | undefined },
): boolean {
  return (
    (rule.emirate === null || rule.emirate === unit.emirate) &&
    ((rule.community ?? null) === null || rule.community === unit.community) &&
    fitsSubtype(rule, unit.subtype)
  );
}

/**
 * How specific a rule is: a named emirate, then a named community, then named types. A higher number wins (D32, D58);
 * ties go to the newest rule.
 */
export function specificity(rule: RuleScope): number {
  return (
    (rule.emirate !== null ? 4 : 0) + ((rule.community ?? null) !== null ? 2 : 0) + (rule.subtypes.length > 0 ? 1 : 0)
  );
}

/**
 * Two active rules of the same company and category would compete for the same unit at the same specificity: same
 * emirate, same community, and either both cover every type or their type lists share one. A rule for all types and a
 * rule naming some types don't overlap: the named one wins.
 */
export function overlaps(a: RuleScope, b: RuleScope): boolean {
  if (a.emirate !== b.emirate) return false;
  if ((a.community ?? null) !== (b.community ?? null)) return false;
  if (a.subtypes.length === 0 || b.subtypes.length === 0) return a.subtypes.length === 0 && b.subtypes.length === 0;
  return a.subtypes.some((s) => b.subtypes.includes(s));
}

/** The types both rules name (for the refusal message); empty when both cover every type. */
export function sharedSubtypes(a: RuleScope, b: RuleScope): string[] {
  return a.subtypes.filter((s) => b.subtypes.includes(s));
}

/** A list of types stored the same way every time: no duplicates, sorted. */
export function normaliseSubtypes(list: readonly PropertySubtype[] | null | undefined): PropertySubtype[] {
  return [...new Set(list ?? [])].sort();
}
