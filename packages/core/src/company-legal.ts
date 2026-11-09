import { z } from "zod";

/**
 * Legal (landlord) details of a company (D44). Shared by the engine (the real check) and the web forms (the same check
 * before submit, so staff see field errors without a round trip). Messages are lower-case; the web capitalises them.
 * Clock checks (expiry in the future) need `Clock` and run in the engine only.
 */

const text = (max: number) =>
  z.string({ error: "required" }).trim().min(1, "required").max(max, `use at most ${max} characters`);
const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `use at most ${max} characters`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : null));
const calendarDate = z.string({ error: "required" }).regex(/^\d{4}-\d{2}-\d{2}$/, "use a date like 2027-03-31");
const optDate = calendarDate
  .nullable()
  .optional()
  .transform((v) => v ?? null);
const email = z
  .string({ error: "required" })
  .trim()
  .min(1, "required")
  .email("enter an email like name@company.ae")
  .max(200, "use at most 200 characters");
const EID_FORMAT = /^784-\d{4}-\d{7}-\d$/;

/** The ID number format can be checked once the kind is valid and a number was entered. */
function idCheckable(p: { value: unknown }): boolean {
  const v = p.value as { signatoryIdKind?: unknown; signatoryIdNo?: unknown } | null;
  return (
    (v?.signatoryIdKind === "emirates_id" || v?.signatoryIdKind === "passport") &&
    typeof v.signatoryIdNo === "string" &&
    v.signatoryIdNo.trim() !== ""
  );
}

export const CompanyLegalInput = z
  .object({
    legalNameEn: text(200),
    legalNameAr: optText(200),
    tradeLicenceNo: text(60),
    tradeLicenceAuthority: text(120),
    tradeLicenceExpiresOn: calendarDate,
    reraOrn: optText(60),
    registeredAddress: text(400),
    email,
    phone: optText(40),
    chequePayeeName: optText(200),
    signatoryName: text(200),
    signatoryTitle: text(120),
    signatoryEmail: email,
    signatoryIdKind: z.enum(["emirates_id", "passport"], { error: "choose Emirates ID or passport" }),
    signatoryIdNo: text(40),
    signatoryIdExpiresOn: optDate,
  })
  // `when`: run even if other fields failed, so the form shows every problem at once (not only after the rest is fixed).
  .refine((v) => v.signatoryIdKind !== "emirates_id" || EID_FORMAT.test(v.signatoryIdNo), {
    path: ["signatoryIdNo"],
    message: "use the format 784-YYYY-NNNNNNN-N",
    when: idCheckable,
  })
  .refine((v) => v.signatoryIdKind !== "passport" || /^[A-Za-z0-9]{6,12}$/.test(v.signatoryIdNo), {
    path: ["signatoryIdNo"],
    message: "enter the passport number (6 to 12 letters or digits)",
    when: idCheckable,
  });
export type CompanyLegalInput = z.infer<typeof CompanyLegalInput>;

/** The staff "Add company" form: name and kind, plus the legal record (D44). */
export const CompanyCreateForm = z.object({
  name: z.string().trim().min(1, "enter the company name").max(120, "use at most 120 characters"),
  kind: z.enum(["developer", "realty", "owner"], { error: "choose a kind" }),
  legal: CompanyLegalInput,
});
