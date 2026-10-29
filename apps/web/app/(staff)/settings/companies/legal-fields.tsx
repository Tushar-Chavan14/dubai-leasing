import type { CompanyLegalView } from "../../../../lib/types";

type Legal = CompanyLegalView["legal"];
type Errors = Record<string, string> | undefined;

function Field({
  name,
  label,
  value,
  errors,
  type = "text",
  span = 3,
  hint,
  readOnly,
}: {
  name: keyof Legal;
  label: string;
  value: string | null | undefined;
  errors: Errors;
  type?: string;
  span?: 3 | 6;
  hint?: string;
  readOnly?: boolean;
}) {
  const err = errors?.[name];
  return (
    <label className={`field span-${span}`}>
      <span className="field-label">{label}</span>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        maxLength={400}
        readOnly={readOnly}
        {...(err ? { "aria-invalid": true } : {})}
      />
      {hint && !err && <span className="hint">{hint}</span>}
      {err && <span className="err">{err}</span>}
    </label>
  );
}

/** Sections "Legal (landlord) details" and "Authorised signatory". Section "Company" is the caller's. */
export function LegalFields({
  legal,
  errors,
  maskedId,
}: {
  legal: Partial<Legal>;
  errors: Errors;
  /** The ID number is masked for this role: show it read-only and keep the stored value on save. */
  maskedId?: boolean;
}) {
  return (
    <>
      <h3 className="section-title">Legal (landlord) details</h3>
      <p className="muted">The company signs leases as the landlord. These details go into contracts and Ejari.</p>
      <div className="grid-fields">
        <Field name="legalNameEn" label="Legal name (English)" value={legal.legalNameEn} errors={errors} />
        <Field name="legalNameAr" label="Legal name (Arabic)" value={legal.legalNameAr} errors={errors} />
        <Field name="tradeLicenceNo" label="Trade licence number" value={legal.tradeLicenceNo} errors={errors} />
        <Field
          name="tradeLicenceAuthority"
          label="Licence issuing authority"
          value={legal.tradeLicenceAuthority}
          errors={errors}
        />
        <Field
          name="tradeLicenceExpiresOn"
          label="Trade licence expiry"
          type="date"
          value={legal.tradeLicenceExpiresOn}
          errors={errors}
        />
        <Field name="reraOrn" label="RERA ORN / developer number (optional)" value={legal.reraOrn} errors={errors} />
        <Field
          name="registeredAddress"
          label="Registered address"
          value={legal.registeredAddress}
          errors={errors}
          span={6}
        />
        <Field name="email" label="Email" type="email" value={legal.email} errors={errors} />
        <Field name="phone" label="Phone (optional)" value={legal.phone} errors={errors} />
        <Field
          name="chequePayeeName"
          label="Cheque payee name (optional)"
          value={legal.chequePayeeName}
          errors={errors}
          span={6}
        />
      </div>
      <h3 className="section-title">Authorised signatory</h3>
      <p className="muted">Signs contracts for the company. The signing link goes to this email.</p>
      <div className="grid-fields">
        <Field name="signatoryName" label="Name" value={legal.signatoryName} errors={errors} />
        <Field name="signatoryTitle" label="Title" value={legal.signatoryTitle} errors={errors} />
        <Field name="signatoryEmail" label="Email" type="email" value={legal.signatoryEmail} errors={errors} />
        <label className="field span-3">
          <span className="field-label">ID type</span>
          <select name="signatoryIdKind" defaultValue={legal.signatoryIdKind ?? "emirates_id"}>
            <option value="emirates_id">Emirates ID</option>
            <option value="passport">Passport</option>
          </select>
        </label>
        <Field
          name="signatoryIdNo"
          label="ID number"
          value={legal.signatoryIdNo}
          errors={errors}
          hint="Emirates ID: 784-YYYY-NNNNNNN-N"
          readOnly={!!maskedId}
        />
        <Field
          name="signatoryIdExpiresOn"
          label="ID expiry (optional)"
          type="date"
          value={legal.signatoryIdExpiresOn}
          errors={errors}
        />
      </div>
    </>
  );
}
