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
  /** A document the company names and describes (D50): the vision model reads its name, number and dates. */
  "custom",
  "other",
]);
export type FormDocumentKind = z.infer<typeof FormDocumentKind>;

export const AppliesTo = z.enum(["individual", "company", "both"]);

/**
 * What a failed check does. `warning`: a person reviews and may approve (today's behaviour). `blocker`: it can't be
 * approved past; with `emailApplicant` the engine emails a fresh upload link with the reason. `off`: not checked.
 */
export const KycSeverity = z.enum(["off", "warning", "blocker"]);
export type KycSeverity = z.infer<typeof KycSeverity>;
export const KycCheckSetting = z.object({ severity: KycSeverity, emailApplicant: z.boolean().default(false) });
export type KycCheckSetting = z.infer<typeof KycCheckSetting>;

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
/** A custom document's checks; the expiry ones only when the company says it has an expiry date. */
export const CUSTOM_CHECKS = [
  "expired",
  "valid_long_enough",
  "issued_recently",
  "readable",
  "right_document",
  "name_matches",
] as const;
export type DocCheck = (typeof DOC_CHECKS)[ReadDocKind][number] | (typeof CUSTOM_CHECKS)[number];

/** A company-named document the helper reads (D50). Its description tells the vision model what to expect. */
export const CustomCategory = z.object({
  name: z.string().trim().min(2).max(60),
  description: z.string().trim().max(200).default(""),
  hasExpiry: z.boolean().default(true),
});
export type CustomCategory = z.infer<typeof CustomCategory>;

/** The checks a document field runs: its category's, or a custom document's. */
export function checksFor(kind: ReadDocKind | "custom", custom?: CustomCategory): readonly string[] {
  if (kind !== "custom") return DOC_CHECKS[kind];
  return custom?.hasExpiry === false
    ? CUSTOM_CHECKS.filter((c) => c !== "expired" && c !== "valid_long_enough")
    : CUSTOM_CHECKS;
}
/** Whether a field's document has an expiry date the helper reads. */
export const expiryFor = (kind: ReadDocKind | "custom", custom?: CustomCategory) =>
  kind === "custom" ? custom?.hasExpiry !== false : HAS_EXPIRY.includes(kind);
/** Whether a field's document has an issue date the helper reads. */
export const issueFor = (kind: ReadDocKind | "custom") => kind === "custom" || HAS_ISSUE_DATE.includes(kind);
/** Checks across all documents (keys of `KycCrossSettings.cross`). */
export const CROSS_CHECKS = ["required_documents", "names_consistent", "applicant_name"] as const;
export type CrossCheck = (typeof CROSS_CHECKS)[number];

/**
 * Severities a check may not take. An expired document (or one whose expiry can't be read) never passes, not even by
 * approval; a wrong or unreadable document is always looked at by someone.
 */
export const LOCKED_SEVERITY: Partial<Record<DocCheck, KycSeverity[]>> = {
  expired: ["off", "warning"],
  right_document: ["off"],
  readable: ["off"],
};

/** The KYC rules on one document field (D49): its numbers and every check's severity. */
export const KycDocRules = z.object({
  /** Valid at least this many days after the planned lease start (categories with an expiry date). */
  validityDays: z.number().int().min(0).max(3650).optional(),
  /** Issued at most this many days before the check (`issued_recently`; categories with an issue date). */
  issuedWithinDays: z.number().int().min(1).max(3650).optional(),
  /** Every needed field read with at least this confidence. */
  minConfidence: z.number().min(0.5).max(1),
  checks: z.record(z.string(), KycCheckSetting),
});
export type KycDocRules = z.infer<typeof KycDocRules>;

/**
 * Problems with a document field's rules for its category (unknown checks, locked severities). A check left out takes
 * its default, so rules saved before a check existed stay valid.
 */
export function docRulesIssues(kind: ReadDocKind | "custom", r: KycDocRules, custom?: CustomCategory): string[] {
  const want = checksFor(kind, custom);
  const out: string[] = [];
  if (expiryFor(kind, custom) && r.validityDays === undefined) out.push("validityDays: required");
  if (r.checks.issued_recently && r.checks.issued_recently.severity !== "off" && r.issuedWithinDays === undefined)
    out.push("issuedWithinDays: required when issued_recently is on");
  for (const [k, v] of Object.entries(r.checks)) {
    if (!want.includes(k)) out.push(`checks.${k}: not a check for this document`);
    else if (LOCKED_SEVERITY[k as DocCheck]?.includes(v.severity)) out.push(`checks.${k}: can't be ${v.severity}`);
  }
  return out;
}

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
    /** A document field the helper reads: its KYC rules (D49). Absent: the company's older switches apply. */
    rules: KycDocRules.optional(),
    /** `custom` documents only: what the document is (D50). */
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
        for (const m of docRulesIssues(kind, f.rules, f.customCategory))
          c.addIssue({ code: "custom", message: `rules.${m}` });
    }
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

/** Words that would make a rule screen applicants on nationality, religion, race or similar traits (refused). */
export const PROTECTED_TRAIT =
  /\b(nationalit\w*|nationals?|citizen\w*|religio\w*|muslim|christian|hindu|jewish|race|racial|ethnic\w*|skin colou?r|gender|sex|marital|pregnan\w*|disabilit\w*)\b/i;

/** Document values a pattern rule may test (read from the documents, never typed by the applicant). */
export const PatternField = z.enum(["emiratesIdNo", "passportNo", "visaNo", "tradeLicenceNo", "companyName"]);

/**
 * Valid as a JavaScript regular expression, short, with no repeated group and no back-reference: those are what let
 * a pattern backtrack for ever (`(a+)+`, `(a|aa)+`). ID values are short anyway; repeat single tokens instead.
 */
const SafePattern = z
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

/** Every company rule has a severity (default warning, as before) and, when a blocker, may email the applicant. */
const ruleCommon = {
  id: z.string(),
  label: z.string().max(80),
  severity: KycSeverity.default("warning"),
  emailApplicant: z.boolean().default(false),
};

/** Rules a company adds on top. Code checks all of them except `ai_check`, which can only raise a warning. */
export const KycCompanyRule = z.discriminatedUnion("type", [
  z.object({
    ...ruleCommon,
    type: z.literal("answer_matches_document"),
    fieldKey: z.string(),
    identityField: IdentityField,
  }),
  z.object({
    ...ruleCommon,
    type: z.literal("answer_required"),
    fieldKey: z.string(),
    appliesTo: AppliesTo.default("both"),
    allowed: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  }),
  z.object({
    ...ruleCommon,
    type: z.literal("document_required"),
    documentKind: FormDocumentKind,
    appliesTo: AppliesTo.default("both"),
  }),
  z.object({
    ...ruleCommon,
    type: z.literal("min_age"),
    years: z.number().int().min(18).max(100),
  }),
  z.object({
    ...ruleCommon,
    type: z.literal("document_value_pattern"),
    identityField: PatternField,
    pattern: SafePattern,
    /** What the pattern means, in plain words, shown in the flag ("starts with CN-"). */
    describe: z.string().trim().max(80).default(""),
  }),
  z.object({
    ...ruleCommon,
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

/** Longest document value a pattern rule is tested on (longer values fail the rule rather than run it). */
export const MAX_PATTERN_INPUT = 64;
