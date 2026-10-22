import { z } from "zod";
import { isCalendarDate } from "./dates.ts";

/**
 * What is sent to Ejari (step 6). Built only from the signed contract's fields, so what is
 * registered is what was signed. The mock and the future DLD adapter share this contract.
 */
const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");

export const EjariPayload = z.object({
  tenantNameEn: z.string().min(1),
  tenantIdType: z.enum(["emirates_id", "passport", "trade_licence"]),
  tenantIdNo: z.string().min(1),
  tenantIdExpiresOn: calDate.nullable(),
  tenantNationality: z.string().nullable(),
  landlordNameEn: z.string().min(1),
  landlordIdNo: z.string().nullable(),
  propertyUsage: z.enum(["residential", "commercial"]),
  dldPropertyNo: z.string().min(1),
  unitNo: z.string().min(1),
  makaniNo: z.string().min(1),
  plotNo: z.string().nullable(),
  startOn: calDate,
  endOn: calDate,
  annualRentFils: z.number().int().positive(),
  cheques: z.number().int().min(1).max(12),
  depositFils: z.number().int().min(0),
});
export type EjariPayload = z.infer<typeof EjariPayload>;
export type EjariField = keyof EjariPayload;
export const EJARI_FIELDS = Object.keys(EjariPayload.shape) as EjariField[];

/**
 * Fields the Registration helper may correct by itself, and only by a typo-class change (case,
 * spacing, punctuation, accents) taken from a verified source. Money, dates, ID numbers and
 * property numbers are never changed.
 */
export const EJARI_AUTOFIXABLE: readonly EjariField[] = Object.freeze(["tenantNameEn", "landlordNameEn"]);

export const EjariRejectionCode = z.enum([
  "PROPERTY_NOT_FOUND",
  "PROPERTY_DATA_MISMATCH",
  "LANDLORD_MISMATCH",
  "TENANT_NOT_FOUND",
  "NAME_MISMATCH",
  "ID_EXPIRED",
  "INVALID_ID",
  "ACTIVE_REGISTRATION_EXISTS",
  "INVALID_PERIOD",
  "INVALID_AMOUNT",
]);
export type EjariRejectionCode = z.infer<typeof EjariRejectionCode>;

/** A rejection as Ejari reports it. `field` is the registry's own hint and may be missing or vague. */
export const EjariRejection = z.object({
  code: z.string().max(80),
  field: z.string().max(80).nullable(),
  message: z.string().max(500),
});
export type EjariRejection = z.infer<typeof EjariRejection>;

/** A typo-class correction the Registration helper made before resubmitting once. */
export const EjariAutofix = z.object({
  field: z.enum(["tenantNameEn", "landlordNameEn"]),
  from: z.string(),
  to: z.string(),
  /** Where the corrected value comes from, e.g. "party:<id>:fullNameEn (title case)". */
  source: z.string(),
});
export type EjariAutofix = z.infer<typeof EjariAutofix>;
