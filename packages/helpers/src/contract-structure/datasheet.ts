import { FIELD_CATALOGUE, type FieldInfo, type FieldType } from "./fields.ts";
import { formatCalendarDate } from "./format.ts";

/**
 * The data sheet: every value the system holds for a contract, as `key -> description + type`. The keys are
 * generated from the records (lease, unit, company, landlord and tenant party, application) and cover the contract
 * fields; the tenant party's identity is the KYC-verified one (verification copies it onto the party). Mapping a
 * template blank to a key sees only this list (never a value). The value is copied verbatim from the record at
 * prepare time. Nothing here is a legal or money decision.
 */

type Role = "landlord" | "tenant";
const ROLES: Role[] = ["landlord", "tenant"];
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Party columns: [column, words for the description, type]. */
const PARTY_COLUMNS: [string, string, FieldType][] = [
  ["birthDate", "date of birth", "date"],
  ["emiratesIdNo", "Emirates ID number", "text"],
  ["idExpiresOn", "ID expiry date", "date"],
  ["passportNo", "passport number", "text"],
  ["passportExpiresOn", "passport expiry date", "date"],
  ["visaNo", "residence visa number", "text"],
  ["visaExpiresOn", "residence visa expiry date", "date"],
  ["tradeLicenceNo", "trade licence number", "text"],
  ["tradeLicenceExpiresOn", "trade licence expiry date", "date"],
];

/** Unit columns: [key, column, description, type]. */
const UNIT_COLUMNS: [string, string, string, FieldType][] = [
  ["unitCode", "code", "Unit code (the company's short code)", "text"],
  ["dewaPremiseNo", "dewaPremiseNo", "DEWA premises number", "text"],
  ["areaSqft", "areaSqft", "Property area in square feet", "int"],
  ["bathrooms", "bathrooms", "Number of bathrooms", "int"],
  ["floor", "floor", "Floor number", "int"],
  ["parkingSpaces", "parkingSpaces", "Number of parking spaces", "int"],
  ["furnishing", "furnished", "Furnished or unfurnished", "text"],
  ["propertySubtype", "subtype", "Property type (apartment, villa, office ...)", "text"],
  ["emirate", "emirate", "Emirate", "text"],
];

const COMPANY_COLUMNS: [string, string, string][] = [
  ["companyName", "name", "Leasing company name"],
  ["companyTradeLicenceNo", "tradeLicenceNo", "Leasing company trade licence number"],
  ["companyEmail", "email", "Leasing company email"],
];

interface Extra {
  type: FieldType;
  label: string;
  /** Where the value is read from. */
  read: (r: SheetRecords) => unknown;
}

const EXTRAS: Record<string, Extra> = {};
for (const role of ROLES) {
  for (const [col, words, type] of PARTY_COLUMNS) {
    const key = `${role}${cap(col)}`;
    if (Object.hasOwn(FIELD_CATALOGUE, key)) continue;
    EXTRAS[key] = { type, label: `${cap(role)} ${words}`, read: (r) => r[role]?.[col] };
  }
}
for (const [key, col, label, type] of UNIT_COLUMNS) EXTRAS[key] = { type, label, read: (r) => r.unit?.[col] };
for (const [key, col, label] of COMPANY_COLUMNS) {
  EXTRAS[key] = { type: "text", label, read: (r) => r.company?.[col] };
}
// The company is the landlord (D44): `landlord` is its legal party (name EN, trade licence, email, phone), `company` its row
// (address, issuing authority, RERA ORN, cheque payee and the authorised signatory who signs for it).
EXTRAS.landlordNameAr = { type: "text", label: "Landlord legal name in Arabic", read: (r) => r.landlord?.fullNameAr };
const LANDLORD_COMPANY_COLUMNS: [string, string, string, FieldType][] = [
  ["landlordAddress", "registeredAddress", "Landlord registered address", "text"],
  ["landlordTradeLicenceAuthority", "tradeLicenceAuthority", "Landlord trade licence issuing authority", "text"],
  ["landlordReraOrn", "reraOrn", "Landlord RERA ORN or developer number", "text"],
  ["chequePayeeName", "chequePayeeName", "Payee name on the post-dated cheques", "text"],
  ["signatoryName", "signatoryName", "Landlord's authorised signatory name", "text"],
  ["signatoryTitle", "signatoryTitle", "Landlord's authorised signatory job title", "text"],
  ["signatoryEmail", "signatoryEmail", "Landlord's authorised signatory email", "text"],
  ["signatoryIdNo", "signatoryIdNo", "Authorised signatory Emirates ID or passport number", "text"],
  ["signatoryIdExpiresOn", "signatoryIdExpiresOn", "Authorised signatory ID expiry date", "date"],
];
for (const [key, col, label, type] of LANDLORD_COMPANY_COLUMNS) {
  EXTRAS[key] = { type, label, read: (r) => r.company?.[col] };
}
EXTRAS.tenancyPeriod = {
  type: "text",
  label: "Tenancy period (start date to end date)",
  read: (r) => {
    const s = r.lease && typeof r.lease.startOn === "string" ? formatCalendarDate(r.lease.startOn) : null;
    const e = r.lease && typeof r.lease.endOn === "string" ? formatCalendarDate(r.lease.endOn) : null;
    return s && e ? `${s} to ${e}` : null;
  },
};
EXTRAS.applicationRef = { type: "text", label: "Application reference", read: (r) => r.application?.ref };
EXTRAS.reservationFils = {
  type: "money_fils",
  label: "Reservation amount",
  read: (r) => r.application?.reservationFils,
};

/** Every key a blank may map to: the contract fields and the generated extras. */
export const SHEET_KEYS: Record<string, FieldInfo> = {
  ...FIELD_CATALOGUE,
  ...Object.fromEntries(Object.entries(EXTRAS).map(([k, v]) => [k, { type: v.type, label: v.label }])),
};
export const SHEET_KEY_NAMES = Object.keys(SHEET_KEYS);
export const isSheetKey = (s: string): boolean => Object.hasOwn(SHEET_KEYS, s);
export const sheetKeyInfo = (k: string): FieldInfo | null => (isSheetKey(k) ? SHEET_KEYS[k]! : null);

/** `key | type | description`, one per line: the only thing a model sees of the data sheet (no values). */
export const sheetForPrompt = (): string =>
  SHEET_KEY_NAMES.map((n) => `${n} | ${SHEET_KEYS[n]!.type} | ${SHEET_KEYS[n]!.label}`).join("\n");

/** Plain records the extras are read from (rows as stored; unknown columns are ignored). */
export interface SheetRecords {
  lease?: Record<string, unknown> | undefined;
  unit?: Record<string, unknown> | undefined;
  company?: Record<string, unknown> | null | undefined;
  landlord?: Record<string, unknown> | undefined;
  tenant?: Record<string, unknown> | undefined;
  application?: Record<string, unknown> | null | undefined;
}

/** Values of the generated extras, copied verbatim from the records (null when the record has none). */
export function sheetExtras(r: SheetRecords): Record<string, string | number | null> {
  const out: Record<string, string | number | null> = {};
  for (const [k, e] of Object.entries(EXTRAS)) {
    const v = e.read(r);
    if (typeof v === "boolean") out[k] = v ? "Furnished" : "Unfurnished";
    else if (typeof v === "number" || (typeof v === "string" && v.trim() !== "")) out[k] = v;
    else out[k] = null;
  }
  return out;
}
