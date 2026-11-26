import type { OqoodRegisterPayload, OqoodTransferPayload, RegistryRejection, TrusteeTransferPayload } from "@spa/core";

export interface UnitRecord {
  unitNo: string;
  projectCode: string;
  developerName: string;
  state: "available" | "registered";
}
export interface PersonRecord {
  nameEn: string;
  expiresOn: string;
}
export interface DeedRecord {
  titleDeedNo: string;
  owners: string[];
}

const reject = (code: RegistryRejection["code"], field: string | null, message: string): RegistryRejection => ({
  code,
  field,
  message,
});

/** The unit exists under this number, and under this project when the request names one. */
const unitFound = (p: { unitNo: string; projectCode: string | null }, unit: UnitRecord | null): unit is UnitRecord =>
  !!unit && (p.projectCode === null || unit.projectCode === p.projectCode);

/**
 * Buyers are checked against the identity records, exactly as written, the way a registry does. The registry does not
 * say which spelling it holds. An unknown or expired document is `INVALID_ID`.
 */
function buyerRejections(
  buyers: { name: string; idNo: string }[],
  persons: ReadonlyMap<string, PersonRecord>,
  today: string,
): RegistryRejection[] {
  const out: RegistryRejection[] = [];
  buyers.forEach((b, i) => {
    const person = persons.get(b.idNo);
    if (!person) {
      out.push(reject("INVALID_ID", `buyers[${i}].idNo`, "No identity record was found for this document number."));
      return;
    }
    if (person.expiresOn < today)
      out.push(reject("INVALID_ID", `buyers[${i}].idNo`, "The identity document has expired."));
    if (person.nameEn !== b.name)
      out.push(
        reject("BUYER_NAME_MISMATCH", null, "A buyer's name does not match the name on record for the document."),
      );
  });
  return out;
}

/** The simulated registry's checks for a primary registration, pure code. */
export function registerRejections(
  p: OqoodRegisterPayload,
  r: { unit: UnitRecord | null; persons: ReadonlyMap<string, PersonRecord>; today: string },
): RegistryRejection[] {
  if (!unitFound(p, r.unit))
    return [reject("UNIT_NOT_FOUND", "unitNo", "No unit is recorded under this unit and project.")];
  const out: RegistryRejection[] = [];
  if (r.unit.state === "registered")
    return [reject("UNIT_ALREADY_REGISTERED", "unitNo", "This unit already has a registration.")];
  if (r.unit.developerName !== p.developerName)
    out.push(reject("SELLER_NOT_OWNER", "developerName", "The seller named is not the developer on the unit record."));
  out.push(...buyerRejections(p.buyers, r.persons, r.today));
  return out;
}

const sameNames = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.toSorted().every((n, i) => n === b.toSorted()[i]);

/** The checks for an Oqood transfer or a trustee transfer: ownership, NOC, service charges and the buyers. */
export function transferRejections(
  p: OqoodTransferPayload | TrusteeTransferPayload,
  r: { unit: UnitRecord | null; deed: DeedRecord | null; persons: ReadonlyMap<string, PersonRecord>; today: string },
): RegistryRejection[] {
  if (!unitFound(p, r.unit))
    return [reject("UNIT_NOT_FOUND", "unitNo", "No unit is recorded under this unit and project.")];
  const out: RegistryRejection[] = [];
  const named = "titleDeedNo" in p ? p.titleDeedNo : null;
  const owns =
    !!r.deed &&
    (named === null || r.deed.titleDeedNo === named) &&
    sameNames(
      r.deed.owners,
      p.sellers.map((s) => s.name),
    );
  if (!owns) out.push(reject("SELLER_NOT_OWNER", "sellers", "The sellers named are not the owners on the record."));
  if (!p.nocPresent)
    out.push(reject("NOC_MISSING", "noc", "A no-objection certificate is required for this transfer."));
  if (!p.serviceChargesCleared)
    out.push(reject("SERVICE_CHARGES_OUTSTANDING", "serviceCharges", "Service charges are outstanding on the unit."));
  out.push(...buyerRejections(p.buyers, r.persons, r.today));
  return out;
}
