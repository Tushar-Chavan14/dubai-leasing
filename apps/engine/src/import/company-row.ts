import { z } from "zod";
import { PropertyCategory } from "@leasing/core";
import { opt } from "./lease-row.ts";

const EID_FORMAT = /^784-\d{4}-\d{7}-\d$/;

/** One row of the companies import CSV. Column names are documented in docs/import.md. */
export const CompanyImportRow = z.object({
  name: z.string().trim().min(2).max(200),
  slug: opt.pipe(
    z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "letters, digits and single dashes")
      .max(40)
      .nullable(),
  ),
  kind: opt.transform((v) => v?.toLowerCase() ?? null).pipe(z.enum(["developer", "realty", "owner"]).nullable()),
  /** Checked, not stored: companies have no category column; categories come from their units and rent rules. */
  categories: opt
    .transform((v) =>
      v
        ? v
            .split(/[,;|]/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean)
        : [],
    )
    .pipe(z.array(PropertyCategory)),
  legal_name_en: opt,
  legal_name_ar: opt,
  trade_licence_no: opt,
  licence_authority: opt,
  trade_licence_expires_on: opt,
  rera_orn: opt,
  registered_address: opt,
  email: opt,
  phone: opt,
  cheque_payee: opt,
  signatory_name: opt,
  signatory_title: opt,
  signatory_email: opt,
  signatory_id_no: opt,
  signatory_id_expires_on: opt,
});
export type CompanyImportRow = z.infer<typeof CompanyImportRow>;

/** CSV column → `CompanyLegalInput` key, for the legal fields a row may carry. */
export const LEGAL_COLUMNS = {
  legal_name_en: "legalNameEn",
  legal_name_ar: "legalNameAr",
  trade_licence_no: "tradeLicenceNo",
  licence_authority: "tradeLicenceAuthority",
  trade_licence_expires_on: "tradeLicenceExpiresOn",
  rera_orn: "reraOrn",
  registered_address: "registeredAddress",
  email: "email",
  phone: "phone",
  cheque_payee: "chequePayeeName",
  signatory_name: "signatoryName",
  signatory_title: "signatoryTitle",
  signatory_email: "signatoryEmail",
  signatory_id_no: "signatoryIdNo",
  signatory_id_expires_on: "signatoryIdExpiresOn",
} as const satisfies Partial<Record<keyof CompanyImportRow, string>>;

/** The legal fields the row provides (non-empty), keyed for `CompanyLegalInput`. */
export function providedLegal(r: CompanyImportRow): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [col, key] of Object.entries(LEGAL_COLUMNS)) {
    const v = r[col as keyof typeof LEGAL_COLUMNS];
    if (v) out[key] = v;
  }
  // Emirates ID if it has that shape, else a passport number; `CompanyLegalInput` checks the format.
  if (out.signatoryIdNo) out.signatoryIdKind = EID_FORMAT.test(out.signatoryIdNo) ? "emirates_id" : "passport";
  return out;
}

/** `CompanyLegalInput` key → CSV column, for error messages. */
export const COLUMN_OF: Record<string, string> = {
  ...Object.fromEntries(Object.entries(LEGAL_COLUMNS).map(([col, key]) => [key, col])),
  signatoryIdKind: "signatory_id_no",
};
