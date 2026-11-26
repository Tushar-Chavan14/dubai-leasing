import {
  compareNames,
  type ContractFields,
  type EjariAutofix,
  type EjariField,
  type EjariPayload,
} from "@leasing/core";

/**
 * The Ejari payload, copied from the signed contract's fields only: what is registered is what
 * was signed. Pure code.
 */
export function buildEjariPayload(
  f: ContractFields,
): { ok: true; payload: EjariPayload } | { ok: false; problems: string[] } {
  const id: [EjariPayload["tenantIdType"], string | null] =
    f.tenantKind === "company"
      ? ["trade_licence", f.tenantTradeLicenceNo]
      : f.tenantEmiratesIdNo
        ? ["emirates_id", f.tenantEmiratesIdNo]
        : ["passport", f.tenantPassportNo];
  if (!id[1]) return { ok: false, problems: ["the signed contract has no tenant ID number"] };
  return {
    ok: true,
    payload: {
      tenantNameEn: f.tenantNameEn,
      tenantIdType: id[0],
      tenantIdNo: id[1],
      tenantIdExpiresOn: id[0] === "passport" ? f.tenantPassportExpiresOn : f.tenantIdExpiresOn,
      tenantNationality: f.tenantNationality,
      landlordNameEn: f.landlordNameEn,
      landlordIdNo: f.landlordIdNo,
      propertyUsage: f.propertyUsage,
      dldPropertyNo: f.dldPropertyNo,
      unitNo: f.unitNo,
      makaniNo: f.makaniNo,
      plotNo: f.plotNo,
      startOn: f.startOn,
      endOn: f.endOn,
      annualRentFils: f.annualRentFils,
      cheques: f.cheques,
      depositFils: f.depositFils,
    },
  };
}

/** A verified value for a name field and where it comes from (e.g. the KYC-verified party record). */
export interface VerifiedValue {
  value: string;
  source: string;
}

const collapse = (s: string) => s.trim().replace(/\s+/g, " ");
const titleCase = (s: string) =>
  collapse(s)
    .toLowerCase()
    .replace(/(^|[\s'-])(\p{L})/gu, (_m, sep: string, ch: string) => sep + ch.toUpperCase());

/**
 * The one typo-class correction for a name field, or null. Candidates are, in order: a verified
 * value that differs from what was sent (only if exactly one distinct value differs), then the
 * verified value in title case, in capitals, or with its spacing collapsed. A candidate must
 * differ from what was sent only by case, spacing, punctuation or accents (`compareNames` →
 * `typo_class`); a reordered or different name is never a fix.
 */
export function nameFix(
  field: "tenantNameEn" | "landlordNameEn",
  sent: string,
  verified: VerifiedValue[],
): EjariAutofix | null {
  const ok = (v: string) => v !== sent && compareNames(sent, v) === "typo_class";
  const distinct = [...new Map(verified.filter((v) => ok(v.value)).map((v) => [v.value, v])).values()];
  if (distinct.length > 1) return null;
  if (distinct.length === 1) return { field, from: sent, to: distinct[0]!.value, source: distinct[0]!.source };
  // The verified value must itself be the same name as what was sent before a variant is derived.
  const base = verified.find(
    (v) => compareNames(sent, v.value) !== "different" && compareNames(sent, v.value) !== "reordered",
  );
  if (!base) return null;
  for (const [label, variant] of [
    // Title case only from a name printed in capitals (as a passport's MRZ prints it).
    ...(base.value === base.value.toUpperCase() ? ([["title case", titleCase(base.value)]] as const) : []),
    ["capitals", collapse(base.value).toUpperCase()],
    ["spacing collapsed", collapse(base.value)],
  ] as const) {
    if (ok(variant)) return { field, from: sent, to: variant, source: `${base.source} (${label})` };
  }
  return null;
}

export const isNameField = (f: EjariField | null): f is "tenantNameEn" | "landlordNameEn" =>
  f === "tenantNameEn" || f === "landlordNameEn";
