import { isCalendarDate } from "@platform/kernel/dates";
import { z } from "zod";
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

export const ListingInput = z
  .object({
    ref: text(20).optional(),
    /** Public title, e.g. "2-bed apartment, Marina Vista" (no owner names). */
    title: text(120),
    community: text(120),
    bedrooms: z.number().int().min(0).max(20).optional(),
    sizeSqft: z.number().int().min(1).max(1_000_000).optional(),
    propertyDescription: text(2000),
    askingPriceFils: positiveFils,
    permitNo: text(40).optional(),
    permitIssuedOn: calDate.optional(),
    /** The permit's last valid day (S38). */
    permitExpiresOn: calDate.optional(),
    /** The listing agent, shown as the public page's contact. */
    agentUserId: uuid.optional(),
    sellers: z
      .array(DealParty)
      .min(1)
      .superRefine((s, c) => {
        if (!s.every((p) => p.role === "seller")) c.addIssue({ code: "custom", message: "only seller parties" });
        if (new Set(s.map((p) => p.partyId)).size !== s.length)
          c.addIssue({ code: "custom", message: "each seller once" });
        checkRole(s, "seller", c);
      }),
  })
  .refine((l) => !l.permitIssuedOn || !l.permitExpiresOn || l.permitIssuedOn <= l.permitExpiresOn, {
    message: "the permit can't expire before it is issued",
    path: ["permitExpiresOn"],
  });
export type ListingInput = z.infer<typeof ListingInput>;

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
