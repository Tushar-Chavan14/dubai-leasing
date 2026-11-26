/**
 * Helper run modes (S22, S59). An admin sets each switchable helper to `auto` (the default: an `ok` result moves the
 * deal on), `review` (an `ok` result waits for a `helper_review` click) or `off` (the step becomes a manual task).
 * The names are the `helper_runs.helper` values. AML screening, settlement, the chaser and collections are never
 * switchable, and neither is any gate that is always required; the database refuses them too.
 */
export const HELPER_MODES = ["auto", "review", "off"] as const;
export type HelperMode = (typeof HELPER_MODES)[number];

export const SWITCHABLE_HELPERS = [
  "spa_ownership_check",
  "spa_kyc",
  "spa_company_check",
  "spa_document_reader",
  "spa_prepare",
  "registry",
  "spa_agreement_review",
] as const;
export type SwitchableHelper = (typeof SWITCHABLE_HELPERS)[number];

/** Listed so a test and the screen can say why: these are not offered. */
export const NON_SWITCHABLE_HELPERS = ["aml_screening", "settlement", "chaser", "collections"] as const;

export const isSwitchableHelper = (h: string): h is SwitchableHelper =>
  (SWITCHABLE_HELPERS as readonly string[]).includes(h);

/** The document reader's scopes: the kinds it reads (S52). Every other helper has the one scope `*`. */
export const READER_SCOPES = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "final_offer",
  "trade_licence",
  "memorandum",
  "poa",
  "board_resolution",
  "title_deed",
  "oqood",
  "payment_receipt",
] as const;

/**
 * The reader scopes whose result can wait for a person (S59 amendment): a NOC and the bank letters feed records, a
 * payment receipt feeds a payment. The other kinds' reads change nothing by themselves (the ownership and company checks
 * have their own modes), so `review` is not offered for them: it would hold nothing.
 */
export const REVIEWABLE_READER_SCOPES = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "final_offer",
  "payment_receipt",
] as const;

export const reviewAllowed = (helper: string, scope: string): boolean =>
  helper !== "spa_document_reader" || scope === "*" || (REVIEWABLE_READER_SCOPES as readonly string[]).includes(scope);

export const scopeAllowed = (helper: string, scope: string): boolean =>
  isSwitchableHelper(helper) &&
  (scope === "*" || (helper === "spa_document_reader" && (READER_SCOPES as readonly string[]).includes(scope)));

/** The words staff read for each helper on the settings screen. */
export const HELPER_LABELS: Readonly<Record<SwitchableHelper, string>> = Object.freeze({
  spa_ownership_check: "Ownership check",
  spa_kyc: "Identity (KYC) check",
  spa_company_check: "Company check",
  spa_document_reader: "Document reader",
  spa_prepare: "Agreement preparation",
  registry: "Registry auto-fix",
  spa_agreement_review: "Agreement review",
});
