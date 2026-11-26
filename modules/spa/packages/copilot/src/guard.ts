import { isComplianceRole, type SpaRole } from "@spa/core";

/**
 * The compliance-visibility guard (S6, S42, S57, S68). A reply or tool result that carries one of these words never
 * reaches a role outside the two compliance roles; the person is told only that a review is open. Whole words only, with underscore tokens split (AML_HOLD, edd_signoff); a party named Edd matches (S68).
 */
export const AML_WORDS_PATTERN =
  /(?<![A-Za-z])(?:aml|edd|peps?|anti[-\s]?money|sanction\w*|screening|screened|risks?|risky|launder\w*|suspicious|flagged|politically\s+exposed)(?![A-Za-z])/i;
export const hasAmlWord = (text: string): boolean => AML_WORDS_PATTERN.test(text);

/** The words of the pattern without the bare "risk" family, which has an everyday sense ("risk of delay"). */
const COMPLIANCE_ASK_PATTERN = new RegExp(
  AML_WORDS_PATTERN.source.replace("|risks?|risky", "") +
    "|(?<![A-Za-z])(?:risk\\s+(?:assessment|level|score|rating|profile|band|category|classification)|(?:high|medium|low)[-\\s]risk\\s+(?:buyer|seller|party|customer|client|deal|rating|country|jurisdiction))(?![A-Za-z])",
  "i",
);
/** A message from a person that asks about a compliance review (the neutral line, no model run). A bare "risk" does not. */
export const asksAboutCompliance = (text: string): boolean => COMPLIANCE_ASK_PATTERN.test(text);
export const COMPLIANCE_OPEN_REPLY = "Compliance review is open.";

/** The guard for a role: none for compliance roles, the word list for everyone else (admin included). */
export const bannedFor = (role: SpaRole): ((text: string) => boolean) | undefined =>
  isComplianceRole(role) ? undefined : hasAmlWord;
