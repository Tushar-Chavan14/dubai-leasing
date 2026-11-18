import type { ContractFields, FieldSource } from "@leasing/core";
import type { ContractContext } from "./schema.ts";

/**
 * Copies every contract field from its record, pure code. Each field keeps where it came from,
 * so a test (or an auditor) can check the contract against its sources character for character.
 * Required values that are missing are listed instead of guessed.
 */
export function buildContractFields(
  c: ContractContext,
): { ok: true; fields: ContractFields; sources: Record<string, FieldSource> } | { ok: false; missing: string[] } {
  const sources: Record<string, FieldSource> = {};
  const from = <K extends keyof ContractFields>(
    field: K,
    entity: FieldSource["entity"],
    id: string,
    column: string,
    value: ContractFields[K],
  ): ContractFields[K] => {
    sources[field] = { entity, id, column };
    return value;
  };
  const missing: string[] = [];
  const need = (label: string, v: string | null): string => {
    if (v === null || v.trim() === "") missing.push(label);
    return v ?? "";
  };
  const t = c.tenant;
  const l = c.landlord;
  const u = c.unit;
  const a = c.application;

  // Only a tenant whose identity was verified through an application's KYC check is contracted here.
  if (!a?.kycVerified) missing.push("the tenant's identity has not been verified (KYC)");
  if (t.kind === "company" ? !t.tradeLicenceNo : !t.emiratesIdNo && !t.passportNo) {
    missing.push(t.kind === "company" ? "tenant trade licence number" : "tenant Emirates ID or passport number");
  }

  const fields: ContractFields = {
    leaseRef: from("leaseRef", "lease", c.lease.id, "ref", c.lease.ref),
    tenantKind: from("tenantKind", "party", t.id, "kind", t.kind),
    tenantNameEn: from("tenantNameEn", "party", t.id, "fullNameEn", need("tenant name", t.fullNameEn)),
    tenantNationality: from("tenantNationality", "party", t.id, "nationality", t.nationality),
    tenantEmiratesIdNo: from("tenantEmiratesIdNo", "party", t.id, "emiratesIdNo", t.emiratesIdNo),
    tenantIdExpiresOn: from(
      "tenantIdExpiresOn",
      "party",
      t.id,
      t.kind === "company" ? "tradeLicenceExpiresOn" : "idExpiresOn",
      t.kind === "company" ? t.tradeLicenceExpiresOn : t.idExpiresOn,
    ),
    tenantPassportNo: from("tenantPassportNo", "party", t.id, "passportNo", t.passportNo),
    tenantPassportExpiresOn: from("tenantPassportExpiresOn", "party", t.id, "passportExpiresOn", t.passportExpiresOn),
    tenantVisaNo: from("tenantVisaNo", "party", t.id, "visaNo", t.visaNo),
    tenantTradeLicenceNo: from("tenantTradeLicenceNo", "party", t.id, "tradeLicenceNo", t.tradeLicenceNo),
    tenantEmail: from("tenantEmail", "party", t.id, "email", t.email),
    tenantPhone: from("tenantPhone", "party", t.id, "phone", t.phone),
    landlordNameEn: from("landlordNameEn", "party", l.id, "fullNameEn", need("landlord name", l.fullNameEn)),
    landlordIdNo: from(
      "landlordIdNo",
      "party",
      l.id,
      l.kind === "company" ? "tradeLicenceNo" : "emiratesIdNo",
      l.kind === "company" ? l.tradeLicenceNo : l.emiratesIdNo,
    ),
    landlordEmail: from("landlordEmail", "party", l.id, "email", l.email),
    landlordNationality: from("landlordNationality", "party", l.id, "nationality", l.nationality ?? null),
    landlordPhone: from("landlordPhone", "party", l.id, "phone", l.phone ?? null),
    propertyUsage: from("propertyUsage", "unit", u.id, "kind", u.kind),
    building: from("building", "unit", u.id, "building", u.building),
    community: from("community", "unit", u.id, "community", u.community),
    dldPropertyNo: from("dldPropertyNo", "unit", u.id, "dldPropertyNo", need("DLD property number", u.dldPropertyNo)),
    unitNo: from("unitNo", "unit", u.id, "unitNo", need("unit number", u.unitNo)),
    makaniNo: from("makaniNo", "unit", u.id, "makaniNo", need("Makani number", u.makaniNo)),
    plotNo: from("plotNo", "unit", u.id, "plotNo", u.plotNo),
    bedrooms: from("bedrooms", "unit", u.id, "bedrooms", u.bedrooms),
    startOn: from("startOn", "lease", c.lease.id, "startOn", c.lease.startOn),
    endOn: from("endOn", "lease", c.lease.id, "endOn", c.lease.endOn),
    annualRentFils: from("annualRentFils", "lease", c.lease.id, "annualRentFils", c.lease.annualRentFils),
    cheques: from("cheques", "lease", c.lease.id, "cheques", c.lease.cheques),
    depositFils: from("depositFils", "lease", c.lease.id, "depositFils", c.lease.depositFils),
    rentFreeDays: a
      ? from("rentFreeDays", "application", a.id, "offer.rentFreeDays", a.rentFreeDays)
      : from("rentFreeDays", "lease", c.lease.id, "(none)", 0),
    moveInOn: a
      ? from("moveInOn", "application", a.id, "offer.moveInOn", a.moveInOn)
      : from("moveInOn", "lease", c.lease.id, "startOn", c.lease.startOn),
  };

  // The ID must still be valid when the tenancy starts (KYC checked it; this is a second look).
  const idExpiry = fields.tenantIdExpiresOn ?? (t.kind === "individual" ? fields.tenantPassportExpiresOn : null);
  if (idExpiry && idExpiry < fields.startOn) {
    missing.push(`the tenant's ID expires on ${idExpiry}, before the tenancy starts on ${fields.startOn}`);
  }
  return missing.length ? { ok: false, missing } : { ok: true, fields, sources };
}
