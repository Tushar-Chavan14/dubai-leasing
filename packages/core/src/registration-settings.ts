import { z } from "zod";
import type { Emirate } from "./emirates.ts";

/** Documents a registration office may ask for that don't come from the applicant's KYC step. */
export const DOCUMENT_KEYS = z.enum([
  "signed_contract",
  "landlord_trade_licence",
  "title_deed",
  "previous_registration_cancelled",
  "other",
]);
export type FixedDocumentKey = z.infer<typeof DOCUMENT_KEYS>;

/** The ID documents every KYC form can ask for (`documents.kind` of the upload). */
export const KYC_DOCUMENT_KINDS = ["emirates_id", "passport", "visa", "trade_licence"] as const;
export type KycDocumentKind = (typeof KYC_DOCUMENT_KINDS)[number];

/**
 * One item of an emirate's registration checklist (D62):
 * - a fixed document (`signed_contract`, `title_deed`, …);
 * - `kyc:<kind>`: the applicant's verified Emirates ID, passport, visa or trade licence, attached to the pack;
 * - `kyc:other:<fieldKey>`: a company's own KYC document field (custom or other), attached when verified;
 * - `answer:<fieldKey>`: the applicant's answer to a company's own KYC question, printed in the pack.
 */
export const RequiredDocument = z.union([
  DOCUMENT_KEYS,
  z.enum(KYC_DOCUMENT_KINDS.map((k) => `kyc:${k}`) as [`kyc:${KycDocumentKind}`, ...`kyc:${KycDocumentKind}`[]]),
  z.string().regex(/^kyc:other:[a-z][a-z0-9_]{1,39}$/) as z.ZodType<`kyc:other:${string}`>,
  z.string().regex(/^answer:[a-z][a-z0-9_]{1,39}$/) as z.ZodType<`answer:${string}`>,
]);
export type DocumentKey = z.infer<typeof RequiredDocument>;

/** Keys saved before D62, read as their KYC documents. */
const LEGACY_KEYS: Record<string, DocumentKey[]> = {
  tenant_identity: ["kyc:emirates_id", "kyc:passport"],
  tenant_visa: ["kyc:visa"],
  tenant_trade_licence: ["kyc:trade_licence"],
};

/** Reads a stored or submitted checklist: old keys become their KYC documents, duplicates go. */
export function upgradeDocumentKeys(keys: readonly string[]): string[] {
  // Only an old list is de-duplicated (its expansion may overlap); a new one keeps duplicates so they are refused.
  if (!keys.some((k) => k in LEGACY_KEYS)) return [...keys];
  return [...new Set(keys.flatMap((k) => LEGACY_KEYS[k] ?? [k]))];
}

const FIXED_LABELS: Record<FixedDocumentKey | `kyc:${KycDocumentKind}`, string> = {
  signed_contract: "Signed tenancy contract",
  landlord_trade_licence: "Landlord trade licence (company landlords)",
  title_deed: "Title deed or ownership proof",
  previous_registration_cancelled: "Proof the previous registration was cancelled",
  other: "Other document the office asks for",
  "kyc:emirates_id": "Tenant Emirates ID",
  "kyc:passport": "Tenant passport",
  "kyc:visa": "Tenant residence visa",
  "kyc:trade_licence": "Tenant trade licence (company tenants)",
};

/** Plain label of a checklist item. Company fields take their KYC form label when one is given. */
export function documentKeyLabel(key: string, fieldLabels?: ReadonlyMap<string, string>): string {
  if (key in FIXED_LABELS) return FIXED_LABELS[key as keyof typeof FIXED_LABELS];
  const field = key.startsWith("kyc:other:") ? key.slice(10) : key.startsWith("answer:") ? key.slice(7) : null;
  if (field === null) return key;
  const label = fieldLabels?.get(field) ?? field.replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
  return key.startsWith("answer:") ? `Applicant's answer: ${label}` : `Tenant document: ${label}`;
}

/** Labels of the fixed and standard KYC items (company fields need their form; see documentKeyLabel). */
export const DOCUMENT_KEY_LABELS: Record<FixedDocumentKey | `kyc:${KycDocumentKind}`, string> = FIXED_LABELS;

/** Mode "online" needs a registration adapter in the engine; otherwise staff register by hand. */
export const RegistrationSettings = z
  .strictObject({
    mode: z.enum(["online", "manual"]),
    portalName: z.string().trim().min(1).max(120),
    portalUrl: z
      .string()
      .trim()
      .max(500)
      .refine((v) => {
        try {
          return new URL(v).protocol === "https:";
        } catch {
          return false;
        }
      }, "must be an https URL")
      .nullable(),
    /** Plain text, shown to the officer. */
    instructions: z.string().trim().max(2000),
    requiredDocuments: z.preprocess(
      (v) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? upgradeDocumentKeys(v) : v),
      z
        .array(RequiredDocument)
        .min(1)
        .max(40)
        .refine((a) => new Set(a).size === a.length, "documents must be unique"),
    ),
    referenceExample: z.string().trim().max(60),
    /** Anchored JS regular expression (^...$) the recorded reference must match. */
    referencePattern: z.string().max(120),
    sources: z.array(z.string().max(500)).max(10),
  })
  .superRefine((v, ctx) => {
    if (!v.referencePattern.startsWith("^") || !v.referencePattern.endsWith("$")) {
      ctx.addIssue({ code: "custom", path: ["referencePattern"], message: "pattern must start with ^ and end with $" });
      return;
    }
    // ReDoS guard: no quantified group that itself holds a quantifier or an alternation, and nothing that matches everything.
    if (
      /\([^)]*[+*][^)]*\)[+*{]/.test(v.referencePattern) ||
      /\([^)]*\|[^)]*\)[+*{]/.test(v.referencePattern) ||
      /^\^\.[*+]\$$/.test(v.referencePattern)
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["referencePattern"],
        message: "pattern is too loose or too complex; describe the reference's real shape",
      });
      return;
    }
    try {
      void new RegExp(v.referencePattern);
    } catch {
      ctx.addIssue({
        code: "custom",
        path: ["referencePattern"],
        message: "pattern is not a valid regular expression",
      });
    }
  });
export type RegistrationSettings = z.infer<typeof RegistrationSettings>;

const GENERAL = "From the general data available:";
const MANUAL_DOCS: DocumentKey[] = [
  "signed_contract",
  "kyc:emirates_id",
  "kyc:passport",
  "landlord_trade_licence",
  "title_deed",
  "previous_registration_cancelled",
];

export const DEFAULT_REGISTRATION_SETTINGS: Record<Emirate, RegistrationSettings> = {
  dubai: {
    mode: "online",
    portalName: "Ejari (Dubai REST / DLD)",
    portalUrl: "https://dubailand.gov.ae",
    instructions:
      "Ejari registration is submitted through the registry connection after the officer approves the pack. The Ejari certificate is attached to the lease when issued.",
    requiredDocuments: [
      "signed_contract",
      "kyc:emirates_id",
      "kyc:passport",
      "kyc:visa",
      "title_deed",
      "landlord_trade_licence",
    ],
    referenceExample: "SIM-2026-0000123",
    referencePattern: "^(SIM-\\d{4}-\\d{7}|[A-Za-z0-9-]{4,30})$",
    sources: [`${GENERAL} Ejari is the Dubai Land Department tenancy registration system.`],
  },
  abu_dhabi: {
    mode: "online",
    portalName: "Tawtheeq (TAMM)",
    portalUrl: "https://www.tamm.abudhabi",
    instructions:
      "Tawtheeq registration is submitted through the registry connection after the officer approves the pack. The Tawtheeq certificate is attached to the lease when issued.",
    requiredDocuments: ["signed_contract", "kyc:emirates_id", "kyc:passport", "title_deed", "landlord_trade_licence"],
    referenceExample: "SIM-TWQ-2026-0000123",
    referencePattern: "^(SIM-TWQ-\\d{4}-\\d{7}|[A-Za-z0-9-]{4,30})$",
    sources: [`${GENERAL} Tawtheeq is Abu Dhabi's tenancy contract registration, offered through TAMM.`],
  },
  sharjah: {
    mode: "manual",
    portalName: "Sharjah Municipality attestation (Smart Services / Tasheel)",
    portalUrl: "https://www.shjmun.gov.ae",
    instructions:
      "Attest the tenancy contract with Sharjah City Municipality online or through a Tasheel centre. Pay the attestation fee, then record the attestation number and upload the certificate here.",
    requiredDocuments: MANUAL_DOCS,
    referenceExample: "ATT-2026-123456",
    referencePattern: "^[A-Za-z0-9/-]{4,30}$",
    sources: [`${GENERAL} Sharjah attestation fee is about 4% of annual rent; the contract may be attested online.`],
  },
  ajman: {
    mode: "manual",
    portalName: "Tasdeeq (Ajman Municipality & Planning Department)",
    portalUrl: null,
    instructions:
      "Register the tenancy contract through Tasdeeq with the Ajman Municipality and Planning Department. Record the Tasdeeq number and upload the certificate here.",
    requiredDocuments: MANUAL_DOCS,
    referenceExample: "TSD-2026-123456",
    referencePattern: "^[A-Za-z0-9/-]{4,30}$",
    sources: [
      `${GENERAL} Ajman tenancy contracts are registered through Tasdeeq; check the portal for current documents.`,
    ],
  },
  ras_al_khaimah: {
    mode: "manual",
    portalName: "RAK Municipality tenancy registration",
    portalUrl: "https://www.rak.ae",
    instructions:
      "Register the tenancy contract with Ras Al Khaimah Municipality online or in person. The title deed must be available. Record the registration number and upload the certificate here.",
    requiredDocuments: MANUAL_DOCS,
    referenceExample: "RAK-2026-123456",
    referencePattern: "^[A-Za-z0-9/-]{4,30}$",
    sources: [`${GENERAL} RAK registration fee is AED 25 plus 5% of the lease value; the title deed is required.`],
  },
  fujairah: {
    mode: "manual",
    portalName: "Ejaar (Fujairah Municipality)",
    portalUrl: "https://www.fujmun.gov.ae",
    instructions:
      "Register the tenancy contract in Ejaar with Fujairah Municipality. Record the Ejaar number and upload the certificate here.",
    requiredDocuments: ["signed_contract", "kyc:emirates_id", "kyc:passport", "title_deed", "landlord_trade_licence"],
    referenceExample: "EJR-2026-123456",
    referencePattern: "^[A-Za-z0-9/-]{4,30}$",
    sources: [`${GENERAL} Fujairah uses Ejaar; documents: Emirates ID or passport, trade licence, title deed.`],
  },
  umm_al_quwain: {
    mode: "manual",
    portalName: "UAQ Municipality tenancy registration",
    portalUrl: null,
    instructions:
      "Register the tenancy contract in person at Umm Al Quwain Municipality. Pay the fee, then record the reference and upload the certificate here.",
    requiredDocuments: MANUAL_DOCS,
    referenceExample: "UAQ-2026-1234",
    referencePattern: "^[A-Za-z0-9/-]{3,30}$",
    sources: [`${GENERAL} UAQ charges about 2% of the rent plus a small service fee; registration is in person.`],
  },
};
