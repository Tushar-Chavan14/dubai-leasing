import { z } from "zod";

/**
 * Per-company document form and KYC rules (D46). The form is what the applicant's upload link shows; the rules are
 * what the KYC check applies on top of reading the documents. A failed rule is always a flag for a person's review:
 * nothing here rejects an applicant on its own.
 */
export const FormFieldType = z.enum(["text", "email", "phone", "date", "number", "select", "document"]);
export type FormFieldType = z.infer<typeof FormFieldType>;

export const FormDocumentKind = z.enum([
  "emirates_id_front",
  "emirates_id_back",
  "passport",
  "visa",
  "trade_licence",
  "other",
]);
export type FormDocumentKind = z.infer<typeof FormDocumentKind>;

export const AppliesTo = z.enum(["individual", "company", "both"]);

export const FormField = z
  .object({
    key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, "lower case letters, digits and _"),
    label: z.string().trim().min(1).max(80),
    placeholder: z.string().trim().max(120).default(""),
    help: z.string().trim().max(200).default(""),
    type: FormFieldType,
    required: z.boolean(),
    appliesTo: AppliesTo.default("both"),
    /** `select` only. */
    options: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    /** `document` only: which document the upload is. */
    documentKind: FormDocumentKind.optional(),
    /** One text field: the applicant's full name as printed on their documents (used for the name check). */
    nameAsPerDocuments: z.boolean().default(false),
  })
  .superRefine((f, c) => {
    if (f.type === "document" && !f.documentKind)
      c.addIssue({ code: "custom", message: "documentKind: required for a document field" });
    if (f.type === "select" && f.options.length < 2)
      c.addIssue({ code: "custom", message: "options: give at least two" });
    if (f.nameAsPerDocuments && f.type !== "text")
      c.addIssue({ code: "custom", message: "nameAsPerDocuments: only on a text field" });
  });
export type FormField = z.infer<typeof FormField>;

export const DocumentForm = z
  .array(FormField)
  .min(1)
  .max(40)
  .superRefine((fs, c) => {
    const keys = fs.map((f) => f.key);
    if (new Set(keys).size !== keys.length) c.addIssue({ code: "custom", message: "each field needs its own key" });
    if (fs.filter((f) => f.nameAsPerDocuments).length > 1)
      c.addIssue({ code: "custom", message: "only one field can be the name as per documents" });
    if (!fs.some((f) => f.type === "document"))
      c.addIssue({ code: "custom", message: "add at least one document field" });
    const docs = fs.filter((f) => f.type === "document");
    // An application holds at most 10 uploads (MAX_DOCS), and each ID document fills one slot.
    if (docs.length > 10) c.addIssue({ code: "custom", message: "at most 10 document fields" });
    const kinds = docs.map((f) => f.documentKind).filter((k) => k && k !== "other");
    if (new Set(kinds).size !== kinds.length)
      c.addIssue({ code: "custom", message: "each ID document can be on the form once" });
  });

/** Today's fixed checks, each switchable, with their values (defaults match the previous behaviour). */
export const KycBaseRules = z.object({
  validityDays: z.number().int().min(0).max(365),
  minConfidence: z.number().min(0.5).max(1),
  requiredDocuments: z.boolean(),
  emiratesIdFormat: z.boolean(),
  passportMrz: z.boolean(),
  visaFormat: z.boolean(),
  namesConsistent: z.boolean(),
  applicantName: z.enum(["off", "lenient", "exact"]),
  idNumbersConsistent: z.boolean(),
});
export type KycBaseRules = z.infer<typeof KycBaseRules>;

/** Document values a rule may compare with. Nationality is deliberately not one (no screening on personal traits). */
export const IdentityField = z.enum(["fullNameEn", "birthDate", "emiratesIdNo", "passportNo", "visaNo"]);

/** Words that would make a rule screen applicants on nationality, religion, race or similar traits (refused). */
export const PROTECTED_TRAIT =
  /\b(nationalit\w*|nationals?|citizen\w*|religio\w*|muslim|christian|hindu|jewish|race|racial|ethnic\w*|skin colou?r|gender|sex|marital|pregnan\w*|disabilit\w*)\b/i;

/** Rules a company adds on top. Code checks all of them except `ai_check`, which can only raise a flag. */
export const KycCompanyRule = z.discriminatedUnion("type", [
  z.object({
    id: z.string(),
    type: z.literal("answer_matches_document"),
    label: z.string().max(80),
    fieldKey: z.string(),
    identityField: IdentityField,
  }),
  z.object({
    id: z.string(),
    type: z.literal("answer_required"),
    label: z.string().max(80),
    fieldKey: z.string(),
    appliesTo: AppliesTo.default("both"),
    allowed: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  }),
  z.object({
    id: z.string(),
    type: z.literal("document_required"),
    label: z.string().max(80),
    documentKind: FormDocumentKind,
    appliesTo: AppliesTo.default("both"),
  }),
  z.object({
    id: z.string(),
    type: z.literal("min_age"),
    label: z.string().max(80),
    years: z.number().int().min(18).max(100),
  }),
  z.object({
    id: z.string(),
    type: z.literal("ai_check"),
    label: z.string().max(80),
    instruction: z.string().trim().min(10).max(500),
  }),
]);
export type KycCompanyRule = z.infer<typeof KycCompanyRule>;

export const KycRules = z.object({ base: KycBaseRules, company: z.array(KycCompanyRule).max(30) });
export type KycRules = z.infer<typeof KycRules>;

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

/** What an applicant typed in the form, with the form version they answered. */
export const FormAnswers = z.object({
  version: z.number().int().min(0),
  answers: z.record(z.string(), z.string().max(500)),
});
export type FormAnswers = z.infer<typeof FormAnswers>;

/** Checks typed answers against the form (required, type, options). Returns `key: message` problems. */
export function checkAnswers(
  form: FormField[],
  kind: "individual" | "company",
  answers: Record<string, string>,
): string[] {
  const problems: string[] = [];
  for (const f of form) {
    if (f.type === "document" || (f.appliesTo !== "both" && f.appliesTo !== kind)) continue;
    const v = (answers[f.key] ?? "").trim();
    if (!v) {
      if (f.required) problems.push(`${f.key}: ${f.label} is required`);
      continue;
    }
    if (f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) problems.push(`${f.key}: enter an email address`);
    if (f.type === "phone" && !/^\+?[\d\s()-]{7,20}$/.test(v)) problems.push(`${f.key}: enter a phone number`);
    if (f.type === "date" && !/^\d{4}-\d{2}-\d{2}$/.test(v)) problems.push(`${f.key}: enter a date`);
    if (f.type === "number" && !Number.isFinite(Number(v))) problems.push(`${f.key}: enter a number`);
    if (f.type === "select" && !f.options.includes(v)) problems.push(`${f.key}: choose one of the options`);
  }
  return problems;
}
