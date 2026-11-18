import { z } from "zod";
import { CompanyCreateForm, CompanyLegalInput } from "@leasing/core";
import { type FieldErrors, zodFieldErrors } from "@platform/ui/field-errors";

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

/**
 * Zod issues into field errors. A problem inside the fee list (its rows have a `name` of their own, which must not land
 * on the company's name field) becomes one message on the list: "Fee 2: enter the fee name".
 */
function legalFieldErrors(error: z.ZodError): FieldErrors {
  const inFees = (i: z.core.$ZodIssue) => i.path.includes("contractFees");
  const out = zodFieldErrors(new z.ZodError(error.issues.filter((i) => !inFees(i))));
  const first = error.issues.find(inFees);
  if (first) {
    const row = first.path.find((p) => typeof p === "number");
    const msg = first.message.charAt(0).toUpperCase() + first.message.slice(1);
    out.contractFees = row === undefined ? msg : `Fee ${Number(row) + 1}: ${msg}`;
  }
  return out;
}

/** Blank text becomes null; the engine's Zod schema does the real validation and returns field errors. */
export function legalBody(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of LEGAL_TEXT_FIELDS) {
    const v = String(formData.get(k) ?? "").trim();
    out[k] = v === "" ? null : v;
  }
  // The fee list editor keeps its rows as JSON (amounts already in fils); bad JSON goes on for the Zod check to refuse.
  const raw = String(formData.get("contractFees") ?? "").trim();
  if (raw === "") out.contractFees = null;
  else {
    try {
      out.contractFees = JSON.parse(raw) as never;
    } catch {
      out.contractFees = raw;
    }
  }
  return out;
}

/** The ID number is shown in full only to roles that work with leases; the engine already masks it for finance. */
export function showsIdNumber(role: string | undefined): boolean {
  return role === "admin" || role === "leasing_manager" || role === "leasing_officer";
}

/** The engine's own Zod check, run in the browser before "Add company" is sent. */
export function validateCompanyCreate(formData: FormData): FieldErrors | null {
  const r = CompanyCreateForm.safeParse({
    name: String(formData.get("name") ?? ""),
    kind: String(formData.get("kind") ?? ""),
    legal: legalBody(formData),
  });
  const errors = r.success ? {} : legalFieldErrors(r.error);
  if (formData.getAll("emirates").length === 0) errors.emirates = "Pick at least one emirate.";
  if (formData.getAll("categories").length === 0) errors.categories = "Pick at least one property type.";
  return Object.keys(errors).length ? errors : null;
}

/** The engine's own Zod check, run in the browser before the legal details are saved. */
export function validateCompanyLegal(formData: FormData): FieldErrors | null {
  const r = CompanyLegalInput.safeParse(legalBody(formData));
  return r.success ? null : legalFieldErrors(r.error);
}
