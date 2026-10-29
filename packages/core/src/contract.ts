import { z } from "zod";
import { isCalendarDate } from "./dates.ts";

/**
 * The tenancy contract (step 5). Every field is copied from a record (the KYC-verified tenant,
 * the landlord, the unit and the accepted offer) and keeps a pointer to where it came from. No
 * model writes or edits a field; a person approves the whole contract before anyone signs.
 */
const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");

export const ContractFields = z.object({
  leaseRef: z.string(),
  tenantKind: z.enum(["individual", "company"]),
  tenantNameEn: z.string().min(1),
  tenantNationality: z.string().nullable(),
  tenantEmiratesIdNo: z.string().nullable(),
  tenantIdExpiresOn: calDate.nullable(),
  tenantPassportNo: z.string().nullable(),
  tenantPassportExpiresOn: calDate.nullable(),
  tenantVisaNo: z.string().nullable(),
  tenantTradeLicenceNo: z.string().nullable(),
  tenantEmail: z.string().nullable(),
  tenantPhone: z.string().nullable(),
  landlordNameEn: z.string().min(1),
  landlordIdNo: z.string().nullable(),
  landlordEmail: z.string().nullable(),
  /** Optional so contracts stored before these existed still parse. */
  landlordNationality: z.string().nullable().optional(),
  landlordPhone: z.string().nullable().optional(),
  propertyUsage: z.enum(["residential", "commercial"]),
  building: z.string(),
  community: z.string(),
  dldPropertyNo: z.string().min(1),
  unitNo: z.string().min(1),
  makaniNo: z.string().min(1),
  plotNo: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  startOn: calDate,
  endOn: calDate,
  annualRentFils: z.number().int().positive(),
  cheques: z.number().int().min(1).max(12),
  depositFils: z.number().int().min(0),
  rentFreeDays: z.number().int().min(0),
  moveInOn: calDate,
  /** Date of the contract: today (Clock) when a company template is rendered; never stored on the contract. */
  contractOn: calDate.nullable().optional(),
});
export type ContractFields = z.infer<typeof ContractFields>;
export type ContractFieldName = keyof ContractFields;

/** Where a contract field was copied from: a column of a row. */
export const FieldSource = z.object({
  entity: z.enum(["party", "unit", "lease", "application"]),
  id: z.string(),
  column: z.string(),
});
export type FieldSource = z.infer<typeof FieldSource>;

/**
 * Standard addendum clauses (company wording, demo only). Staff pick from these; anything else
 * goes in the free text, which the chat model reviews for conflicts but never rewrites.
 * CONFIRM WITH LEGAL before a client uses this wording.
 */
export const ContractClauseId = z.enum(["maintenance", "no_pets", "no_subletting", "early_termination", "parking"]);
export type ContractClauseId = z.infer<typeof ContractClauseId>;

export const CONTRACT_CLAUSES: Readonly<Record<ContractClauseId, { title: string; text: string }>> = Object.freeze({
  maintenance: {
    title: "Minor maintenance",
    text: "The tenant pays for minor repairs up to AED 500 per item caused by ordinary use. The landlord pays for structural repairs and for repairs to the building's main systems.",
  },
  no_pets: {
    title: "Pets",
    text: "No pets may be kept in the unit without the landlord's written consent.",
  },
  no_subletting: {
    title: "Subletting",
    text: "The tenant may not sublet the unit or any part of it without the landlord's written consent.",
  },
  early_termination: {
    title: "Early termination",
    text: "The tenant may end the tenancy early by giving 60 days' written notice and paying an amount equal to two months' rent.",
  },
  parking: {
    title: "Parking",
    text: "One covered parking space is included with the unit for the term of the tenancy.",
  },
});

/** A company clause chosen for the addendum: `cc:<uuid>` of an approved `company_clauses` row. */
export const CompanyClauseRef = z.string().regex(/^cc:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
export type CompanyClauseRef = `cc:${string}`;
export const companyClauseRef = (id: string): CompanyClauseRef => `cc:${id}`;
export const isCompanyClauseRef = (v: string): v is CompanyClauseRef => CompanyClauseRef.safeParse(v).success;
export const companyClauseIdOf = (ref: CompanyClauseRef): string => ref.slice(3);

/** The wording of a company clause as printed, copied by the Manager from the approved row. */
export const CompanyClauseText = z.object({
  id: z.string(),
  title: z.string(),
  text: z.string(),
  /** Clause category from the sample review; the approval screen flags the legal ones. */
  category: z.string().optional(),
});
export type CompanyClauseText = z.infer<typeof CompanyClauseText>;

export const Addendum = z.object({
  clauses: z
    .array(z.union([ContractClauseId, CompanyClauseRef]) as z.ZodType<ContractClauseId | CompanyClauseRef>)
    .max(20),
  /** Staff-written extra terms. Untrusted text: reviewed by a model for conflicts, shown to the approver. */
  freeText: z.string().trim().max(4000).nullable(),
  /**
   * Wording of the `cc:` clauses above, filled in by the Manager from approved rows when the contract
   * is prepared (anything a client sends here is overwritten). Printed under "Additional terms (company)".
   */
  companyClauses: z.array(CompanyClauseText).max(20).optional(),
});
export type Addendum = z.infer<typeof Addendum>;

/** A problem the review found in the free-text addendum. Flags inform the approver; they never edit text. */
export const AddendumFlag = z.object({
  kind: z.enum(["conflict", "unclear", "illegal_term"]),
  /** The words in the addendum the flag is about, quoted. */
  quote: z.string().max(500),
  reason: z.string().max(500),
});
export type AddendumFlag = z.infer<typeof AddendumFlag>;

export const ContractStatus = z.enum(["pending_approval", "rejected", "sent", "signed", "superseded"]);
export type ContractStatus = z.infer<typeof ContractStatus>;

/** The signer's typed name, in the portal, as consent to sign. */
export const ContractSignature = z
  .object({
    typedName: z.string().trim().min(2).max(160),
    consent: z.literal(true),
  })
  .strict();
export type ContractSignature = z.infer<typeof ContractSignature>;
