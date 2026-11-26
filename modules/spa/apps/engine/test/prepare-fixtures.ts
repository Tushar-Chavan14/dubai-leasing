import { newId } from "@platform/kernel";
import { DEFAULT_STYLE } from "@platform/readers/structure/look";
import type { ContractStructureData, TemplateBlank, TemplateSections } from "@platform/readers/structure/schema";
import { DEFAULT_SPA_POLICY, type DealType } from "@spa/core";
import {
  companyDetails,
  dealBrokers,
  deals,
  listingParties,
  listings,
  parties,
  screenings,
  signatories,
  type SpaDatabase,
  spaUsers,
  units,
} from "@spa/db";
import { dubaiSales2026_01, type SalesRulebook } from "@spa/rulebook";
import { eq } from "drizzle-orm";
import { dealAmlSubjects } from "../src/manager/aml-subjects.ts";
import { createDeal } from "../src/manager/deals.ts";
import type { SpaContext } from "../src/manager/context.ts";

/** Every rulebook value confirmed (fictional numbers): the real 2026-01 rulebook still has pending fees (S36). */
export const RB = {
  ...dubaiSales2026_01,
  trusteeFeeFils: 400_000,
  oqoodTransferFeeFils: 100_000,
  mortgageRegistrationBps: 25,
  mortgageRegistrationAdminFils: 29_000,
  amlCashThresholdFils: 5_500_000,
  pending: [],
} as unknown as SalesRulebook;
/** A second published rulebook version with a different fee %, for the "template approved under rulebook A" case. */
export const RB_B = { ...RB, version: "dubai-sales-test-b", registrationFeeBps: 200 } as SalesRulebook;

export type Role =
  | "sales_officer"
  | "sales_manager"
  | "sales_admin"
  | "admin"
  | "finance"
  | "legal"
  | "compliance_officer"
  | "mlro";
export type U = { id: string; role: Role };

export async function seedUsers(database: SpaDatabase): Promise<Record<string, U>> {
  const users: Record<string, U> = {};
  for (const [k, role] of Object.entries({
    officer: "sales_officer",
    manager: "sales_manager",
    salesadmin: "sales_admin",
    admin: "admin",
    finance: "finance",
    legal: "legal",
    compliance: "compliance_officer",
    mlro: "mlro",
  } as const)) {
    users[k] = { id: newId(), role };
    await database.db.insert(spaUsers).values({ ...users[k]!, email: `${k}@spa-demo.test`, name: k });
  }
  return users;
}

const AT = new Date("2026-11-19T06:00:00Z");

/** A fictional person or company party. */
export async function party(
  database: SpaDatabase,
  name: string,
  o: { kind?: "person" | "company"; nationality?: string; passport?: string; eid?: string } = {},
): Promise<string> {
  const id = newId();
  const kind = o.kind ?? "person";
  await database.db.insert(parties).values({
    id,
    kind,
    fullNameEn: name,
    email: `${id.slice(-8)}@example.test`,
    ...(kind === "person"
      ? { passportNo: o.passport ?? "X0000001", nationality: o.nationality ?? "Fictionalian" }
      : {}),
    ...(o.eid ? { emiratesIdNo: o.eid } : {}),
    createdAt: AT,
  });
  return id;
}

/** A company with its licence and one signatory (a fictional person). */
export async function company(database: SpaDatabase, name: string, licence: string): Promise<string> {
  const id = await party(database, name, { kind: "company" });
  await database.db.insert(companyDetails).values({
    partyId: id,
    tradeName: name,
    licenceNo: licence,
    licenceExpiresOn: "2027-12-31",
    issuingAuthority: "Fictional Authority",
  });
  const signer = await party(database, `${name} Signer`);
  await database.db.insert(signatories).values({
    id: newId(),
    companyPartyId: id,
    personPartyId: signer,
    title: "Director",
    authority: "board_resolution",
    documentId: newId(),
  });
  return id;
}

export interface DealOpts {
  type?: DealType;
  price?: number;
  buyers?: string[];
  sellers?: string[];
  unitNo?: string;
  buyerMortgage?: boolean;
}
export interface MadeDeal {
  dealId: string;
  buyerIds: string[];
  sellerIds: string[];
}

/** A deal forced into `AGREEMENT_DRAFT` (the steps before it are other chunks). */
export async function dealInDraft(ctx: SpaContext, database: SpaDatabase, o: DealOpts = {}): Promise<MadeDeal> {
  const type = o.type ?? "primary_offplan";
  const primary = type === "primary_offplan";
  const buyerNames = o.buyers ?? ["Buyer One"];
  const buyerIds: string[] = [];
  for (const n of buyerNames) buyerIds.push(await party(database, n));
  const sellerIds: string[] = [];
  if (primary) sellerIds.push(await company(database, "Fictional Developments LLC", "LIC-0001"));
  else for (const n of o.sellers ?? ["Seller One"]) sellerIds.push(await party(database, n));
  let property: { unitId: string } | { listingId: string };
  if (primary) {
    const unitId = newId();
    await database.db.insert(units).values({ id: unitId, code: `U-${unitId.slice(-6)}` });
    property = { unitId };
  } else {
    const listingId = newId();
    await database.db.insert(listings).values({
      id: listingId,
      state: "ACTIVE",
      permitExpiresOn: "2027-05-01",
      ownershipKind: "title_deed",
      ownershipRef: "TD-FICT-1",
    });
    await database.db
      .insert(listingParties)
      .values(sellerIds.map((partyId, i) => ({ listingId, partyId, order: i + 1 })));
    property = { listingId };
  }
  const d = await createDeal(
    ctx,
    {
      dealType: type,
      sellerMortgage: false,
      buyerMortgage: o.buyerMortgage ?? false,
      planTakenOver: type === "resale_offplan",
      ...property,
      priceFils: o.price ?? 200_000_000,
      parties: [
        ...buyerIds.map((partyId, i) => ({ role: "buyer" as const, partyId, order: i + 1 })),
        ...sellerIds.map((partyId, i) => ({ role: "seller" as const, partyId, order: i + 1 })),
      ],
    },
    "system",
  );
  await database.db
    .update(deals)
    .set({ state: "AGREEMENT_DRAFT", ...(o.unitNo ? { unitNo: o.unitNo } : {}) })
    .where(eq(deals.id, d.id));
  return { dealId: d.id, buyerIds, sellerIds };
}

export async function broker(
  database: SpaDatabase,
  dealId: string,
  side: "seller" | "buyer",
  agency: string,
  bps = DEFAULT_SPA_POLICY.commission[side === "seller" ? "sellerSideBps" : "buyerSideBps"],
) {
  const agencyPartyId = await company(database, agency, `ORN-LIC-${side}`);
  await database.db.insert(dealBrokers).values({
    dealId,
    side,
    agencyPartyId,
    agentName: `${agency} Agent`,
    orn: `ORN-${side}`,
    brn: `BRN-${side}`,
    commissionBps: bps,
    payer: side,
  });
}

// ---- fictional templates ------------------------------------------------------------------------------------------

export const blank = (id: string, label: string, field: string, over: Partial<TemplateBlank> = {}): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____________",
  label,
  field,
  source: "matched",
  fieldType:
    field === "price" || field === "dld_fee" || field === "deposit_amount" || field === "booking_amount"
      ? "money_fils"
      : "text",
  role: "field",
  sectionIndex: 0,
  before: `${label}: `,
  after: "",
  ...over,
});
export const sign = (id: string, label: string) =>
  blank(id, "Signature", "unmapped", { role: "signature", fieldType: null, before: `${label}: ` });

export interface Tpl {
  title: string;
  sections: TemplateSections["items"];
  blanks: TemplateBlank[];
  numbering?: TemplateSections["numbering"];
}
export function toData(t: Tpl): ContractStructureData {
  return {
    sections: { numbering: t.numbering ?? "article", title: t.title, items: t.sections },
    blanks: t.blanks,
    style: { ...DEFAULT_STYLE, header: null, footer: null },
    logo: null,
    pages: 2,
    droppedSections: 0,
    unmappedBlanks: 0,
  };
}

/** Primary SPA: seller (developer), one repeating purchaser block, unit, price, fee, plan table, signatures. */
export const spaTpl = (): Tpl => ({
  title: "OFF-PLAN SALE AND PURCHASE AGREEMENT",
  numbering: "decimal",
  sections: [
    {
      id: "s1",
      number: "1.",
      heading: "PARTIES",
      paragraphs: ["SELLER", "Name: {{b1}}", "Licence: {{b2}}", "PURCHASER", "Name: {{b3}}", "Nationality: {{b4}}"],
    },
    {
      id: "s2",
      number: "2.",
      heading: "PROPERTY AND PRICE",
      paragraphs: [
        "Unit no: {{b5}}",
        "The price is {{b6}} ({{b7}}).",
        "The registration fee is {{b8}}.",
        "Payment plan: {{b9}}",
      ],
    },
    { id: "s3", number: "3.", heading: "SIGNATURES", paragraphs: ["Seller: {{b10}}", "Purchaser: {{b11}}"] },
  ],
  blanks: [
    blank("b1", "Name", "seller_name"),
    blank("b2", "Licence", "seller_licence_no"),
    blank("b3", "Name", "purchaser_name"),
    blank("b4", "Nationality", "purchaser_nationality"),
    blank("b5", "Unit no", "unit_no"),
    blank("b6", "Price", "price"),
    blank("b7", "Price in words", "price_words", { kind: "placeholder", marker: "{price in words}" }),
    blank("b8", "Registration fee", "dld_fee"),
    blank("b9", "Payment plan", "payment_plan"),
    sign("b10", "Seller"),
    sign("b11", "Purchaser"),
  ],
});

/** Ready resale MOU: sellers repeat, buyers repeat, deposit, transfer date, title deed; no plan. */
export const mouTpl = (): Tpl => ({
  title: "MEMORANDUM OF UNDERSTANDING",
  numbering: "article",
  sections: [
    {
      id: "s1",
      number: "ARTICLE 1",
      heading: "PARTIES",
      paragraphs: ["SELLER", "Name: {{b1}}", "PURCHASER", "Name: {{b2}}"],
    },
    {
      id: "s2",
      number: "ARTICLE 2",
      heading: "TERMS",
      paragraphs: [
        "Unit no: {{b3}}",
        "Title deed: {{b4}}",
        "The price is {{b5}}.",
        "The security deposit is {{b6}}.",
        "Transfer on {{b7}}.",
      ],
    },
    { id: "s3", number: "ARTICLE 3", heading: "SIGNATURES", paragraphs: ["Seller: {{b8}}", "Purchaser: {{b9}}"] },
  ],
  blanks: [
    blank("b1", "Name", "seller_name"),
    blank("b2", "Name", "purchaser_name"),
    blank("b3", "Unit no", "unit_no"),
    blank("b4", "Title deed", "title_deed_no"),
    blank("b5", "Price", "price"),
    blank("b6", "Security deposit", "deposit_amount"),
    blank("b7", "Transfer date", "transfer_date", { fieldType: "date" }),
    sign("b8", "Seller"),
    sign("b9", "Purchaser"),
  ],
});

/** Off-plan resale assignment: one purchaser, one seller, price, plan table (resale: optional). */
export const assignmentTpl = (): Tpl => ({
  title: "ASSIGNMENT OF SALE AND PURCHASE AGREEMENT",
  numbering: "decimal",
  sections: [
    {
      id: "s1",
      number: "1.",
      heading: "PARTIES",
      paragraphs: ["Seller name: {{b1}}", "Purchaser name: {{b2}}", "Unit no: {{b3}}", "The price is {{b4}}."],
    },
    { id: "s2", number: "2.", heading: "SIGNATURES", paragraphs: ["Seller: {{b5}}", "Purchaser: {{b6}}"] },
  ],
  blanks: [
    blank("b1", "Seller name", "seller_name"),
    blank("b2", "Purchaser name", "purchaser_name"),
    blank("b3", "Unit no", "unit_no"),
    blank("b4", "Price", "price"),
    sign("b5", "Seller"),
    sign("b6", "Purchaser"),
  ],
});

/**
 * A clean screening of every subject of a deal (what a passed `screenDeal` stores), so `openAmlFlag` is false: since the
 * C14-C20 review a flag also holds every step after the agreement, and an unscreened party is an open flag (S50).
 */
export async function markScreened(
  database: SpaDatabase,
  dealId: string,
  at: Date = new Date("2026-11-19T06:00:00Z"),
): Promise<void> {
  const [deal] = await database.db.select().from(deals).where(eq(deals.id, dealId));
  for (const s of await dealAmlSubjects(database.db, deal!))
    await database.db.insert(screenings).values({
      id: newId(),
      dealId,
      partyId: s.partyId,
      subjectKey: s.key,
      trigger: "manual",
      listVersion: "fake-2026-11",
      sanctionsScore: 0,
      pepScore: 0,
      exact: false,
      matches: { entries: [], hits: [] },
      screenedAt: at,
    });
}
