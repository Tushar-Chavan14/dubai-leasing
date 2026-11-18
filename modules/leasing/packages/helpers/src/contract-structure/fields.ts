import type { ContractFieldName } from "@leasing/core";

/** How a contract field is written into a blank. `enum` fields print as their words. */
export type FieldType = "text" | "money_fils" | "date" | "int" | "enum";

export interface FieldInfo {
  type: FieldType;
  label: string;
}

/**
 * The only fields a blank may be mapped to (names, types and labels from code, never from the
 * model). `satisfies Record<ContractFieldName, …>` makes the compiler fail when `ContractFields`
 * gains or loses a field and this list is not updated with it.
 */
export const FIELD_CATALOGUE = {
  leaseRef: { type: "text", label: "Lease reference" },
  tenantKind: { type: "enum", label: "Tenant type (individual or company)" },
  tenantNameEn: { type: "text", label: "Tenant name" },
  tenantNationality: { type: "text", label: "Tenant nationality" },
  tenantEmiratesIdNo: { type: "text", label: "Tenant Emirates ID number" },
  tenantIdExpiresOn: { type: "date", label: "Tenant ID expiry date" },
  tenantPassportNo: { type: "text", label: "Tenant passport number" },
  tenantPassportExpiresOn: { type: "date", label: "Tenant passport expiry date" },
  tenantVisaNo: { type: "text", label: "Tenant visa number" },
  tenantTradeLicenceNo: { type: "text", label: "Tenant trade licence number" },
  tenantEmail: { type: "text", label: "Tenant email" },
  tenantPhone: { type: "text", label: "Tenant phone" },
  landlordNameEn: { type: "text", label: "Landlord name" },
  landlordIdNo: { type: "text", label: "Landlord ID or trade licence number" },
  landlordEmail: { type: "text", label: "Landlord email" },
  landlordNationality: { type: "text", label: "Landlord nationality" },
  landlordPhone: { type: "text", label: "Landlord phone" },
  propertyUsage: { type: "enum", label: "Property usage (residential or commercial)" },
  building: { type: "text", label: "Building name" },
  community: { type: "text", label: "Community or area" },
  dldPropertyNo: { type: "text", label: "Property number (registry)" },
  unitNo: { type: "text", label: "Unit number" },
  makaniNo: { type: "text", label: "Makani number" },
  plotNo: { type: "text", label: "Plot number" },
  bedrooms: { type: "int", label: "Number of bedrooms" },
  startOn: { type: "date", label: "Tenancy start date" },
  endOn: { type: "date", label: "Tenancy end date" },
  annualRentFils: { type: "money_fils", label: "Annual rent" },
  cheques: { type: "int", label: "Number of cheques" },
  depositFils: { type: "money_fils", label: "Security deposit" },
  rentFreeDays: { type: "int", label: "Rent-free days" },
  moveInOn: { type: "date", label: "Move-in date" },
  contractOn: { type: "date", label: "Date of contract (date prepared)" },
} as const satisfies Record<ContractFieldName, FieldInfo>;

export const FIELD_NAMES = Object.keys(FIELD_CATALOGUE) as ContractFieldName[];

export const isFieldName = (s: string): s is ContractFieldName => Object.hasOwn(FIELD_CATALOGUE, s);

export const fieldType = (f: ContractFieldName): FieldType => FIELD_CATALOGUE[f].type;

/** The catalogue as a prompt block: `name | type | label`, one per line. Built from code. */
export const catalogueForPrompt = (): string =>
  FIELD_NAMES.map((n) => `${n} | ${FIELD_CATALOGUE[n].type} | ${FIELD_CATALOGUE[n].label}`).join("\n");
