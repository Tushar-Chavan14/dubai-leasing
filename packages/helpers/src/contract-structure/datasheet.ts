import {
  type CalendarDate,
  type ContractFee,
  EMIRATE_LABELS,
  Emirate,
  feesFor,
  type Instalment,
  parseContractFees,
  paymentSchedule,
  registrationFeeFor,
} from "@leasing/core";
import { FIELD_CATALOGUE, type FieldInfo, type FieldType } from "./fields.ts";
import { formatCalendarDate, formatMoneyFils } from "./format.ts";

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
  ["unitDescription", "description", "Unit description (as written on the unit record)", "text"],
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
/**
 * The lease's rent instalments from the same `paymentSchedule` that schedules rent collection (null when the lease
 * record lacks the term, rent or cheque count). Display only: the dates and amounts are computed by code.
 */
function leaseInstalments(r: SheetRecords): Instalment[] | null {
  const l = r.lease;
  if (!l || typeof l.startOn !== "string" || typeof l.endOn !== "string") return null;
  if (!Number.isInteger(l.annualRentFils) || !Number.isInteger(l.cheques)) return null;
  try {
    return paymentSchedule({
      startOn: l.startOn as CalendarDate,
      endOn: l.endOn as CalendarDate,
      annualRentFils: l.annualRentFils as number,
      cheques: l.cheques as number,
    });
  } catch {
    return null;
  }
}
EXTRAS.chequeAmountFils = {
  type: "money_fils",
  label: "Amount of each cheque (only when all cheques are equal)",
  read: (r) => {
    const s = leaseInstalments(r);
    return s && s.every((i) => i.amountFils === s[0]!.amountFils) ? s[0]!.amountFils : null;
  },
};
for (let n = 1; n <= 12; n++) {
  EXTRAS[`chequeDate${n}`] = {
    type: "date",
    label: `Date of cheque ${n}`,
    read: (r) => leaseInstalments(r)?.[n - 1]?.dueOn,
  };
}
EXTRAS.chequeDates = {
  type: "text",
  label: "All cheque dates, in order, separated by |",
  read: (r) =>
    leaseInstalments(r)
      ?.map((i) => formatCalendarDate(i.dueOn))
      .join(" | "),
};
/** The company's contract fees that apply in the unit's emirate (D70); a unit with no emirate gets the any-emirate ones. */
const appliedFees = (r: SheetRecords): ContractFee[] =>
  feesFor(parseContractFees(r.company?.contractFees), typeof r.unit?.emirate === "string" ? r.unit.emirate : null);
const feeText = (f: ContractFee): string => `${f.name} ${formatMoneyFils(f.amountFils)} (${f.payer})`;
EXTRAS.registrationFeeFils = {
  type: "money_fils",
  label: "Registration fee (Ejari, Tawtheeq or the emirate's own) for the unit's emirate",
  read: (r) =>
    registrationFeeFor(appliedFees(r), typeof r.unit?.emirate === "string" ? r.unit.emirate : null)?.amountFils,
};
EXTRAS.registrationFeePayer = {
  type: "text",
  label: "Who pays the registration fee (Tenant or Landlord)",
  read: (r) => {
    const p = registrationFeeFor(appliedFees(r), typeof r.unit?.emirate === "string" ? r.unit.emirate : null)?.payer;
    return p === "tenant" ? "Tenant" : p === "landlord" ? "Landlord" : null;
  },
};
EXTRAS.feesSummary = {
  type: "text",
  label: "Other fees (agency fee, municipality fee ...) with amount and payer, separated by ;",
  read: (r) =>
    appliedFees(r)
      .filter((f) => f.kind === "other")
      .map(feeText)
      .join("; "),
};
EXTRAS.allFeesList = {
  type: "text",
  label: "Every fee that applies, one per line (printed in the payment schedule section)",
  read: (r) => appliedFees(r).map(feeText).join("\n"),
};
/**
 * D74: the emirate's names and the rulebook's periods, for generic templates. The wording comes from the emirate's
 * registration settings and the periods from the rulebook pinned on the lease (both by code, passed in by the engine);
 * nothing here is chosen by a model.
 */
const WORDING_KEYS: [string, string][] = [
  ["registrationSystem", "Tenancy registration system of the emirate (Ejari, Tawtheeq, municipality attestation ...)"],
  ["registeringAuthority", "Authority that registers the tenancy contract in the emirate"],
  ["governingLaw", "Law governing the contract in the emirate"],
  ["disputeBody", "Body tenancy disputes are referred to in the emirate"],
  ["utilityProvider", "Electricity and water provider of the emirate (DEWA, SEWA ...)"],
];
for (const [key, label] of WORDING_KEYS) EXTRAS[key] = { type: "text", label, read: (r) => r.wording?.[key] };
const RULEBOOK_KEYS: [string, string, string][] = [
  ["renewalNoticeDays", "renewalNoticeDays", "Days of written notice before the term ends for a rent change on renewal (rulebook)"],
  ["repossessionNoticeMonths", "repossessionNoticeMonths", "Months of notice for the landlord to end the tenancy at the end of the term (rulebook)"],
  ["lateRentDays", "lateRentDaysAfterFormalReminder", "Days after the formal reminder before eviction can be sought (rulebook)"],
];
for (const [key, col, label] of RULEBOOK_KEYS) EXTRAS[key] = { type: "int", label, read: (r) => r.rulebook?.[col] };
EXTRAS.emirateName = {
  type: "text",
  label: "Emirate of the unit, as a name (Dubai, Abu Dhabi ...)",
  read: (r) => {
    const e = Emirate.safeParse(r.unit?.emirate);
    return e.success ? EMIRATE_LABELS[e.data] : null;
  },
};
/** Printed where the template says `{additional terms}`: the contract's addendum goes there (see `templateContractBlocks`). */
export const ADDITIONAL_TERMS_KEY = "additionalTerms";
EXTRAS[ADDITIONAL_TERMS_KEY] = {
  type: "text",
  label: "Additional terms (the contract's company clauses and free text, printed in place)",
  read: () => null,
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
  /** D74: the emirate's contract wording (registration settings). */
  wording?: Record<string, unknown> | null | undefined;
  /** D74: the periods of the rulebook that applies (`renewalNoticeDays`, `repossessionNoticeMonths`, `lateRentDaysAfterFormalReminder`). */
  rulebook?: Record<string, unknown> | null | undefined;
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
