import { z } from "zod";

/**
 * The simulated Oqood and trustee registry's contract (C27, S53). What a submission carries, what a rejection looks
 * like and how numbers are written. The real registry's adapter will speak the same shapes. Payloads are built from
 * the deal's own records by code (no model). Registry numbers are plain facts a registry issued: never a legal value
 * computed here.
 */
export const REGISTRY_KINDS = ["oqood_register", "oqood_transfer", "trustee_transfer"] as const;
export const RegistryKind = z.enum(REGISTRY_KINDS);
export type RegistryKind = z.infer<typeof RegistryKind>;

export const REGISTRY_REJECTION_CODES = [
  "BUYER_NAME_MISMATCH",
  "UNIT_NOT_FOUND",
  "UNIT_ALREADY_REGISTERED",
  "SELLER_NOT_OWNER",
  "NOC_MISSING",
  "INVALID_ID",
  "SERVICE_CHARGES_OUTSTANDING",
] as const;
export const RegistryRejectionCode = z.enum(REGISTRY_REJECTION_CODES);
export type RegistryRejectionCode = z.infer<typeof RegistryRejectionCode>;

export const RegistryRejection = z.object({
  code: RegistryRejectionCode,
  /** The field at fault; a registry doesn't always name it. */
  field: z.string().nullable(),
  message: z.string(),
});
export type RegistryRejection = z.infer<typeof RegistryRejection>;

/** The gates that submit to the registry, per kind: the approval a submission must carry. */
export const REGISTRY_GATE_OF_KIND = {
  oqood_register: "oqood_submission",
  oqood_transfer: "transfer_submission",
  trustee_transfer: "transfer_submission",
} as const satisfies Record<RegistryKind, "oqood_submission" | "transfer_submission">;

const Name = z.string().trim().min(1).max(300);
const Buyer = z.object({ name: Name, idNo: z.string().trim().min(1).max(60) });
const Seller = z.object({ name: Name });
const Unit = z.string().trim().min(1).max(60);
const Project = z.string().trim().min(1).max(60).nullable();
const Fils = z.number().int().positive();

/** Primary off-plan: the developer sells a unit to the buyers (Oqood registration). */
export const OqoodRegisterPayload = z.object({
  unitNo: Unit,
  projectCode: Project,
  developerName: Name,
  buyers: z.array(Buyer).min(1),
  priceFils: Fils,
});
export type OqoodRegisterPayload = z.infer<typeof OqoodRegisterPayload>;

/** Off-plan resale: the Oqood record moves from the sellers to the buyers (needs the developer's NOC). */
export const OqoodTransferPayload = z.object({
  unitNo: Unit,
  projectCode: Project,
  sellers: z.array(Seller).min(1),
  buyers: z.array(Buyer).min(1),
  priceFils: Fils,
  /** A valid NOC is on the deal (the `nocOk` fact). */
  nocPresent: z.boolean(),
  serviceChargesCleared: z.boolean(),
});
export type OqoodTransferPayload = z.infer<typeof OqoodTransferPayload>;

/** Ready resale: the trustee office re-issues the title deed to the buyers. */
export const TrusteeTransferPayload = OqoodTransferPayload.extend({ titleDeedNo: z.string().trim().min(1).max(60) });
export type TrusteeTransferPayload = z.infer<typeof TrusteeTransferPayload>;

/** `SIM-OQD-2026-0000001` (registration), `SIM-TRF-…` (transfer or trustee booking) and `SIM-TD-…` (new title deed). */
export const REGISTRY_NO = /^SIM-(OQD|TRF|TD)-\d{4}-\d{7}$/;

/** A registry answer: a number issued on a calendar date, or the reasons it refused. */
export type RegistryResult = { ok: true; no: string; issuedOn: string } | { ok: false; reasons: RegistryRejection[] };

/** The registry could not be reached or answered 5xx: nothing is registered, retry later (never a rejection). */
export class RegistryUnavailableError extends Error {
  override readonly name = "RegistryUnavailableError";
}

/**
 * The fields a registry rejection can be about (S56). Only the two name fields can ever be corrected by code, and only
 * by case or spacing against the KYC-verified name; every other field goes to a person.
 */
export const REGISTRY_FIELDS = [
  "buyer_name",
  "seller_name",
  "buyer_id",
  "unit",
  "ownership",
  "noc",
  "service_charges",
  "price",
] as const;
export type RegistryField = (typeof REGISTRY_FIELDS)[number];
/** The two fields the one safe fix may touch. */
export const REGISTRY_NAME_FIELDS: readonly RegistryField[] = ["buyer_name", "seller_name"];

/** What each code the registry gives is about. A code in this table is never sent to a model. */
export const REGISTRY_FIELD_OF_CODE: Readonly<Record<RegistryRejectionCode, RegistryField>> = Object.freeze({
  BUYER_NAME_MISMATCH: "buyer_name",
  UNIT_NOT_FOUND: "unit",
  UNIT_ALREADY_REGISTERED: "unit",
  SELLER_NOT_OWNER: "ownership",
  NOC_MISSING: "noc",
  INVALID_ID: "buyer_id",
  SERVICE_CHARGES_OUTSTANDING: "service_charges",
});
