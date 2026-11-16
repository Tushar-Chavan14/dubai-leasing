import { z } from "zod";

/** What the helper could read from a registration certificate. Every field is optional: nothing is guessed. */
export const CertificateRead = z.object({
  reference: z.string().optional(),
  /** ISO calendar date (Asia/Dubai calendar day as printed). */
  issuedOn: z.string().optional(),
  propertyNo: z.string().optional(),
  unitNo: z.string().optional(),
  makaniNo: z.string().optional(),
  tenant: z.string().optional(),
  landlord: z.string().optional(),
  startOn: z.string().optional(),
  endOn: z.string().optional(),
  /** Integer fils (AED x 100). */
  annualRentFils: z.number().int().nonnegative().optional(),
  /** Integer fils: the registration or attestation fee printed on the certificate. */
  feePaidFils: z.number().int().nonnegative().optional(),
});
export type CertificateRead = z.infer<typeof CertificateRead>;

export type CertificateResult =
  | { status: "unreadable"; reason: string }
  | { status: "ok"; read: CertificateRead; source: "code" | "model"; modelFailed?: true };

/** The model's answer: the reference and issue date exactly as printed, or null. */
export const ModelCertificate = z.object({
  reference: z.string().trim().min(1).max(60).nullable(),
  issuedOn: z.string().trim().min(1).max(40).nullable(),
});
export type ModelCertificate = z.infer<typeof ModelCertificate>;
