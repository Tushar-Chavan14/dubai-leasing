/** Legal (landlord) details of a company (D44): form fields, the engine body and the masked ID display. */

export const LEGAL_TEXT_FIELDS = [
  "legalNameEn",
  "legalNameAr",
  "tradeLicenceNo",
  "tradeLicenceAuthority",
  "tradeLicenceExpiresOn",
  "reraOrn",
  "registeredAddress",
  "email",
  "phone",
  "chequePayeeName",
  "signatoryName",
  "signatoryTitle",
  "signatoryEmail",
  "signatoryIdKind",
  "signatoryIdNo",
  "signatoryIdExpiresOn",
] as const;

/** Blank text becomes null; the engine's Zod schema does the real validation and returns field errors. */
export function legalBody(formData: FormData): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const k of LEGAL_TEXT_FIELDS) {
    const v = String(formData.get(k) ?? "").trim();
    out[k] = v === "" ? null : v;
  }
  return out;
}

/** The ID number is shown in full only to roles that work with leases; the engine already masks it for finance. */
export function showsIdNumber(role: string | undefined): boolean {
  return role === "admin" || role === "leasing_manager" || role === "leasing_officer";
}
