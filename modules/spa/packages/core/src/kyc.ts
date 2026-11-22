import { defineKycForm, KycCheckSetting, kycRuleCommon, PROTECTED_TRAIT, SafePattern } from "@platform/kernel/kyc-form";
import { z } from "zod";
import { FUND_SOURCES } from "./aml-policy.ts";

/**
 * SPA KYC configuration (S19): the kernel's form model with SPA document kinds, SPA rules, and one starter config per
 * party role. Admins change it in Settings (C34); the reader applies it (C17). A model check can only warn; an
 * expired document never passes; no rule may screen on nationality, religion, race or similar traits.
 */
export const SPA_KYC_ROLES = ["buyer_person", "seller_person", "company_party", "beneficial_owner"] as const;
export const SpaKycRole = z.enum(SPA_KYC_ROLES);
export type SpaKycRole = z.infer<typeof SpaKycRole>;

const ID = ["expired", "valid_long_enough", "issued_recently", "readable", "right_document"] as const;
export const SPA_READ_KINDS = [
  "passport",
  "emirates_id_front",
  "emirates_id_back",
  "visa",
  "trade_licence",
  "title_deed",
  "oqood",
  "poa",
  "board_resolution",
  "memorandum",
  "proof_of_address",
] as const;

export const spaKycForm = defineKycForm(SPA_READ_KINDS, {
  passport: { checks: [...ID, "mrz", "name_matches"], hasExpiry: true, hasIssueDate: true },
  emirates_id_front: { checks: [...ID, "id_number", "name_matches"], hasExpiry: true, hasIssueDate: true },
  emirates_id_back: { checks: ["readable", "right_document"], hasExpiry: false, hasIssueDate: false },
  visa: { checks: [...ID, "name_matches"], hasExpiry: true, hasIssueDate: true },
  trade_licence: { checks: [...ID, "name_matches"], hasExpiry: true, hasIssueDate: true },
  title_deed: { checks: ["readable", "right_document", "name_matches"], hasExpiry: false, hasIssueDate: true },
  oqood: { checks: ["readable", "right_document", "name_matches"], hasExpiry: false, hasIssueDate: true },
  poa: {
    checks: ["expired", "valid_long_enough", "readable", "right_document", "name_matches"],
    hasExpiry: true,
    hasIssueDate: true,
  },
  board_resolution: { checks: ["readable", "right_document", "name_matches"], hasExpiry: false, hasIssueDate: true },
  memorandum: { checks: ["readable", "right_document", "name_matches"], hasExpiry: false, hasIssueDate: false },
  proof_of_address: {
    checks: ["issued_recently", "readable", "right_document", "name_matches"],
    hasExpiry: false,
    hasIssueDate: true,
  },
});
export type SpaFormField = z.infer<typeof spaKycForm.FormField>;

const IdentityField = z.enum(["fullNameEn", "birthDate", "passportNo", "emiratesIdNo", "licenceNo"]);
const PatternField = z.enum(["passportNo", "emiratesIdNo", "licenceNo"]);
/** The kernel's list plus traits a label or field key can name. */
const MORE_TRAITS = /\b(ethnicity|origin|tribe|tribal|caste|colou?r)\b/i;
/** A blocker on a field named like this screens people (`age` is fine in a warning or a min-age rule, not as a field). */
const BLOCKER_TRAITS = /\b(age|sex|gender|marital|pregnancy|disability|race|religion)\b/i;
const noTrait = (s: string) => !PROTECTED_TRAIT.test(s) && !MORE_TRAITS.test(s);
/** A field key like `marital_status` or `nationalityCode` as words, so the word list sees them. */
const keyWords = (k: string) =>
  k
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_\-.]+/g, " ")
    .trim();

/** Custom rules on top (specs: KYC forms). Code checks all of them except `ai_check`, which can only warn. */
export const SpaKycRule = z
  .discriminatedUnion("type", [
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
      allowed: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    }),
    z.object({ ...kycRuleCommon, type: z.literal("document_required"), documentKind: spaKycForm.FormDocumentKind }),
    z.object({ ...kycRuleCommon, type: z.literal("min_age"), years: z.number().int().min(18).max(100) }),
    z.object({
      ...kycRuleCommon,
      type: z.literal("document_value_pattern"),
      identityField: PatternField,
      pattern: SafePattern,
      describe: z.string().trim().max(80).default(""),
    }),
    z.object({ ...kycRuleCommon, type: z.literal("ai_check"), instruction: z.string().trim().min(10).max(500) }),
  ])
  .superRefine((r, c) => {
    const words = [
      r.label,
      "instruction" in r ? r.instruction : "",
      "describe" in r ? r.describe : "",
      ...("allowed" in r ? r.allowed : []),
    ];
    const key = "fieldKey" in r ? keyWords(r.fieldKey) : "";
    if (key && (!noTrait(key) || (r.severity === "blocker" && BLOCKER_TRAITS.test(key))))
      c.addIssue({
        code: "custom",
        path: ["fieldKey"],
        message: "rules can't screen on nationality, religion, race or similar traits",
      });
    if (!words.every(noTrait))
      c.addIssue({ code: "custom", message: "rules can't screen on nationality, religion, race or similar traits" });
    if (r.type === "ai_check" && r.severity === "blocker")
      c.addIssue({ code: "custom", path: ["severity"], message: "an AI check can only warn" });
  });
export type SpaKycRule = z.infer<typeof SpaKycRule>;

export const SpaKycRules = z.object({
  minConfidence: z.number().min(0.5).max(1),
  cross: z.object({
    required_documents: KycCheckSetting,
    names_consistent: KycCheckSetting,
    name_matches_deal: KycCheckSetting,
  }),
  company: z.array(SpaKycRule).max(30),
});

export const SpaKycConfig = z.object({ form: spaKycForm.DocumentForm, rules: SpaKycRules }).superRefine((cfg, c) => {
  const keys = new Set(cfg.form.map((f) => f.key));
  cfg.rules.company.forEach((r, i) => {
    if ("fieldKey" in r && !keys.has(r.fieldKey))
      c.addIssue({ code: "custom", path: ["rules", "company", i, "fieldKey"], message: "no such field on the form" });
    if ("fieldKey" in r) {
      const label = cfg.form.find((f) => f.key === r.fieldKey)?.label ?? "";
      if (!noTrait(label) || (r.severity === "blocker" && BLOCKER_TRAITS.test(label)))
        c.addIssue({
          code: "custom",
          path: ["rules", "company", i, "fieldKey"],
          message: "rules can't screen on nationality, religion, race or similar traits",
        });
    }
  });
});
export type SpaKycConfig = z.infer<typeof SpaKycConfig>;

const field = (f: Partial<SpaFormField> & Pick<SpaFormField, "key" | "label" | "type" | "required">): SpaFormField => ({
  placeholder: "",
  help: "",
  appliesTo: "both",
  options: [],
  nameAsPerDocuments: false,
  ...f,
});
const doc = (key: string, label: string, kind: SpaFormField["documentKind"], required: boolean, help = "") =>
  field({ key, label, type: "document", required, documentKind: kind, help });
const nameField = field({
  key: "full_name",
  label: "Full name as on the passport",
  type: "text",
  required: true,
  nameAsPerDocuments: true,
});
/**
 * What the AML policy's source-of-funds evidence list is keyed by (S42). The answer reaches `kyc_runs.answers`, and the
 * AML rule `missing_source_of_funds` (S50) reads it from there. Only a buyer is asked: a company is answered for by
 * its owners, and a seller receives money rather than paying it.
 */
const sourceOfFunds = field({
  key: "source_of_funds",
  label: "Source of funds for this purchase",
  type: "select",
  required: true,
  appliesTo: "individual",
  options: [...FUND_SOURCES],
  help: "Where the money for this purchase comes from",
});
const warn = { severity: "warning" as const, emailApplicant: false };

/** The config a company starts with for each role (it can change all of it). */
export function starterKycConfig(role: SpaKycRole): SpaKycConfig {
  const person = [
    nameField,
    doc("passport", "Passport data page", "passport", true, "Include the two lines of letters at the bottom"),
    doc("eid_front", "Emirates ID, front", "emirates_id_front", false),
    doc("eid_back", "Emirates ID, back", "emirates_id_back", false),
  ];
  const form: SpaFormField[] =
    role === "company_party"
      ? [
          field({
            key: "company_name",
            label: "Company name as on the licence",
            type: "text",
            required: true,
            nameAsPerDocuments: true,
          }),
          doc("trade_licence", "Trade licence", "trade_licence", true),
          doc("memorandum", "Memorandum of association", "memorandum", true),
          doc("board_resolution", "Board resolution naming the signatory", "board_resolution", false),
          doc("poa", "Power of attorney for the signatory", "poa", false),
        ]
      : role === "beneficial_owner"
        ? [nameField, doc("passport", "Passport data page", "passport", true)]
        : role === "buyer_person"
          ? [...person, doc("proof_of_address", "Proof of address", "proof_of_address", false), sourceOfFunds]
          : [...person, doc("proof_of_address", "Proof of address", "proof_of_address", false)];
  return {
    form,
    rules: {
      minConfidence: 0.8,
      cross: { required_documents: warn, names_consistent: warn, name_matches_deal: warn },
      company: [],
    },
  };
}
