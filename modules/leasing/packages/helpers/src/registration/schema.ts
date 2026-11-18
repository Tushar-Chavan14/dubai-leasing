import { EJARI_FIELDS, EjariAutofix, type EjariField, EjariPayload, EjariRejection } from "@leasing/core";
import { z } from "zod";

const Verified = z.object({ value: z.string(), source: z.string() });

/** What the Manager hands the Registration helper after Ejari rejected a submission. */
export const RegistrationContext = z.object({
  payload: EjariPayload,
  rejections: z.array(EjariRejection).min(1).max(20),
  /** 1 for the first submission under an approval, 2 after the one auto-fix. */
  attempt: z.number().int().min(1),
  /** Verified values for the name fields (KYC-verified tenant party, landlord party). */
  verified: z.object({ tenantNameEn: z.array(Verified), landlordNameEn: z.array(Verified) }),
  /** Below this decision-model confidence a rejection is not mapped to a field. From company policy. */
  minConfidence: z.number().min(0).max(1),
});
export type RegistrationContext = z.infer<typeof RegistrationContext>;

const Field = z.enum(EJARI_FIELDS as [EjariField, ...EjariField[]]);

export const RegistrationData = z.object({
  /** Which payload field each rejection is about, as the decision model read it (null = not sure). */
  mappings: z.array(
    z.object({
      code: z.string(),
      field: Field.nullable(),
      confidence: z.number().min(0).max(1),
      /** The registry's own field hint, when it gave a known one. */
      hint: Field.nullable(),
    }),
  ),
  /** resubmit = one typo-class fix covers every rejection; person = anything else. */
  decision: z.enum(["resubmit", "person"]),
  fixes: z.array(EjariAutofix),
});
export type RegistrationData = z.infer<typeof RegistrationData>;
