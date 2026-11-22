import type { OqoodRegisterPayload, OqoodTransferPayload, TrusteeTransferPayload } from "@spa/core";
import type { SpaValues } from "../render/index.ts";

/**
 * What the registry payloads are built from, all of it records on the deal (S53). The values come from the deal's data
 * sheet (`buildDealSheet`: party names and ids, unit, price) and from the NOC record; no model reads or writes any of it.
 */
export interface RegistrySource {
  purchasers: SpaValues[];
  sellers: SpaValues[];
  values: SpaValues;
  /** The deal's own project code (resales); null when not recorded. */
  projectCode: string | null;
  /** The `nocOk` fact: a valid NOC is on file today. */
  nocOk: boolean;
  /** The current NOC record's service-charge answer; null with no record. */
  serviceChargesCleared: boolean | null;
}

export type PayloadResult<T> = { ok: true; payload: T } | { ok: false; missing: string[] };

const text = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function buyersOf(src: RegistrySource, missing: string[]): { name: string; idNo: string }[] {
  const out: { name: string; idNo: string }[] = [];
  src.purchasers.forEach((p, i) => {
    const name = text(p.purchaser_name);
    // A company is known by its licence number; a person by Emirates ID, else passport.
    const idNo = text(p.purchaser_eid_no) ?? text(p.purchaser_passport_no) ?? text(p.purchaser_licence_no);
    if (!name) missing.push(`buyer ${i + 1} name`);
    if (!idNo) missing.push(`buyer ${i + 1} identity number`);
    if (name && idNo) out.push({ name, idNo });
  });
  if (!src.purchasers.length) missing.push("buyers");
  return out;
}

function sellersOf(src: RegistrySource, missing: string[]): { name: string }[] {
  const out: { name: string }[] = [];
  src.sellers.forEach((s, i) => {
    const name = text(s.seller_name);
    if (name) out.push({ name });
    else missing.push(`seller ${i + 1} name`);
  });
  if (!src.sellers.length) missing.push("sellers");
  return out;
}

const price = (src: RegistrySource, missing: string[]): number => {
  const p = src.values.price;
  if (typeof p === "number" && Number.isSafeInteger(p) && p > 0) return p;
  missing.push("price");
  return 0;
};

/** Primary off-plan: the developer (the deal's seller) sells the unit to the buyers. */
export function buildOqoodRegister(src: RegistrySource): PayloadResult<OqoodRegisterPayload> {
  const missing: string[] = [];
  const unitNo = text(src.values.unit_no);
  if (!unitNo) missing.push("unit number");
  const developerName = text(src.sellers[0]?.seller_name);
  if (!developerName) missing.push("developer name");
  const buyers = buyersOf(src, missing);
  const priceFils = price(src, missing);
  if (missing.length || !unitNo || !developerName) return { ok: false, missing };
  return { ok: true, payload: { unitNo, projectCode: src.projectCode, developerName, buyers, priceFils } };
}

function transferParts(src: RegistrySource, missing: string[]) {
  const unitNo = text(src.values.unit_no);
  if (!unitNo) missing.push("unit number");
  const sellers = sellersOf(src, missing);
  const buyers = buyersOf(src, missing);
  const priceFils = price(src, missing);
  if (src.serviceChargesCleared === null) missing.push("NOC service-charge answer");
  return { unitNo, sellers, buyers, priceFils };
}

/** Off-plan resale: the Oqood record moves from the sellers to the buyers. */
export function buildOqoodTransfer(src: RegistrySource): PayloadResult<OqoodTransferPayload> {
  const missing: string[] = [];
  const { unitNo, sellers, buyers, priceFils } = transferParts(src, missing);
  if (missing.length || !unitNo) return { ok: false, missing };
  return {
    ok: true,
    payload: {
      unitNo,
      projectCode: src.projectCode,
      sellers,
      buyers,
      priceFils,
      nocPresent: src.nocOk,
      serviceChargesCleared: src.serviceChargesCleared === true,
    },
  };
}

/** Ready resale: the trustee office re-issues the title deed; the old deed's number is the listing's recorded one. */
export function buildTrusteeTransfer(src: RegistrySource): PayloadResult<TrusteeTransferPayload> {
  const missing: string[] = [];
  const { unitNo, sellers, buyers, priceFils } = transferParts(src, missing);
  const titleDeedNo = text(src.values.title_deed_no);
  if (!titleDeedNo) missing.push("title deed number");
  if (missing.length || !unitNo || !titleDeedNo) return { ok: false, missing };
  return {
    ok: true,
    payload: {
      unitNo,
      projectCode: src.projectCode,
      titleDeedNo,
      sellers,
      buyers,
      priceFils,
      nocPresent: src.nocOk,
      serviceChargesCleared: src.serviceChargesCleared === true,
    },
  };
}
