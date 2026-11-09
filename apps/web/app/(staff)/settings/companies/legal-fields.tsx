import { Block, GRID6, SET_INPUT, SET_SELECT, SField, SPAN } from "../../../../components/ui/settings";
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
  errorLabel,
}: {
  name: keyof Legal;
  label: string;
  value: string | null | undefined;
  errors: Errors;
  type?: string;
  span?: 3 | 6;
  hint?: string;
  readOnly?: boolean;
  /** The field's name in the error banner, when the label alone is ambiguous ("Email" twice). */
  errorLabel?: string;
}) {
  const err = errors?.[name];
  return (
    <SField label={label} help={hint} error={err} className={SPAN[span]}>
      <input
        name={name}
        type={type}
        defaultValue={value ?? ""}
        maxLength={400}
        readOnly={readOnly}
        data-label={errorLabel}
        className={SET_INPUT}
        {...(err ? { "aria-invalid": true } : {})}
      />
    </SField>
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
      <Block
        title="Legal (landlord) details"
        lede="The company signs leases as the landlord. These details go into contracts and Ejari."
      >
        <div className={GRID6}>
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
          <Field
            name="email"
            label="Email"
            type="email"
            value={legal.email}
            errors={errors}
            errorLabel="Company email"
          />
          <Field name="phone" label="Phone (optional)" value={legal.phone} errors={errors} />
          <Field
            name="chequePayeeName"
            label="Cheque payee name (optional)"
            value={legal.chequePayeeName}
            errors={errors}
            span={6}
          />
        </div>
      </Block>
      <Block title="Authorised signatory" lede="Signs contracts for the company. The signing link goes to this email.">
        <div className={GRID6}>
          <Field
            name="signatoryName"
            label="Name"
            value={legal.signatoryName}
            errors={errors}
            errorLabel="Signatory name"
          />
          <Field
            name="signatoryTitle"
            label="Title"
            value={legal.signatoryTitle}
            errors={errors}
            errorLabel="Signatory title"
          />
          <Field
            name="signatoryEmail"
            label="Email"
            type="email"
            value={legal.signatoryEmail}
            errors={errors}
            errorLabel="Signatory email"
          />
          <SField label="ID type" className={SPAN[3]}>
            <select name="signatoryIdKind" defaultValue={legal.signatoryIdKind ?? "emirates_id"} className={SET_SELECT}>
              <option value="emirates_id">Emirates ID</option>
              <option value="passport">Passport</option>
            </select>
          </SField>
          <Field
            name="signatoryIdNo"
            label="ID number"
            value={legal.signatoryIdNo}
            errors={errors}
            hint="Emirates ID: 784-YYYY-NNNNNNN-N"
            readOnly={!!maskedId}
            errorLabel="Signatory ID number"
          />
          <Field
            name="signatoryIdExpiresOn"
            label="ID expiry (optional)"
            errorLabel="Signatory ID expiry"
            type="date"
            value={legal.signatoryIdExpiresOn}
            errors={errors}
          />
        </div>
      </Block>
    </>
  );
}
