import { isCalendarDate } from "@leasing/core";
import { z } from "zod";

export const DocKind = z.enum(["emirates_id", "passport", "visa", "trade_licence"]);
export type DocKind = z.infer<typeof DocKind>;

const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");

/** What the Manager hands the KYC helper. Images are read through the injected `readImage`. */
export const KycContext = z.object({
  applicant: z.object({ nameEn: z.string().min(1), kind: z.enum(["individual", "company"]) }),
  /** Planned lease start: IDs must stay valid past it. */
  leaseStartOn: calDate,
  today: calDate,
  minValidityDays: z.number().int().min(0),
  minConfidence: z.number().min(0).max(1),
  documents: z
    .array(z.object({ docId: z.string(), kind: DocKind, side: z.enum(["front", "back", "page"]) }))
    .min(1)
    .max(10),
});
export type KycContext = z.infer<typeof KycContext>;

/** One field as the vision model read it, with its own confidence (not a probability of being right). */
export const ReadField = z.object({
  value: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});
export type ReadField = z.infer<typeof ReadField>;

const f = ReadField.describe("value exactly as printed (null if not visible) and your confidence 0–1");

/** What the vision model must return per document kind. Dates as printed (e.g. 07/03/1991). */
export const VisionRead = {
  emirates_id_front: z.object({
    documentType: z.enum([
      "identity_card_front",
      "identity_card_back",
      "passport",
      "residence_visa",
      "trade_licence",
      "other",
    ]),
    idNumber: f,
    name: f,
    nationality: f,
    birthDate: f,
    sex: f,
    expiryDate: f,
  }),
  emirates_id_back: z.object({
    documentType: z.enum([
      "identity_card_front",
      "identity_card_back",
      "passport",
      "residence_visa",
      "trade_licence",
      "other",
    ]),
    cardNumber: f,
    employer: f,
  }),
  passport: z.object({
    documentType: z.enum([
      "identity_card_front",
      "identity_card_back",
      "passport",
      "residence_visa",
      "trade_licence",
      "other",
    ]),
    passportNo: f,
    surname: f,
    givenNames: f,
    nationality: f,
    birthDate: f,
    sex: f,
    expiryDate: f,
    mrzLine1: f,
    mrzLine2: f,
  }),
  visa: z.object({
    documentType: z.enum([
      "identity_card_front",
      "identity_card_back",
      "passport",
      "residence_visa",
      "trade_licence",
      "other",
    ]),
    visaNo: f,
    name: f,
    passportNo: f,
    nationality: f,
    expiryDate: f,
  }),
  trade_licence: z.object({
    documentType: z.enum([
      "identity_card_front",
      "identity_card_back",
      "passport",
      "residence_visa",
      "trade_licence",
      "other",
    ]),
    licenceNo: f,
    tradeName: f,
    managerName: f,
    expiryDate: f,
  }),
} as const;
export type ReadKey = keyof typeof VisionRead;
export type DocRead = {
  docId: string;
  kind: DocKind;
  side: "front" | "back" | "page";
  read: Record<string, unknown> | null;
  error?: string;
};

export const readKeyOf = (kind: DocKind, side: string): ReadKey =>
  kind === "emirates_id" ? (side === "back" ? "emirates_id_back" : "emirates_id_front") : kind;

export const FlagKind = z.enum([
  "missing_document",
  "unreadable",
  "manual_review",
  "wrong_document",
  "low_confidence",
  "invalid_id_number",
  "id_birth_year_mismatch",
  "mrz_invalid",
  "mrz_mismatch",
  "number_mismatch",
  "invalid_date",
  "expired",
  "expires_too_soon",
  "name_mismatch",
  "applicant_name_mismatch",
  /** Set by the Manager, not the helper: this Emirates ID already belongs to another party. */
  "id_on_file",
]);
export type FlagKind = z.infer<typeof FlagKind>;

export const KycFlag = z.object({
  kind: FlagKind,
  message: z.string(),
  docId: z.string().nullable(),
  /** A blocking flag can't be approved past (an expired document). */
  blocking: z.boolean(),
});
export type KycFlag = z.infer<typeof KycFlag>;

/** The verified identity: every value copied from a document read (MRZ first), never retyped. */
export const KycIdentity = z.object({
  fullNameEn: z.string().nullable(),
  nationality: z.string().nullable(),
  birthDate: calDate.nullable(),
  emiratesIdNo: z.string().nullable(),
  idExpiresOn: calDate.nullable(),
  passportNo: z.string().nullable(),
  passportExpiresOn: calDate.nullable(),
  visaNo: z.string().nullable(),
  visaExpiresOn: calDate.nullable(),
  companyName: z.string().nullable(),
  tradeLicenceNo: z.string().nullable(),
  tradeLicenceExpiresOn: calDate.nullable(),
});
export type KycIdentity = z.infer<typeof KycIdentity>;

export const KycData = z.object({
  verdict: z.enum(["verified", "review"]),
  identity: KycIdentity,
  /** Where each identity value came from. */
  sources: z.record(z.string(), z.object({ docId: z.string(), via: z.enum(["mrz", "printed"]) })),
  checks: z.array(z.object({ check: z.string(), status: z.enum(["pass", "flag"]), docId: z.string().nullable() })),
  flags: z.array(KycFlag),
});
export type KycData = z.infer<typeof KycData>;
