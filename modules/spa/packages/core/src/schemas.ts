import { isCalendarDate } from "@platform/kernel/dates";
import { z } from "zod";
import { FURNISHED, UNIT_TYPES } from "./inventory.ts";
import { DealType } from "./state/deal.ts";

/**
 * SPA input shapes (architecture §4, §8; S13, S14, S18). Money is whole fils, dates are Asia/Dubai calendar days,
 * shares are basis points (10000 = 100%). Nothing here computes a legal or money value: that is `@spa/rulebook`.
 */
const uuid = z.uuid();
const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD");
const positiveFils = z.number().int().positive();
const bps = z.number().int().min(1).max(10_000);
const text = (max = 200) => z.string().trim().min(1).max(max);

export const PersonParty = z
  .object({
    kind: z.literal("person"),
    fullNameEn: text(),
    nationality: text(80),
    birthOn: calDate.optional(),
    passportNo: text(30).optional(),
    emiratesIdNo: text(30).optional(),
    email: z.email(),
    phone: text(30).optional(),
  })
  .refine((p) => p.passportNo !== undefined || p.emiratesIdNo !== undefined, "a passport or Emirates ID number");
export type PersonParty = z.infer<typeof PersonParty>;

export const CompanyDetails = z.object({
  tradeName: text(),
  licenceNo: text(60),
  licenceExpiresOn: calDate,
  issuingAuthority: text(120),
});
export const CompanyParty = z.object({ kind: z.literal("company"), details: CompanyDetails, email: z.email() });
export type CompanyParty = z.infer<typeof CompanyParty>;

export const Party = z.discriminatedUnion("kind", [PersonParty, CompanyParty]);
export type Party = z.infer<typeof Party>;

/** The person who signs for a company, and the document that lets them (S14). */
export const Signatory = z.object({
  companyPartyId: uuid,
  personPartyId: uuid,
  title: text(80),
  authority: z.enum(["poa", "board_resolution"]),
  documentId: uuid,
});
export const BeneficialOwner = z.object({ companyPartyId: uuid, personPartyId: uuid, shareBps: bps });

export const DealParty = z.object({
  role: z.enum(["buyer", "seller", "broker"]),
  partyId: uuid,
  order: z.number().int().min(1),
  shareBps: bps.optional(),
});
export type DealParty = z.infer<typeof DealParty>;

/** One role's parties: unique order, and shares for all of them (adding up to 100%) or for none. */
function checkRole(of: readonly DealParty[], role: string, c: z.core.$RefinementCtx<unknown>) {
  if (new Set(of.map((p) => p.order)).size !== of.length)
    c.addIssue({ code: "custom", message: `each ${role} needs its own order` });
  const shares = of.filter((p) => p.shareBps !== undefined);
  if (shares.length && shares.length !== of.length)
    c.addIssue({ code: "custom", message: `give a share for every ${role} or none` });
  else if (shares.length && shares.reduce((a, p) => a + (p.shareBps ?? 0), 0) !== 10_000)
    c.addIssue({ code: "custom", message: `${role} shares must add up to 100%` });
}

/** Buyers and sellers: at least one each; per role unique order and all-or-none shares adding up to 100%. */
export const DealParties = z.array(DealParty).superRefine((ps, c) => {
  const buyers = new Set(ps.filter((p) => p.role === "buyer").map((p) => p.partyId));
  if (ps.some((p) => p.role === "seller" && buyers.has(p.partyId)))
    c.addIssue({ code: "custom", message: "the same party can't be both buyer and seller" });
  for (const role of ["buyer", "seller"] as const) {
    const of = ps.filter((p) => p.role === role);
    if (!of.length) c.addIssue({ code: "custom", message: `at least one ${role}` });
    checkRole(of, role, c);
  }
});

/** The listing's own fields, shared by the full input, the draft input and an edit. */
const ListingFields = z.object({
  ref: text(20).optional(),
  /** Public title, e.g. "2-bed apartment, Marina Vista" (no owner names). */
  title: text(120),
  community: text(120),
  bedrooms: z.number().int().min(0).max(20).optional(),
  sizeSqft: z.number().int().min(1).max(1_000_000).optional(),
  /** S75: the same detail fields as a unit; furnishing is a listing's own. */
  unitType: z.enum(UNIT_TYPES).optional(),
  bathrooms: z.number().int().min(0).max(10).optional(),
  floor: z.number().int().min(-5).max(200).optional(),
  view: text(60).optional(),
  parkingSpaces: z.number().int().min(0).max(10).optional(),
  furnished: z.enum(FURNISHED).optional(),
  propertyDescription: text(2000),
  askingPriceFils: positiveFils,
  permitNo: text(40).optional(),
  permitIssuedOn: calDate.optional(),
  /** The permit's last valid day (S38). */
  permitExpiresOn: calDate.optional(),
  /** The listing agent, shown as the public page's contact. */
  agentUserId: uuid.optional(),
});
const permitOrder = {
  check: (l: { permitIssuedOn?: string | undefined; permitExpiresOn?: string | undefined }) =>
    !l.permitIssuedOn || !l.permitExpiresOn || l.permitIssuedOn <= l.permitExpiresOn,
  opts: { message: "the permit can't expire before it is issued", path: ["permitExpiresOn"] },
};

export const ListingInput = ListingFields.extend({
  sellers: z
    .array(DealParty)
    .min(1)
    .superRefine((s, c) => {
      if (!s.every((p) => p.role === "seller")) c.addIssue({ code: "custom", message: "only seller parties" });
      if (new Set(s.map((p) => p.partyId)).size !== s.length)
        c.addIssue({ code: "custom", message: "each seller once" });
      checkRole(s, "seller", c);
    }),
}).refine(permitOrder.check, permitOrder.opts);
export type ListingInput = z.infer<typeof ListingInput>;

const shareBps = z.number().int().min(1).max(10_000).optional();
/** A seller typed into the listing form (S74): a person or a company, who signs through a signatory. */
export const SellerInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("person"),
    fullNameEn: text(200),
    email: z.email(),
    phone: text(30).optional(),
    nationality: text(60).optional(),
    shareBps,
  }),
  z.object({
    kind: z.literal("company"),
    tradeName: text(200),
    email: z.email(),
    licenceNo: text(60),
    licenceExpiresOn: calDate,
    issuingAuthority: text(120),
    signatory: z.object({
      fullNameEn: text(200),
      email: z.email(),
      authority: z.enum(["poa", "board_resolution"]),
    }),
    shareBps,
  }),
]);
export type SellerInput = z.infer<typeof SellerInput>;
/** A seller already in the system. */
export const ExistingSeller = z.object({ partyId: uuid, shareBps });

/**
 * A listing draft with its sellers (S74): each email once, each existing party once, shares for all or none and adding
 * up to 100%. Every co-owner is a seller and signs (S14).
 */
export const ListingDraftInput = ListingFields.extend({
  sellers: z
    .array(z.union([SellerInput, ExistingSeller]))
    .min(1, "Add at least one seller")
    .max(10),
})
  .superRefine((l, c) => {
    const emails = l.sellers.flatMap((s) => ("email" in s ? [s.email.trim().toLowerCase()] : []));
    // A company's signatory is a person too; their email may not repeat a seller's either.
    const signers = l.sellers.flatMap((s) => ("signatory" in s ? [s.signatory.email.trim().toLowerCase()] : []));
    if (new Set([...emails, ...signers]).size !== emails.length + signers.length)
      c.addIssue({ code: "custom", path: ["sellers"], message: "each seller once: two sellers share an email" });
    const ids = l.sellers.flatMap((s) => ("partyId" in s ? [s.partyId] : []));
    if (new Set(ids).size !== ids.length)
      c.addIssue({ code: "custom", path: ["sellers"], message: "each seller once" });
    const given = l.sellers.filter((s) => s.shareBps !== undefined);
    if (given.length && given.length !== l.sellers.length)
      c.addIssue({ code: "custom", path: ["sellers"], message: "give a share for every seller or none" });
    else if (given.length && given.reduce((a, s) => a + (s.shareBps ?? 0), 0) !== 10_000)
      c.addIssue({ code: "custom", path: ["sellers"], message: "shares must add up to 100%" });
  })
  .refine(permitOrder.check, permitOrder.opts);
export type ListingDraftInput = z.infer<typeof ListingDraftInput>;

/** A buyer typed into the deal or offer form (S81): a person (nationality required) or a company with its signatory. */
export const BuyerInput = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("person"),
    fullNameEn: text(200),
    email: z.email(),
    phone: text(30).optional(),
    nationality: text(60),
    shareBps,
  }),
  SellerInput.options[1],
]);
export type BuyerInput = z.infer<typeof BuyerInput>;

/** 1 to 4 buyers (S81): each email once, each existing party once, shares for all or none adding up to 100%. */
export const BuyersInput = z
  .array(z.union([BuyerInput, ExistingSeller]))
  .min(1, "Add at least one buyer")
  .max(4, "At most four buyers")
  .superRefine((buyers, c) => {
    const emails = buyers.flatMap((s) => ("email" in s ? [s.email.trim().toLowerCase()] : []));
    const signers = buyers.flatMap((s) => ("signatory" in s ? [s.signatory.email.trim().toLowerCase()] : []));
    if (new Set([...emails, ...signers]).size !== emails.length + signers.length)
      c.addIssue({ code: "custom", message: "each buyer once: two buyers share an email" });
    const ids = buyers.flatMap((s) => ("partyId" in s ? [s.partyId] : []));
    if (new Set(ids).size !== ids.length) c.addIssue({ code: "custom", message: "each buyer once" });
    const given = buyers.filter((s) => s.shareBps !== undefined);
    if (given.length && given.length !== buyers.length)
      c.addIssue({ code: "custom", message: "give a share for every buyer or none" });
    else if (given.length && given.reduce((a, s) => a + (s.shareBps ?? 0), 0) !== 10_000)
      c.addIssue({ code: "custom", message: "buyer shares must add up to 100%" });
  });

/** The agency and agent who brought the buyer (S81). The commission % is the policy's unless one is typed. */
export const DealBrokerInput = z.object({
  agencyName: text(200),
  agencyEmail: z.email(),
  agentName: text(200),
  orn: text(40),
  brn: text(40),
  commissionBps: z.number().int().min(0).max(10_000).optional(),
});
export type DealBrokerInput = z.infer<typeof DealBrokerInput>;

/**
 * A primary deal started from a unit (S81). Sellers are not typed: the developer is the seller. A price below the
 * allowed discount or a booking below the minimum still creates the deal and opens `price_out_of_range`.
 */
export const NewDealInput = z.object({
  unitId: uuid,
  buyers: BuyersInput,
  /** Omitted: the unit's price-list price. */
  priceFils: positiveFils.optional(),
  bookingFils: positiveFils.optional(),
  buyerMortgage: z.boolean().default(false),
  broker: DealBrokerInput.optional(),
  leadId: uuid.optional(),
});
export type NewDealInput = z.infer<typeof NewDealInput>;

/** An offer made on a resale listing (S81). The deposit % is the pinned policy's, not typed. */
export const MakeOfferInput = z.object({
  listingId: uuid,
  buyers: BuyersInput,
  priceFils: positiveFils,
  buyerMortgage: z.boolean().default(false),
  sellerMortgage: z.boolean().optional(),
  planTakenOver: z.boolean().optional(),
  targetTransferOn: calDate.optional(),
  conditions: z.string().trim().max(1000).optional(),
  /** Days the sellers have to answer; omitted: the policy's `offerValidityDays`. */
  validDays: z.number().int().min(1).max(30).optional(),
  leadId: uuid.optional(),
});
export type MakeOfferInput = z.infer<typeof MakeOfferInput>;

/** An edit of a listing's own fields (not its sellers). Only the fields sent change. */
export const ListingEdit = ListingFields.omit({ ref: true }).partial().refine(permitOrder.check, permitOrder.opts);
export type ListingEdit = z.infer<typeof ListingEdit>;

/** A new deal (S13): a primary deal points to a unit, a resale to a listing, exactly one. */
export const DealInput = z
  .object({
    dealType: DealType,
    sellerMortgage: z.boolean(),
    buyerMortgage: z.boolean(),
    planTakenOver: z.boolean(),
    unitId: uuid.optional(),
    listingId: uuid.optional(),
    /** A primary deal may leave it out: the unit's price-list price is used (S64). A resale always names its price. */
    priceFils: positiveFils.optional(),
    parties: DealParties,
  })
  .superRefine((d, c) => {
    const primary = d.dealType === "primary_offplan";
    if (!primary && d.priceFils === undefined)
      c.addIssue({ code: "custom", path: ["priceFils"], message: "a resale needs a price" });
    if (primary && (!d.unitId || d.listingId))
      c.addIssue({ code: "custom", message: "a primary deal points to a unit only" });
    if (!primary && (!d.listingId || d.unitId))
      c.addIssue({ code: "custom", message: "a resale points to a listing only" });
    if (d.planTakenOver && d.dealType !== "resale_offplan")
      c.addIssue({ code: "custom", path: ["planTakenOver"], message: "only an off-plan resale takes over a plan" });
  });
export type DealInput = z.infer<typeof DealInput>;

export const PaymentPlan = z.object({
  instalments: z
    .array(
      z
        .object({ label: text(80), shareBps: bps, dueOn: calDate.optional(), milestone: text(80).optional() })
        .refine((i) => i.dueOn !== undefined || i.milestone !== undefined, "a due date or a milestone"),
    )
    .min(1)
    .refine((is) => is.reduce((a, i) => a + i.shareBps, 0) === 10_000, "shares must add up to 100%"),
});
export type PaymentPlan = z.infer<typeof PaymentPlan>;

const SettlementSide = z.enum(["buyer", "seller", "bank_buyer", "bank_seller"]);
export const SettlementLine = z.object({
  payer: SettlementSide,
  payee: z.union([SettlementSide, z.enum(["dld", "broker", "developer", "trustee"])]),
  label: text(120),
  amountFils: positiveFils,
});
/** Lines only: the balance check is `@spa/rulebook` (P4). */
export const Settlement = z.object({ lines: z.array(SettlementLine) });

export const AmlCase = z.object({
  partyId: uuid,
  status: z.enum(["open", "more_info", "cleared", "stopped", "reported"]),
  hits: z.array(z.object({ rule: text(80), detail: text(500) })),
});

export const DocumentKind = z.enum(["spa", "mou", "assignment", "listing_agreement"]);
export const TemplateVersion = z.object({
  documentKind: DocumentKind,
  status: z.enum(["proposed", "approved", "retired"]),
  sections: z.array(z.unknown()),
  blanks: z.array(z.object({ id: text(20), key: z.union([z.literal("leave_empty"), text(60)]) })),
  partyBlocks: z.array(z.object({ role: z.enum(["seller", "purchaser", "broker"]), repeatable: z.boolean() })),
  signatureBlocks: z.array(z.object({ role: text(40), page: z.number().int().min(1) })),
});

// ---------------------------------------------------------------------------------------------
// M4 (S78): the public catalogue. One allow-listed shape for a resale listing and a developer unit. `.strict()` on both:
// an extra key in what the engine builds is a failure, so a new column can never leak by accident.

export const PublicProperty = z
  .object({
    /** A listing's ref ("L-0007") or a unit's public ref ("U-<project code>-<unit code>"). */
    ref: z.string(),
    source: z.enum(["listing", "developer"]),
    title: z.string(),
    community: z.string().nullable(),
    projectName: z.string().nullable(),
    /** The developer's trade name, for developer units only. */
    developerName: z.string().nullable(),
    unitType: z.string().nullable(),
    unitTypeLabel: z.string().nullable(),
    bedrooms: z.number().nullable(),
    bathrooms: z.number().nullable(),
    sizeSqft: z.number().nullable(),
    priceFils: z.number().int(),
    permitNo: z.string().nullable(),
    coverPhotoId: z.string().nullable(),
    photoCount: z.number().int(),
    /** The project's expected handover, as a label (developer units). */
    handover: z.string().nullable(),
  })
  .strict();
export type PublicProperty = z.infer<typeof PublicProperty>;

export const PublicPropertyDetail = PublicProperty.extend({
  description: z.string().nullable(),
  floor: z.number().nullable(),
  view: z.string().nullable(),
  parkingSpaces: z.number().nullable(),
  furnishedLabel: z.string().nullable(),
  photoIds: z.array(z.string()),
  agent: z.object({ name: z.string() }).strict().nullable(),
  /** The listing chat is offered (resale listings only). */
  chat: z.boolean(),
}).strict();
export type PublicPropertyDetail = z.infer<typeof PublicPropertyDetail>;

export const CatalogueQuery = z.object({
  source: z.enum(["all", "listing", "developer"]).default("all"),
  community: z.string().max(120).optional(),
  type: z.enum(UNIT_TYPES).optional(),
  beds: z.coerce.number().int().min(0).max(10).optional(),
  min: z.coerce.number().int().min(0).optional(),
  max: z.coerce.number().int().min(0).optional(),
  sort: z.enum(["newest", "price_asc", "price_desc"]).default("newest"),
});
export type CatalogueQuery = z.infer<typeof CatalogueQuery>;
