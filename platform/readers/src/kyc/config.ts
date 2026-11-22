import {
  AppliesTo,
  CUSTOM_CHECKS,
  type CustomCategory,
  defineKycForm,
  KycCheckSetting,
  type KycDocRules,
  type KycSeverity,
  kycRuleCommon,
  LOCKED_SEVERITY as KERNEL_LOCKED_SEVERITY,
  SafePattern,
} from "@platform/kernel/kyc-form";
import { z } from "zod";

/**
 * Per-company document form and KYC rules (D46). The form is what the applicant's upload link shows; the rules are
 * what the KYC check applies on top of reading the documents. A failed rule is always a flag for a person's review:
 * nothing here rejects an applicant on its own. The domain-free model lives in the shared kernel (S4, S19); this file
 * gives it leasing's document kinds and keeps leasing's switches, rules and wording.
 */
export {
  AppliesTo,
  checkAnswers,
  CUSTOM_CHECKS,
  CustomCategory,
  FormAnswers,
  FormFieldType,
  KycCheckSetting,
  KycDocRules,
  KycSeverity,
  MAX_PATTERN_INPUT,
  PROTECTED_TRAIT,
} from "@platform/kernel/kyc-form";

/** Document categories the KYC helper reads; `other` uploads are kept for staff and never read. */
export const READ_DOC_KINDS = ["emirates_id_front", "emirates_id_back", "passport", "visa", "trade_licence"] as const;
export type ReadDocKind = (typeof READ_DOC_KINDS)[number];
/** Categories with an expiry date the helper reads (the Emirates ID's is on the front). */
export const HAS_EXPIRY: readonly ReadDocKind[] = ["emirates_id_front", "passport", "visa", "trade_licence"];
/** Categories whose issue date the helper reads. */
export const HAS_ISSUE_DATE: readonly ReadDocKind[] = ["emirates_id_front", "passport", "visa", "trade_licence"];

/** The checks each document category runs (keys of a document field's `rules.checks`). */
export const DOC_CHECKS = {
  emirates_id_front: [
    "expired",
    "valid_long_enough",
    "issued_recently",
    "readable",
    "right_document",
    "id_number",
    "birth_year",
  ],
  emirates_id_back: ["readable", "right_document"],
  passport: [
    "expired",
    "valid_long_enough",
    "issued_recently",
    "readable",
    "right_document",
    "mrz",
    "mrz_matches_page",
  ],
  visa: [
    "expired",
    "valid_long_enough",
    "issued_recently",
    "readable",
    "right_document",
    "visa_number",
    "passport_matches",
  ],
  trade_licence: ["expired", "valid_long_enough", "issued_recently", "readable", "right_document"],
} as const satisfies Record<ReadDocKind, readonly string[]>;
export type DocCheck = (typeof DOC_CHECKS)[ReadDocKind][number] | (typeof CUSTOM_CHECKS)[number];

/** Leasing's form model: the kernel's, with the document kinds the leasing KYC reader reads. */
const leasingForm = defineKycForm(READ_DOC_KINDS, {
  emirates_id_front: { checks: DOC_CHECKS.emirates_id_front, hasExpiry: true, hasIssueDate: true },
  emirates_id_back: { checks: DOC_CHECKS.emirates_id_back, hasExpiry: false, hasIssueDate: false },
  passport: { checks: DOC_CHECKS.passport, hasExpiry: true, hasIssueDate: true },
  visa: { checks: DOC_CHECKS.visa, hasExpiry: true, hasIssueDate: true },
  trade_licence: { checks: DOC_CHECKS.trade_licence, hasExpiry: true, hasIssueDate: true },
});

export const FormDocumentKind = leasingForm.FormDocumentKind;
export type FormDocumentKind = z.infer<typeof FormDocumentKind>;

/** The checks a document field runs: its category's, or a custom document's. */
export const checksFor: (kind: ReadDocKind | "custom", custom?: CustomCategory) => readonly string[] =
  leasingForm.checksFor;
/** Whether a field's document has an expiry date the helper reads. */
export const expiryFor: (kind: ReadDocKind | "custom", custom?: CustomCategory) => boolean = leasingForm.expiryFor;
/** Whether a field's document has an issue date the helper reads. */
export const issueFor: (kind: ReadDocKind | "custom") => boolean = leasingForm.issueFor;

/**
 * Severities a check may not take (kernel, the same in every module). An expired document (or one whose expiry can't
 * be read) never passes, not even by approval; a wrong or unreadable document is always looked at by someone.
 */
export const LOCKED_SEVERITY: Readonly<Partial<Record<DocCheck, KycSeverity[]>>> = KERNEL_LOCKED_SEVERITY;

/**
 * Problems with a document field's rules for its category (unknown checks, locked severities). A check left out takes
 * its default, so rules saved before a check existed stay valid.
 */
export const docRulesIssues: (kind: ReadDocKind | "custom", r: KycDocRules, custom?: CustomCategory) => string[] =
  leasingForm.docRulesIssues;

/** Checks across all documents (keys of `KycCrossSettings.cross`). */
export const CROSS_CHECKS = ["required_documents", "names_consistent", "applicant_name"] as const;
export type CrossCheck = (typeof CROSS_CHECKS)[number];

/** Checks across documents and how close the applicant's name must be. */
export const KycCrossSettings = z
  .object({
    cross: z.record(z.string(), KycCheckSetting),
    applicantNameMode: z.enum(["lenient", "exact"]),
  })
  .superRefine((s, c) => {
    for (const k of CROSS_CHECKS)
      if (!s.cross[k]) c.addIssue({ code: "custom", path: ["cross", k], message: "missing" });
    for (const k of Object.keys(s.cross))
      if (!(CROSS_CHECKS as readonly string[]).includes(k))
        c.addIssue({ code: "custom", path: ["cross", k], message: "unknown check" });
  });
export type KycCrossSettings = z.infer<typeof KycCrossSettings>;

export const FormField = leasingForm.FormField;
export type FormField = z.infer<typeof FormField>;

export const DocumentForm = leasingForm.DocumentForm;

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
  /** Checks across documents (D49). Absent (configs saved before them): derived from the switches above. */
  checks: KycCrossSettings.optional(),
});
export type KycBaseRules = z.infer<typeof KycBaseRules>;

const warnIf = (on: boolean): KycCheckSetting => ({ severity: on ? "warning" : "off", emailApplicant: false });
const BLOCK: KycCheckSetting = { severity: "blocker", emailApplicant: false };

/**
 * A document field's checks as they behaved before D49, from the older switches: on = warning, expiry = blocker.
 * Also the starting point when an admin picks a category for a new document field.
 */
export function defaultDocRules(kind: ReadDocKind | "custom", b?: KycBaseRules, custom?: CustomCategory): KycDocRules {
  if (kind === "custom") {
    const expiry = custom?.hasExpiry !== false;
    return {
      ...(expiry ? { validityDays: b?.validityDays ?? 30 } : {}),
      issuedWithinDays: 90,
      minConfidence: b?.minConfidence ?? 0.8,
      checks: {
        ...(expiry ? { expired: BLOCK, valid_long_enough: warnIf(true) } : {}),
        issued_recently: warnIf(false),
        readable: warnIf(true),
        right_document: warnIf(true),
        name_matches: warnIf(true),
      },
    };
  }
  const on = (x: keyof KycBaseRules) => (b ? b[x] === true : true);
  const extra: Record<ReadDocKind, Record<string, KycCheckSetting>> = {
    emirates_id_front: { id_number: warnIf(on("emiratesIdFormat")), birth_year: warnIf(on("emiratesIdFormat")) },
    emirates_id_back: {},
    passport: { mrz: warnIf(on("passportMrz")), mrz_matches_page: warnIf(on("passportMrz")) },
    visa: { visa_number: warnIf(on("visaFormat")), passport_matches: warnIf(on("idNumbersConsistent")) },
    trade_licence: {},
  };
  const expiry = HAS_EXPIRY.includes(kind);
  const issue = issueFor(kind);
  return {
    ...(expiry ? { validityDays: b?.validityDays ?? 30 } : {}),
    ...(issue ? { issuedWithinDays: 90 } : {}),
    minConfidence: b?.minConfidence ?? 0.8,
    checks: {
      ...(expiry ? { expired: BLOCK, valid_long_enough: warnIf(true) } : {}),
      ...(issue ? { issued_recently: warnIf(false) } : {}),
      readable: warnIf(true),
      right_document: warnIf(true),
      ...extra[kind],
    },
  };
}

/** Checks across documents in force: `base.checks` when saved, else the older switches. */
export function effectiveCross(b: KycBaseRules): KycCrossSettings {
  if (b.checks) return b.checks;
  return {
    cross: {
      required_documents: warnIf(b.requiredDocuments),
      names_consistent: warnIf(b.namesConsistent),
      applicant_name: warnIf(b.applicantName !== "off"),
    },
    applicantNameMode: b.applicantName === "exact" ? "exact" : "lenient",
  };
}

/**
 * Each read document's rules in force: the rules on its form field, else the older switches (a kind with no field
 * on the form, or a config saved before D49).
 */
export function effectiveDocRules(b: KycBaseRules, form?: readonly FormField[]): Record<ReadDocKind, KycDocRules> {
  const out = {} as Record<ReadDocKind, KycDocRules>;
  for (const k of READ_DOC_KINDS) {
    const f = form?.find((x) => x.type === "document" && x.documentKind === k);
    out[k] = fieldRules(f, k, b);
  }
  return out;
}

/** A field's rules over its category's defaults (a check the field doesn't list takes the default). */
export function fieldRules(f: FormField | undefined, kind: ReadDocKind | "custom", b?: KycBaseRules): KycDocRules {
  const def = defaultDocRules(kind, b, f?.customCategory);
  if (!f?.rules) return def;
  return { ...def, ...f.rules, checks: { ...def.checks, ...f.rules.checks } };
}

/** Document values a rule may compare with. Nationality is deliberately not one (no screening on personal traits). */
export const IdentityField = z.enum(["fullNameEn", "birthDate", "emiratesIdNo", "passportNo", "visaNo"]);

/** Document values a pattern rule may test (read from the documents, never typed by the applicant). */
export const PatternField = z.enum(["emiratesIdNo", "passportNo", "visaNo", "tradeLicenceNo", "companyName"]);

/** Rules a company adds on top. Code checks all of them except `ai_check`, which can only raise a warning. */
export const KycCompanyRule = z.discriminatedUnion("type", [
  z.object({
    ...kycRuleCommon,
    type: z.literal("answer_matches_document"),
    fieldKey: z.string(),
    identityField: IdentityField,
  }),
  z.object({
    ...kycRuleCommon,
    type: z.literal("answer_required"),
    fieldKey: z.string(),
    appliesTo: AppliesTo.default("both"),
    allowed: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  }),
  z.object({
    ...kycRuleCommon,
    type: z.literal("document_required"),
    documentKind: FormDocumentKind,
    appliesTo: AppliesTo.default("both"),
  }),
  z.object({
    ...kycRuleCommon,
    type: z.literal("min_age"),
    years: z.number().int().min(18).max(100),
  }),
  z.object({
    ...kycRuleCommon,
    type: z.literal("document_value_pattern"),
    identityField: PatternField,
    pattern: SafePattern,
    /** What the pattern means, in plain words, shown in the flag ("starts with CN-"). */
    describe: z.string().trim().max(80).default(""),
  }),
  z.object({
    ...kycRuleCommon,
    type: z.literal("ai_check"),
    instruction: z.string().trim().min(10).max(500),
  }),
]);
export type KycCompanyRule = z.infer<typeof KycCompanyRule>;

export const KycRules = z
  .object({ base: KycBaseRules, company: z.array(KycCompanyRule).max(30) })
  .superRefine((r, c) => {
    r.company.forEach((x, i) => {
      // A model's judgement never blocks an applicant or emails them on its own.
      if (x.type === "ai_check" && x.severity === "blocker")
        c.addIssue({ code: "custom", path: ["company", i, "severity"], message: "an AI check can only warn" });
    });
  });
export type KycRules = z.infer<typeof KycRules>;
