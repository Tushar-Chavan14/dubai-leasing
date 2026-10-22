import { type EjariPayload, type EjariRejection, isValidEmiratesId } from "@leasing/core";

export interface PropertyRecord {
  unitNo: string;
  makaniNo: string;
  usage: string;
  ownerName: string;
}

export interface PersonRecord {
  idType: string;
  nameEn: string;
  expiresOn: string;
}

/**
 * The simulated registry's checks, pure code. They follow what a registry checks (the property
 * exists and matches, the landlord owns it, the tenant's ID is on record with exactly the same
 * name and is valid for the term, no overlapping registration) without copying any real system.
 * Messages are worded like a registry's: the field is not always named.
 */
export function registrationRejections(
  p: EjariPayload,
  r: { property: PropertyRecord | null; person: PersonRecord | null; overlapping: string | null },
): EjariRejection[] {
  const out: EjariRejection[] = [];
  if (p.endOn <= p.startOn) {
    out.push({
      code: "INVALID_PERIOD",
      field: "contract_period",
      message: "The contract end date must be after the start date.",
    });
  }
  if (p.depositFils > p.annualRentFils) {
    out.push({
      code: "INVALID_AMOUNT",
      field: "security_deposit",
      message: "The security deposit is higher than the annual rent.",
    });
  }
  if (!r.property) {
    out.push({
      code: "PROPERTY_NOT_FOUND",
      field: "dldPropertyNo",
      message: "No property is registered under this property number.",
    });
    return out;
  }
  if (r.property.unitNo !== p.unitNo || r.property.makaniNo !== p.makaniNo) {
    out.push({
      code: "PROPERTY_DATA_MISMATCH",
      field: "property",
      message: "The unit or Makani number does not match the property record.",
    });
  }
  if (r.property.usage !== p.propertyUsage) {
    out.push({ code: "PROPERTY_DATA_MISMATCH", field: "usage", message: "The property's permitted use is different." });
  }
  if (r.property.ownerName !== p.landlordNameEn) {
    out.push({
      code: "LANDLORD_MISMATCH",
      field: "landlord",
      message: "The lessor named on the contract is not the owner on the property record.",
    });
  }
  if (p.tenantIdType === "emirates_id" && !isValidEmiratesId(p.tenantIdNo)) {
    out.push({ code: "INVALID_ID", field: "tenantIdNo", message: "The Emirates ID number is not valid." });
  } else if (!r.person) {
    out.push({
      code: "TENANT_NOT_FOUND",
      field: "tenant_id",
      message: "No identity record was found for the tenant's document number.",
    });
  } else {
    if (r.person.nameEn !== p.tenantNameEn) {
      // Compared exactly as written. The registry does not say which spelling it holds.
      out.push({
        code: "NAME_MISMATCH",
        field: null,
        message: "The tenant name does not match the name on record for this identity document.",
      });
    }
    if (r.person.expiresOn < p.startOn) {
      out.push({
        code: "ID_EXPIRED",
        field: "tenant_id",
        message: "The tenant's identity document expires before the contract starts.",
      });
    }
  }
  if (r.overlapping) {
    out.push({
      code: "ACTIVE_REGISTRATION_EXISTS",
      field: null,
      message: `The property already has an active registration (${r.overlapping}) for part of this period.`,
    });
  }
  return out;
}
