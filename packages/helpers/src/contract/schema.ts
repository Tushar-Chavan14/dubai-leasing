import { Addendum, AddendumFlag, ContractFields, FieldSource, isCalendarDate } from "@leasing/core";
import { z } from "zod";

const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");

/**
 * What the Manager hands the Contract helper: the records themselves, as stored. The helper copies
 * values from them; it never looks anything up or retypes a value.
 */
export const ContractContext = z.object({
  lease: z.object({
    id: z.string(),
    ref: z.string(),
    startOn: calDate,
    endOn: calDate,
    annualRentFils: z.number().int(),
    cheques: z.number().int(),
    depositFils: z.number().int(),
  }),
  /** The accepted offer's extra terms (rent-free days, move-in), if the lease came from an application. */
  application: z
    .object({ id: z.string(), rentFreeDays: z.number().int().min(0), moveInOn: calDate, kycVerified: z.boolean() })
    .nullable(),
  tenant: z.object({
    id: z.string(),
    kind: z.enum(["individual", "company"]),
    fullNameEn: z.string(),
    nationality: z.string().nullable(),
    emiratesIdNo: z.string().nullable(),
    idExpiresOn: calDate.nullable(),
    passportNo: z.string().nullable(),
    passportExpiresOn: calDate.nullable(),
    visaNo: z.string().nullable(),
    tradeLicenceNo: z.string().nullable(),
    tradeLicenceExpiresOn: calDate.nullable(),
    email: z.string().nullable(),
    phone: z.string().nullable(),
  }),
  landlord: z.object({
    id: z.string(),
    kind: z.enum(["individual", "company"]),
    fullNameEn: z.string(),
    emiratesIdNo: z.string().nullable(),
    tradeLicenceNo: z.string().nullable(),
    email: z.string().nullable(),
    nationality: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
  }),
  unit: z.object({
    id: z.string(),
    kind: z.enum(["residential", "commercial"]),
    building: z.string(),
    community: z.string(),
    dldPropertyNo: z.string().nullable(),
    unitNo: z.string().nullable(),
    makaniNo: z.string().nullable(),
    plotNo: z.string().nullable(),
    bedrooms: z.number().int().nullable(),
  }),
  addendum: Addendum,
});
export type ContractContext = z.infer<typeof ContractContext>;

export const ContractData = z.object({
  fields: ContractFields,
  sources: z.record(z.string(), FieldSource),
  addendum: Addendum,
  /** Problems the review found in the free-text addendum, for the approver. Never edits the text. */
  flags: z.array(AddendumFlag),
  /** False when there was no free text to review. */
  reviewed: z.boolean(),
});
export type ContractData = z.infer<typeof ContractData>;

/** What the chat model must return for the addendum review. */
export const AddendumReview = z.object({ flags: z.array(AddendumFlag).max(20) });
export type AddendumReview = z.infer<typeof AddendumReview>;
