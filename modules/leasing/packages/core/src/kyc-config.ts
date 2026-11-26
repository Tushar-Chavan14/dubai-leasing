/**
 * Leasing's side of the KYC configuration. The document model, base rules, company rules and the pure helpers that
 * apply them moved to `@platform/readers/kyc/config` (S49, C17), where the shared KYC reader uses them; they are
 * re-exported here so leasing imports stay the same. What stays is leasing's starter form, its defaults and the words
 * an applicant is told.
 */
import {
  type FormField,
  type KycBaseRules,
  type KycRules,
  READ_DOC_KINDS,
  type ReadDocKind,
  fieldRules,
} from "@platform/readers/kyc/config";
export * from "@platform/readers/kyc/config";

/** The form a company starts with (it can change all of it). */
export const STARTER_FORM: FormField[] = [
  {
    key: "full_name",
    label: "Full name as per documents",
    placeholder: "As printed on your passport or Emirates ID",
    help: "",
    type: "text",
    required: true,
    appliesTo: "both",
    options: [],
    nameAsPerDocuments: true,
  },
  {
    key: "eid_front",
    label: "Emirates ID, front",
    placeholder: "",
    help: "The side with your photo",
    type: "document",
    required: false,
    appliesTo: "both",
    options: [],
    documentKind: "emirates_id_front",
    nameAsPerDocuments: false,
  },
  {
    key: "eid_back",
    label: "Emirates ID, back",
    placeholder: "",
    help: "The side with the card number",
    type: "document",
    required: false,
    appliesTo: "both",
    options: [],
    documentKind: "emirates_id_back",
    nameAsPerDocuments: false,
  },
  {
    key: "passport",
    label: "Passport data page",
    placeholder: "",
    help: "Include the two lines of letters at the bottom",
    type: "document",
    required: false,
    appliesTo: "both",
    options: [],
    documentKind: "passport",
    nameAsPerDocuments: false,
  },
  {
    key: "visa",
    label: "Residence visa",
    placeholder: "",
    help: "The visa page or e-visa",
    type: "document",
    required: false,
    appliesTo: "individual",
    options: [],
    documentKind: "visa",
    nameAsPerDocuments: false,
  },
  {
    key: "trade_licence",
    label: "Trade licence",
    placeholder: "",
    help: "The current licence page",
    type: "document",
    required: true,
    appliesTo: "company",
    options: [],
    documentKind: "trade_licence",
    nameAsPerDocuments: false,
  },
];

export const defaultBaseRules = (policy: { kycMinValidityDays: number; kycMinConfidence: number }): KycBaseRules => ({
  validityDays: policy.kycMinValidityDays,
  minConfidence: policy.kycMinConfidence,
  requiredDocuments: true,
  emiratesIdFormat: true,
  passportMrz: true,
  visaFormat: true,
  namesConsistent: true,
  applicantName: "lenient",
  idNumbersConsistent: true,
});

const DOC_WORD: Record<ReadDocKind, string> = {
  emirates_id_front: "Emirates ID (front)",
  emirates_id_back: "Emirates ID (back)",
  passport: "passport",
  visa: "residence visa",
  trade_licence: "trade licence",
};

/**
 * What the applicant is told when a blocker emails them a new upload link, by check id (`passport.readable`,
 * `cross.names_consistent`, `rule:<id>`). Code-written and free of personal data: no names, numbers or dates. The
 * document is named by its form field's label when the form has one.
 */
export function applicantReason(check: string, rules: KycRules, form?: readonly FormField[]): string | null {
  if (check.startsWith("rule:")) {
    const r = rules.company.find((x) => `rule:${x.id}` === check);
    return r ? `${r.label}.` : null;
  }
  const [scope, key] = check.split(".") as [string, string];
  if (scope === "cross") {
    if (key === "required_documents") return "Some required documents or answers are missing.";
    if (key === "names_consistent") return "The name isn't the same on all your documents.";
    if (key === "applicant_name")
      return "The name you entered doesn't match your documents; please enter it exactly as printed.";
    return null;
  }
  // `custom:<field key>` for a company-named document, else a read category.
  const customKey = scope.startsWith("custom:") ? scope.slice("custom:".length) : null;
  const field = customKey
    ? form?.find((f) => f.key === customKey && f.documentKind === "custom")
    : form?.find((f) => f.type === "document" && f.documentKind === scope);
  if (customKey ? !field : !(READ_DOC_KINDS as readonly string[]).includes(scope)) return null;
  const kind = (customKey ? "custom" : scope) as ReadDocKind | "custom";
  const doc = field ? `"${field.label}"` : DOC_WORD[kind as ReadDocKind];
  const r = fieldRules(field, kind, rules.base);
  switch (key) {
    case "expired":
      return `Your ${doc} has expired, expires before the move-in date, or its expiry date couldn't be read; please upload a clear photo of a current one.`;
    case "valid_long_enough":
      return `Your ${doc} must be valid for at least ${r.validityDays ?? 0} days after the move-in date.`;
    case "issued_recently":
      return `Your ${doc} must have been issued in the last ${r.issuedWithinDays ?? 0} days, with the issue date visible.`;
    case "name_matches":
      return `The name on your ${doc} must be yours (or your company's).`;
    case "readable":
      return `The photo of your ${doc} wasn't clear enough to read; please upload a sharp, well-lit photo of the whole document.`;
    case "right_document":
      return `The upload for your ${doc} looks like a different document.`;
    case "id_number":
    case "birth_year":
      return "We couldn't confirm the Emirates ID number; please upload a clear photo of the front.";
    case "mrz":
    case "mrz_matches_page":
      return "We couldn't confirm the two lines of letters at the bottom of your passport page; please make sure they are fully visible.";
    case "visa_number":
      return "We couldn't read the visa file number; please upload a clear photo of the visa.";
    case "passport_matches":
      return "The passport number on your visa doesn't match your passport; please upload the visa for this passport.";
    default:
      return null;
  }
}

/** Automatic re-upload emails one application can get before a person takes over. */
export const MAX_AUTO_REUPLOAD_EMAILS = 2;
