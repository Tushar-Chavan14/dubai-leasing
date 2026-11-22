/**
 * Chasing parties (C25, S23, S60): the fixed reasons a chase may give, and what an admin-written email template may hold.
 * No model writes chase text. A reason is a code from this list; the words are fixed here. Anything compliance asked
 * for is mapped to `additional_documents` before it leaves the compliance code, so a review is never revealed.
 */
export const CHASE_REASONS = {
  document_missing: "document not received yet",
  passport_expired: "passport expired",
  document_expired: "document expired",
  photo_unreadable: "photo unreadable",
  name_differs_title_deed: "name differs from the title deed",
  name_differs_deal: "name differs from the name on the deal",
  wrong_document: "this is not the document we asked for",
  additional_documents: "Additional documents needed",
} as const;
export type ChaseReasonCode = keyof typeof CHASE_REASONS;
export const CHASE_REASON_CODES = Object.keys(CHASE_REASONS) as ChaseReasonCode[];

/**
 * The only reason a compliance-originated item (or any item of a party under a compliance review) may carry. It takes no
 * argument on purpose: the original reason can't be passed through it.
 */
export const neutralChaseReason = (): ChaseReasonCode => "additional_documents";

/** The placeholders a template may hold; code fills them. Anything else in braces is refused on save. */
export const CHASE_ALLOWED_PLACEHOLDERS = [
  "party_name",
  "property",
  "items",
  "agent_name",
  "agent_email",
  "company_name",
] as const;
export type ChasePlaceholder = (typeof CHASE_ALLOWED_PLACEHOLDERS)[number];

/** Words a chase may never hold (S23, tipping-off): a template that has one cannot be saved or approved. */
const BANNED_WORDS =
  /\b(aml|anti[- ]?money[- ]?laundering|money laundering|laundering|sanctions?|screening|screened|pep|peps|edd|suspicious|compliance|risks?|flag(?:s|ged|ging)?|report(?:s|ed|ing)?|review(?:s|ed|ing)?|hold(?:s|ing)?)\b/i;
export const hasBannedChaseWord = (text: string): boolean => BANNED_WORDS.test(text);

export const CHASE_SUBJECT_MAX = 120;
export const CHASE_BODY_MAX = 4000;

/** What is wrong with a template, in plain words (empty = fine). Run on save and again on approval. */
export function chaseTemplateProblems(t: { subject: string; body: string }): string[] {
  const problems: string[] = [];
  const subject = t.subject.trim();
  const body = t.body.trim();
  if (!subject) problems.push("The subject is empty.");
  if (!body) problems.push("The body is empty.");
  if (subject.length > CHASE_SUBJECT_MAX) problems.push(`The subject is longer than ${CHASE_SUBJECT_MAX} characters.`);
  if (body.length > CHASE_BODY_MAX) problems.push(`The body is longer than ${CHASE_BODY_MAX} characters.`);
  const allowed: readonly string[] = CHASE_ALLOWED_PLACEHOLDERS;
  const unknown = new Set<string>();
  for (const m of `${subject}\n${body}`.matchAll(/\{([^{}]*)\}/g)) if (!allowed.includes(m[1]!)) unknown.add(m[1]!);
  for (const u of unknown) problems.push(`{${u}} is not a placeholder code can fill.`);
  if (/[{}]/.test(`${subject}\n${body}`.replace(/\{([^{}]*)\}/g, ""))) problems.push("A curly bracket is left open.");
  if (!body.includes("{items}")) problems.push("The body must hold {items}: the list of what is needed.");
  if (hasBannedChaseWord(`${subject}\n${body}`)) problems.push("The text holds a word a chase may never use.");
  return problems;
}
