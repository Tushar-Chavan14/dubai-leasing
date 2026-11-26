import { z } from "zod";

/**
 * The domain-free part of a company's document form and KYC rules (leasing D46, D49, D50; SPA S19). A module passes
 * the document kinds its KYC reader reads (with each kind's checks) to `defineKycForm`; everything else here is the
 * same for every module. A failed rule is always a flag for a person: nothing here rejects anyone on its own.
 */
export const FormFieldType = z.enum(["text", "email", "phone", "date", "number", "select", "document"]);
export type FormFieldType = z.infer<typeof FormFieldType>;

export const AppliesTo = z.enum(["individual", "company", "both"]);

/**
 * What a failed check does. `warning`: a person reviews and may approve. `blocker`: it can't be approved past; with
 * `emailApplicant` the engine emails a fresh upload link with the reason. `off`: not checked.
 */
export const KycSeverity = z.enum(["off", "warning", "blocker"]);
export type KycSeverity = z.infer<typeof KycSeverity>;
export const KycCheckSetting = z.object({ severity: KycSeverity, emailApplicant: z.boolean().default(false) });
export type KycCheckSetting = z.infer<typeof KycCheckSetting>;

/** A custom document's checks; the expiry ones only when the company says it has an expiry date. */
export const CUSTOM_CHECKS = [
  "expired",
  "valid_long_enough",
  "issued_recently",
  "readable",
  "right_document",
  "name_matches",
] as const;

/** A company-named document the reader reads (leasing D50). Its description tells the vision model what to expect. */
export const CustomCategory = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(""),
  hasExpiry: z.boolean().default(true),
});
export type CustomCategory = z.infer<typeof CustomCategory>;

/**
 * Severities a check may not take, in every module. An expired document (or one whose expiry can't be read) never
 * passes, not even by approval; a wrong or unreadable document is always looked at by someone.
 */
export const LOCKED_SEVERITY: Readonly<Partial<Record<string, KycSeverity[]>>> = Object.freeze({
  expired: ["off", "warning"],
  right_document: ["off"],
  readable: ["off"],
});

/** The KYC rules on one document field: its numbers and every check's severity. */
export const KycDocRules = z.object({
  /** Valid at least this many days after the planned start (categories with an expiry date). */
  validityDays: z.number().int().min(0).max(3650).optional(),
  /** Issued at most this many days before the check (`issued_recently`; categories with an issue date). */
  issuedWithinDays: z.number().int().min(1).max(3650).optional(),
  /** Every needed field read with at least this confidence. */
  minConfidence: z.number().min(0.5).max(1),
  checks: z.record(z.string(), KycCheckSetting),
});
export type KycDocRules = z.infer<typeof KycDocRules>;

/** Words that would make a rule screen people on nationality, religion, race or similar traits (refused). */
export const PROTECTED_TRAIT =
  /\b(nationalit\w*|nationals?|citizen\w*|religio\w*|muslim|christian|hindu|jewish|race|racial|ethnic\w*|skin colou?r|gender|sex|marital|pregnan\w*|disabilit\w*)\b/i;

/**
 * Valid as a JavaScript regular expression, short, with no repeated group and no back-reference: those are what let
 * a pattern backtrack for ever (`(a+)+`, `(a|aa)+`). ID values are short anyway; repeat single tokens instead.
 */
export const SafePattern = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .refine((p) => {
    try {
      const re = new RegExp(p);
      return !!re.source && !/\)\s*[+*?{]/.test(p) && !/\\[1-9k]/.test(p);
    } catch {
      return false;
    }
  }, "not a valid pattern (or one with nested repeats)");

/** Longest document value a pattern rule is tested on (longer values fail the rule rather than run it). */
export const MAX_PATTERN_INPUT = 64;

/** Every company rule has a severity (default warning) and, when a blocker, may email the person. */
export const kycRuleCommon = {
  id: z.string(),
  label: z.string().max(80),
  severity: KycSeverity.default("warning"),
  emailApplicant: z.boolean().default(false),
};

/** What a person typed in the form, with the form version they answered. */
export const FormAnswers = z.object({
  version: z.number().int().min(0),
  answers: z.record(z.string(), z.string().max(500)),
});
export type FormAnswers = z.infer<typeof FormAnswers>;

/** What a module says about one document kind its reader reads. */
export interface ReadKindSpec {
  /** The checks a field of this kind runs (keys of its `rules.checks`). */
  checks: readonly string[];
  /** The reader reads an expiry date. */
  hasExpiry: boolean;
  /** The reader reads an issue date. */
  hasIssueDate: boolean;
}

/**
 * A module's form model for the document kinds its reader reads (`readKinds`, in order). Two kinds are always added:
 * `custom` (a company-named document the reader reads) and `other` (kept for staff, never read).
 */
export function defineKycForm<const K extends string>(readKinds: readonly [K, ...K[]], specs: Record<K, ReadKindSpec>) {
  type Kind = K | "custom";
  const FormDocumentKind = z.enum([...readKinds, "custom", "other"] as (K | "custom" | "other")[]);

  /** The checks a document field runs: its category's, or a custom document's. */
  function checksFor(kind: Kind, custom?: CustomCategory): readonly string[] {
    if (kind !== "custom") return specs[kind as K].checks;
    return custom?.hasExpiry === false
      ? CUSTOM_CHECKS.filter((c) => c !== "expired" && c !== "valid_long_enough")
      : CUSTOM_CHECKS;
  }
  /** Whether a field's document has an expiry date the reader reads. */
  const expiryFor = (kind: Kind, custom?: CustomCategory): boolean =>
    kind === "custom" ? custom?.hasExpiry !== false : specs[kind as K].hasExpiry;
  /** Whether a field's document has an issue date the reader reads. */
  const issueFor = (kind: Kind): boolean => kind === "custom" || specs[kind as K].hasIssueDate;

  /**
   * Problems with a document field's rules for its category (unknown checks, locked severities). A check left out
   * takes its default, so rules saved before a check existed stay valid.
   */
  function docRulesIssues(kind: Kind, r: KycDocRules, custom?: CustomCategory): string[] {
    const want = checksFor(kind, custom);
    const out: string[] = [];
    if (expiryFor(kind, custom) && r.validityDays === undefined) out.push("validityDays: required");
    if (r.checks.issued_recently && r.checks.issued_recently.severity !== "off" && r.issuedWithinDays === undefined)
      out.push("issuedWithinDays: required when issued_recently is on");
    for (const [k, v] of Object.entries(r.checks)) {
      if (!want.includes(k)) out.push(`checks.${k}: not a check for this document`);
      else if (LOCKED_SEVERITY[k]?.includes(v.severity)) out.push(`checks.${k}: can't be ${v.severity}`);
    }
    return out;
  }

  const FormField = z
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
      /** One text field: the person's full name as printed on their documents (used for the name check). */
      nameAsPerDocuments: z.boolean().default(false),
      /** A document field the reader reads: its KYC rules. Absent: the company's older switches apply. */
      rules: KycDocRules.optional(),
      /** `custom` documents only: what the document is. */
      customCategory: CustomCategory.optional(),
    })
    .superRefine((f, c) => {
      const kind = f.type === "document" ? f.documentKind : undefined;
      if (kind === "custom" && !f.customCategory)
        c.addIssue({ code: "custom", message: "customCategory: name the custom document" });
      if (kind !== "custom" && f.customCategory)
        c.addIssue({ code: "custom", message: "customCategory: only on a custom document" });
      if (f.rules) {
        if (!kind || kind === "other")
          c.addIssue({ code: "custom", message: "rules: only on a document field that is read" });
        else
          for (const m of docRulesIssues(kind as Kind, f.rules, f.customCategory))
            c.addIssue({ code: "custom", message: `rules.${m}` });
      }
      if (f.type === "document" && !f.documentKind)
        c.addIssue({ code: "custom", message: "documentKind: required for a document field" });
      if (f.type === "select" && f.options.length < 2)
        c.addIssue({ code: "custom", message: "options: give at least two" });
      if (f.nameAsPerDocuments && f.type !== "text")
        c.addIssue({ code: "custom", message: "nameAsPerDocuments: only on a text field" });
    });

  const DocumentForm = z
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
      // An upload set holds at most 10 documents, and each ID document fills one slot.
      if (docs.length > 10) c.addIssue({ code: "custom", message: "at most 10 document fields" });
      const kinds = docs.map((f) => f.documentKind).filter((k) => k && k !== "other");
      if (new Set(kinds).size !== kinds.length)
        c.addIssue({ code: "custom", message: "each ID document can be on the form once" });
    });

  return { FormDocumentKind, checksFor, expiryFor, issueFor, docRulesIssues, FormField, DocumentForm };
}

/** Checks typed answers against the form (required, type, options). Returns `key: message` problems. */
export function checkAnswers(
  form: readonly {
    key: string;
    label: string;
    type: FormFieldType;
    required: boolean;
    appliesTo: "individual" | "company" | "both";
    options: string[];
  }[],
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
