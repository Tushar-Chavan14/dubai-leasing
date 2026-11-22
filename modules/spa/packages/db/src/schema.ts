import {
  type AgreementFlag,
  CHASE_REASON_CODES,
  DEAL_STATES,
  type DealState,
  HELPER_MODES,
  type HelperMode,
  SWITCHABLE_HELPERS,
  type DealType,
  type ListingState,
  REGISTRY_KINDS,
  type RegistryKind,
  type RegistryRejection,
  SpaGateId,
  type SpaPolicy,
  type CompanyKind,
  type SpaRole,
  type UnitState,
} from "@spa/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  integer,
  primaryKey,
  boolean,
  check,
  date,
  doublePrecision,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgSequence,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * The `spa` database (decision S2). Nothing here is shared with leasing: own users, own demo clock, own jobs
 * (pg-boss creates its `pgboss` schema itself when the engine starts). P2 needs only these two tables.
 */
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

const ROLES: readonly SpaRole[] = [
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "legal",
  "compliance_officer",
  "mlro",
  "finance",
  "admin",
];

/** SPA staff (S3). A password is stored only as an argon2id hash; demo users have none (they use the demo picker). */
export const spaUsers = pgTable(
  "spa_users",
  {
    id: uuid("id").primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").$type<SpaRole>().notNull(),
    passwordHash: text("password_hash"),
    active: boolean("active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("spa_users_role", sql.raw(`${t.role.name} in (${ROLES.map((r) => `'${r}'`).join(", ")})`)),
    // Stored lower case, so the unique email is unique whatever case it is typed in.
    check("spa_users_email_lower", sql`${t.email} = lower(${t.email})`),
  ],
);

/** The SPA demo clock (S2): one row, an offset in ms added to system time. */
export const spaDemoSettings = pgTable(
  "spa_demo_settings",
  {
    id: smallint("id").primaryKey().default(1),
    clockOffsetMs: bigint("clock_offset_ms", { mode: "number" }).notNull().default(0),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [check("spa_demo_settings_one_row", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------------------------
// P3 domain core (architecture §4, §5, §8). Only SpaManager writes units, listings and deals.

const fils = (name: string) => bigint(name, { mode: "number" });
/** `col in ('A', 'B')` for a CHECK constraint, from the code's own list. */
const oneOf = (col: { name: string }, values: readonly string[]) =>
  sql.raw(`"${col.name}" in (${values.map((v) => `'${v}'`).join(", ")})`);
const UNIT_STATES: readonly UnitState[] = ["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"];
const LISTING_STATES: readonly ListingState[] = [
  "DRAFT",
  "VERIFIED",
  "ACTIVE",
  "PUBLISHED",
  "UNDER_OFFER",
  "SOLD",
  "WITHDRAWN",
];
const calDate = (name: string) => date(name, { mode: "string" });

/**
 * A developer's unit. `building_id` is null only for a unit made before projects existed; it is set once and never
 * moved (trigger, S64). The project and price list are reached through the building.
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull().unique(),
    state: text("state").$type<UnitState>().notNull().default("AVAILABLE"),
    buildingId: uuid("building_id").references(() => buildings.id),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("units_state", oneOf(t.state, UNIT_STATES))],
);

/** A brokerage listing; seller parties, documents and offers come in P4b/P4c. */
export const listings = pgTable(
  "listings",
  {
    id: uuid("id").primaryKey(),
    ref: text("ref")
      .notNull()
      .unique()
      .default(sql`'L-' || lpad(nextval('spa_listing_ref_seq')::text, 4, '0')`),
    state: text("state").$type<ListingState>().notNull().default("DRAFT"),
    askingPriceFils: fils("asking_price_fils"),
    /** What the public page shows (design.md §7.5); never owner names or document numbers. */
    title: text("title"),
    description: text("description"),
    community: text("community"),
    bedrooms: integer("bedrooms"),
    sizeSqft: integer("size_sqft"),
    permitNo: text("permit_no"),
    permitIssuedOn: calDate("permit_issued_on"),
    /** The last day the advertising permit is valid (S38). */
    permitExpiresOn: calDate("permit_expires_on"),
    agentUserId: uuid("agent_user_id").references(() => spaUsers.id),
    /** The ownership document (S14): title deed (ready) or Oqood certificate (off-plan). */
    ownershipKind: text("ownership_kind").$type<"title_deed" | "oqood">(),
    ownershipRef: text("ownership_ref"),
    /** Code matched the owners on the document to the sellers (else `seller_verification`). */
    ownershipMatched: boolean("ownership_matched").notNull().default(false),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("listings_state", oneOf(t.state, LISTING_STATES)),
    check("listings_ownership_kind", sql`${t.ownershipKind} is null or ${t.ownershipKind} in ('title_deed', 'oqood')`),
  ],
);

export const dealRefSeq = pgSequence("spa_deal_ref_seq");
export const listingRefSeq = pgSequence("spa_listing_ref_seq");

export type DefaultReason = "overdue" | "withdrew" | "no_show";

/** One sale of one unit (S13): a primary deal points to a unit, a resale to a listing. */
export const deals = pgTable(
  "deals",
  {
    id: uuid("id").primaryKey(),
    ref: text("ref")
      .notNull()
      .unique()
      .default(sql`'D-' || lpad(nextval('spa_deal_ref_seq')::text, 4, '0')`),
    dealType: text("deal_type").$type<DealType>().notNull(),
    sellerMortgage: boolean("seller_mortgage").notNull().default(false),
    buyerMortgage: boolean("buyer_mortgage").notNull().default(false),
    planTakenOver: boolean("plan_taken_over").notNull().default(false),
    unitId: uuid("unit_id").references(() => units.id),
    listingId: uuid("listing_id").references(() => listings.id),
    priceFils: fils("price_fils").notNull(),
    state: text("state").$type<DealState>().notNull().default("OFFER_AGREED"),
    /** The SPA rulebook version pinned on the deal when it was created (S37); never changes (trigger). */
    rulesVersion: text("rules_version").notNull(),
    /** The `spa_policy` version in force when the deal was created (0 = code default). */
    policyVersion: integer("policy_version").notNull().default(0),
    /** The day the transfer is planned for (S47); a NOC must be valid on it. Set by a sales manager, sales admin or admin. */
    targetTransferOn: calDate("target_transfer_on"),
    /** The unit and project a resale's NOC is matched against (S47); a primary deal's unit is `unit_id`. */
    unitNo: text("unit_no"),
    projectCode: text("project_code"),
    /** C22 (S55): an overdue instalment, a withdrawal or a no-show. A flag only: no state changes, no notice (S27). */
    inDefault: boolean("in_default").notNull().default(false),
    inDefaultSince: calDate("in_default_since"),
    inDefaultReason: text("in_default_reason").$type<DefaultReason>(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("deals_default_needs_date", sql`not ${t.inDefault} or ${t.inDefaultSince} is not null`),
    check(
      "deals_default_reason",
      sql`${t.inDefaultReason} is null or ${t.inDefaultReason} in ('overdue', 'withdrew', 'no_show')`,
    ),
    check(
      "deals_one_property",
      sql`(${t.dealType} = 'primary_offplan' and ${t.unitId} is not null and ${t.listingId} is null) or (${t.dealType} <> 'primary_offplan' and ${t.listingId} is not null and ${t.unitId} is null)`,
    ),
    check("deals_plan_offplan_resale", sql`not ${t.planTakenOver} or ${t.dealType} = 'resale_offplan'`),
    check("deals_state", oneOf(t.state, DEAL_STATES)),
    check("deals_price_positive", sql`${t.priceFils} > 0`),
    // One open deal per unit and per listing (terminal deals don't count).
    uniqueIndex("deals_open_unit_uq")
      .on(t.unitId)
      .where(sql`${t.state} not in ('HANDED_OVER', 'COMPLETED', 'CANCELLED') and ${t.unitId} is not null`),
    uniqueIndex("deals_open_listing_uq")
      .on(t.listingId)
      .where(sql`${t.state} not in ('HANDED_OVER', 'COMPLETED', 'CANCELLED') and ${t.listingId} is not null`),
  ],
);

export type SpaEntityKind = "deal" | "unit" | "listing" | "settings" | "party" | "template";
/** The records a gate can open on. */
export type GateEntityKind = "deal" | "unit" | "listing" | "template";

/** SPA gates (S3): never leasing's `approvals`. */
export const spaApprovals = pgTable(
  "spa_approvals",
  {
    id: uuid("id").primaryKey(),
    gate: text("gate").$type<SpaGateId>().notNull(),
    entityKind: text("entity_kind").$type<SpaEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Unique while pending, e.g. "<dealId>:agreement_approval": a retry finds the open one; a decided one frees the key. */
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    reasons: text("reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rulesVersion: text("rules_version"),
    approverRole: text("approver_role").$type<SpaRole>().notNull(),
    status: text("status")
      .$type<"pending" | "approved" | "rejected" | "edited" | "cancelled">()
      .notNull()
      .default("pending"),
    /** `aml_flag` only: clear, more_info, stop or stop_and_report. */
    outcome: text("outcome"),
    proposedBy: text("proposed_by").notNull(),
    decidedBy: uuid("decided_by").references(() => spaUsers.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    editedProposal: jsonb("edited_proposal").$type<Record<string, unknown>>(),
    consumedByEventId: uuid("consumed_by_event_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("spa_approvals_status_idx").on(t.status, t.createdAt),
    index("spa_approvals_entity_idx").on(t.entityKind, t.entityId),
    uniqueIndex("spa_approvals_dedupe_pending_uq")
      .on(t.dedupeKey)
      .where(sql`${t.status} = 'pending'`),
    check("spa_approvals_gate", oneOf(t.gate, SpaGateId.options)),
    check("spa_approvals_status", oneOf(t.status, ["pending", "approved", "rejected", "edited", "cancelled"])),
  ],
);

/** Every change to a deal, unit or listing (architecture §1.5). Append-only: triggers refuse update and delete. */
export const dealEvents = pgTable(
  "deal_events",
  {
    id: uuid("id").primaryKey(),
    entityKind: text("entity_kind").$type<SpaEntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    type: text("type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    actor: text("actor").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    rulesVersion: text("rules_version"),
    /** From the SPA Clock (demo offset applies). */
    at: ts("at").notNull(),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("deal_events_entity_idx").on(t.entityKind, t.entityId, t.at)],
);

/** Company policy versions (architecture §6, C3). A published version never changes (trigger). */
export const spaPolicy = pgTable("spa_policy", {
  version: integer("version").primaryKey(),
  values: jsonb("values").$type<SpaPolicy>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

// ---------------------------------------------------------------------------------------------
// C4: the client company, parties (S14). ID numbers are stored here; events and logs mask them.

/** The client company (S12): one row per install. */
export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    kind: text("kind").$type<CompanyKind>().notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [check("companies_kind", oneOf(t.kind, ["developer", "brokerage", "both"]))],
);

export const parties = pgTable(
  "parties",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").$type<"person" | "company">().notNull(),
    /** A person's full name as on the passport, or a company's trade name. */
    fullNameEn: text("full_name_en").notNull(),
    nationality: text("nationality"),
    birthOn: calDate("birth_on"),
    passportNo: text("passport_no"),
    emiratesIdNo: text("emirates_id_no"),
    email: text("email").notNull(),
    phone: text("phone"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [check("parties_kind", oneOf(t.kind, ["person", "company"]))],
);

export const companyDetails = pgTable("company_details", {
  partyId: uuid("party_id")
    .primaryKey()
    .references(() => parties.id),
  tradeName: text("trade_name").notNull(),
  licenceNo: text("licence_no").notNull(),
  licenceExpiresOn: calDate("licence_expires_on").notNull(),
  issuingAuthority: text("issuing_authority").notNull(),
});

/** The person who signs for a company, and the POA or board resolution that lets them (S14). */
export const signatories = pgTable(
  "signatories",
  {
    id: uuid("id").primaryKey(),
    companyPartyId: uuid("company_party_id")
      .notNull()
      .references(() => parties.id),
    personPartyId: uuid("person_party_id")
      .notNull()
      .references(() => parties.id),
    title: text("title").notNull(),
    authority: text("authority").$type<"poa" | "board_resolution">().notNull(),
    documentId: uuid("document_id").notNull(),
  },
  (t) => [check("signatories_authority", oneOf(t.authority, ["poa", "board_resolution"]))],
);

export const beneficialOwners = pgTable(
  "beneficial_owners",
  {
    companyPartyId: uuid("company_party_id")
      .notNull()
      .references(() => parties.id),
    personPartyId: uuid("person_party_id")
      .notNull()
      .references(() => parties.id),
    shareBps: integer("share_bps").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.companyPartyId, t.personPartyId] }),
    check("beneficial_owners_share", sql`${t.shareBps} between 1 and 10000`),
  ],
);

/** Who is on a deal (S13, S14): buyers, sellers (every owner) and brokers, in signing order. */
export const dealParties = pgTable(
  "deal_parties",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    role: text("role").$type<"buyer" | "seller" | "broker">().notNull(),
    order: integer("order").notNull(),
    shareBps: integer("share_bps"),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.role, t.order] }),
    check("deal_parties_role", oneOf(t.role, ["buyer", "seller", "broker"])),
  ],
);

// ---------------------------------------------------------------------------------------------
// C5: listing sellers (every co-owner, S14), owners as on the ownership document, listing-agreement signatures.

export const listingParties = pgTable(
  "listing_parties",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    order: integer("order").notNull(),
    shareBps: integer("share_bps"),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.order] })],
);

/** Owners as printed on the ownership document (typed by staff until the reader exists, C20). */
export const listingOwners = pgTable(
  "listing_owners",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    order: integer("order").notNull(),
    nameAsOnDocument: text("name_as_on_document").notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.order] })],
);

/** Listing-agreement signatures, one per seller (recorded by staff until e-sign, C28). */
export const listingSignatures = pgTable(
  "listing_signatures",
  {
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    signedAt: ts("signed_at").notNull(),
  },
  (t) => [primaryKey({ columns: [t.listingId, t.partyId] })],
);

// ---------------------------------------------------------------------------------------------
// C7: offers (S18). One open offer per listing; every seller answers through a single-use link.

export type OfferStatus = "SENT" | "ACCEPTED" | "REJECTED" | "EXPIRED";

export const offers = pgTable(
  "offers",
  {
    id: uuid("id").primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    status: text("status").$type<OfferStatus>().notNull().default("SENT"),
    /** Never changes: a revision is a new offer (trigger). */
    priceFils: fils("price_fils").notNull(),
    buyerMortgage: boolean("buyer_mortgage").notNull(),
    /** Fixed with the other terms (S39 amendment); required for an off-plan resale. */
    sellerMortgage: boolean("seller_mortgage").notNull().default(false),
    planTakenOver: boolean("plan_taken_over").notNull().default(false),
    targetTransferOn: calDate("target_transfer_on"),
    conditions: text("conditions"),
    /** The last day the sellers can answer (S39). */
    validUntil: calDate("valid_until").notNull(),
    /** The deal created when every seller accepted. */
    dealId: uuid("deal_id").references(() => deals.id),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("offers_status", oneOf(t.status, ["SENT", "ACCEPTED", "REJECTED", "EXPIRED"])),
    check("offers_price_positive", sql`${t.priceFils} > 0`),
    uniqueIndex("offers_one_open_uq")
      .on(t.listingId)
      .where(sql`${t.status} = 'SENT'`),
  ],
);

export const offerParties = pgTable(
  "offer_parties",
  {
    offerId: uuid("offer_id")
      .notNull()
      .references(() => offers.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    order: integer("order").notNull(),
    shareBps: integer("share_bps"),
  },
  (t) => [primaryKey({ columns: [t.offerId, t.order] })],
);

/** One answer link per seller: only the token's SHA-256 is stored; a link is used once. */
export const offerLinks = pgTable("offer_links", {
  tokenHash: text("token_hash").primaryKey(),
  offerId: uuid("offer_id")
    .notNull()
    .references(() => offers.id),
  sellerPartyId: uuid("seller_party_id")
    .notNull()
    .references(() => parties.id),
  answer: text("answer").$type<"accept" | "reject">(),
  answeredAt: ts("answered_at"),
});

// ---------------------------------------------------------------------------------------------
// C8: the resale deposit cheque and brokers (S18, S40).

export type DepositStatus = "held" | "handed_to_seller" | "returned_to_buyer";

/** The buyer's security deposit: a cheque in the seller's name held by the brokerage. Amount by code. */
export const deposits = pgTable(
  "deposits",
  {
    dealId: uuid("deal_id")
      .primaryKey()
      .references(() => deals.id),
    amountFils: fils("amount_fils").notNull(),
    /** Only the last four digits are kept. */
    chequeLast4: text("cheque_last4").notNull(),
    bank: text("bank").notNull(),
    chequeOn: calDate("cheque_on").notNull(),
    holder: text("holder").notNull(),
    status: text("status").$type<DepositStatus>().notNull().default("held"),
    recordedAt: ts("recorded_at").notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    check("deposits_status", oneOf(t.status, ["held", "handed_to_seller", "returned_to_buyer"])),
    check("deposits_amount_positive", sql`${t.amountFils} > 0`),
  ],
);

/** A broker per side (S18, confirm): agency, agent, RERA numbers, commission and who pays it. */
export const dealBrokers = pgTable(
  "deal_brokers",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    side: text("side").$type<"seller" | "buyer">().notNull(),
    agencyPartyId: uuid("agency_party_id")
      .notNull()
      .references(() => parties.id),
    agentName: text("agent_name").notNull(),
    orn: text("orn").notNull(),
    brn: text("brn").notNull(),
    commissionBps: integer("commission_bps").notNull(),
    /**
     * An override of the policy % is used only while this approval is an approved `price_out_of_range` for this deal,
     * this side and this %: the approval row says so, no copy of the status is kept (review 13).
     */
    commissionApprovalId: uuid("commission_approval_id").references(() => spaApprovals.id),
    payer: text("payer").$type<"seller" | "buyer">().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.side] }),
    check("deal_brokers_side", oneOf(t.side, ["seller", "buyer"])),
    check("deal_brokers_payer", oneOf(t.payer, ["seller", "buyer"])),
    check("deal_brokers_commission", sql`${t.commissionBps} between 0 and 10000`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C9: KYC configurations per party role (S19, S41).

/** One draft and numbered published versions per role and scope (`any` or a deal type). Published rows never change. */
export const spaKycConfigs = pgTable(
  "spa_kyc_configs",
  {
    id: uuid("id").primaryKey(),
    role: text("role").notNull(),
    /** `any`, or the deal type this config overrides. */
    scope: text("scope").notNull(),
    status: text("status").$type<"draft" | "published">().notNull(),
    version: integer("version"),
    values: jsonb("values").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    publishedAt: ts("published_at"),
  },
  (t) => [
    check(
      "spa_kyc_configs_role",
      oneOf(t.role, ["buyer_person", "seller_person", "company_party", "beneficial_owner"]),
    ),
    check("spa_kyc_configs_scope", oneOf(t.scope, ["any", "primary_offplan", "resale_ready", "resale_offplan"])),
    check("spa_kyc_configs_status", oneOf(t.status, ["draft", "published"])),
    check("spa_kyc_configs_version", sql`(${t.status} = 'draft') = (${t.version} is null)`),
    uniqueIndex("spa_kyc_configs_one_draft_uq")
      .on(t.role, t.scope)
      .where(sql`${t.status} = 'draft'`),
    uniqueIndex("spa_kyc_configs_version_uq").on(t.role, t.scope, t.version),
  ],
);

// ---------------------------------------------------------------------------------------------
// C10: AML policy versions and risk assessments (S20, S42). Risk rows are compliance-only reads (C29).

export const spaAmlPolicy = pgTable("spa_aml_policy", {
  version: integer("version").primaryKey(),
  values: jsonb("values").$type<Record<string, unknown>>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: ts("created_at").notNull(),
});

export const riskAssessments = pgTable(
  "risk_assessments",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    policyVersion: integer("policy_version").notNull(),
    rulesVersion: text("rules_version").notNull(),
    points: integer("points").notNull(),
    level: text("level").$type<"low" | "medium" | "high">().notNull(),
    flagged: boolean("flagged").notNull(),
    /** The hits and point breakdown: compliance-only (S6). */
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [check("risk_assessments_level", oneOf(t.level, ["low", "medium", "high"]))],
);

// ---------------------------------------------------------------------------------------------
// C13: named templates and their versions (S5, S45). A version leaves `in_review` only through `template_approval`;
// decided versions never change (trigger).

export const SPA_TEMPLATE_KINDS = ["spa", "mou", "assignment", "listing_agreement"] as const;
export const SPA_TEMPLATE_VERSION_STATUSES = ["in_review", "approved", "rejected", "retired"] as const;
export type SpaTemplateVersionStatus = (typeof SPA_TEMPLATE_VERSION_STATUSES)[number];

export const spaTemplates = pgTable(
  "spa_templates",
  {
    id: uuid("id").primaryKey(),
    name: text("name").notNull(),
    documentKind: text("document_kind").$type<(typeof SPA_TEMPLATE_KINDS)[number]>().notNull(),
    /** Project codes this template is for; empty = every project (P4b adds the projects table and the FK). */
    projectCodes: text("project_codes")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("spa_templates_kind", oneOf(t.documentKind, SPA_TEMPLATE_KINDS)),
    uniqueIndex("spa_templates_name_kind_uq").on(t.name, t.documentKind),
  ],
);

export const spaTemplateVersions = pgTable(
  "spa_template_versions",
  {
    id: uuid("id").primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => spaTemplates.id),
    version: integer("version").notNull(),
    docId: text("doc_id").notNull(),
    docHash: text("doc_hash").notNull(),
    sections: jsonb("sections").$type<Record<string, unknown>>().notNull(),
    blanks: jsonb("blanks").$type<Record<string, unknown>[]>().notNull(),
    look: jsonb("look").$type<Record<string, unknown>>().notNull(),
    partyBlocks: jsonb("party_blocks").$type<{ role: string; slots: number[] }[]>().notNull(),
    signatureRoles: jsonb("signature_roles").$type<Record<string, string | null>>().notNull(),
    checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull(),
    /** The sales rulebook the checks ran against (fee rate). */
    rulesVersion: text("rules_version").notNull(),
    status: text("status").$type<SpaTemplateVersionStatus>().notNull().default("in_review"),
    approvalId: uuid("approval_id").references(() => spaApprovals.id),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    check("spa_template_versions_status", oneOf(t.status, SPA_TEMPLATE_VERSION_STATUSES)),
    uniqueIndex("spa_template_versions_version_uq").on(t.templateId, t.version),
    uniqueIndex("spa_template_versions_one_approved_uq")
      .on(t.templateId)
      .where(sql`${t.status} = 'approved'`),
  ],
);

/** Where a template upload is on its way to a version (C34, S66). Moves forward only (trigger). */
export const TEMPLATE_UPLOAD_STATUSES = ["queued", "reading", "done", "failed", "needs_human"] as const;
export type TemplateUploadStatus = (typeof TEMPLATE_UPLOAD_STATUSES)[number];

/**
 * One uploaded sample agreement (C34, S66). One row per template and file hash, so a repeat upload returns the same row.
 * Only the status, the reason, the version it produced and the finish time ever change; rows are never deleted.
 */
export const templateUploads = pgTable(
  "template_uploads",
  {
    id: uuid("id").primaryKey(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => spaTemplates.id),
    docHash: text("doc_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    fileName: text("file_name").notNull(),
    status: text("status").$type<TemplateUploadStatus>().notNull().default("queued"),
    reason: text("reason"),
    versionId: uuid("version_id").references(() => spaTemplateVersions.id),
    /** The ticked box: this sample has no real customer data. Always true. */
    declaredNoRealData: boolean("declared_no_real_data").notNull(),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: ts("uploaded_at").notNull(),
    finishedAt: ts("finished_at"),
  },
  (t) => [
    check("template_uploads_status", oneOf(t.status, TEMPLATE_UPLOAD_STATUSES)),
    check("template_uploads_doc_hash", sql`${t.docHash} ~ '^[0-9a-f]{64}$'`),
    check("template_uploads_declared", sql`${t.declaredNoRealData} = true`),
    uniqueIndex("template_uploads_template_hash_uq").on(t.templateId, t.docHash),
  ],
);

// ---------------------------------------------------------------------------------------------
// C15: documents, the developer NOC and bank letters, entered by a person (S47).

export const DOCUMENT_KINDS = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "valuation",
  "final_offer",
  // C17 (S49): what the KYC reader reads. Person documents now; company documents and deeds are read in C20.
  "passport",
  "emirates_id_front",
  "emirates_id_back",
  "visa",
  "proof_of_address",
  "trade_licence",
  "title_deed",
  "oqood",
  "poa",
  "board_resolution",
  "memorandum",
  // C22 (S55): a buyer's transfer receipt, read by the document reader and checked against the escrow account.
  "payment_receipt",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];
/** The kinds the person KYC check reads (S49): uploaded for a party, on any deal type. */
export const PARTY_DOCUMENT_KINDS = [
  "passport",
  "emirates_id_front",
  "emirates_id_back",
  "visa",
  "proof_of_address",
] as const;
export const BANK_LETTER_KINDS = {
  seller: ["liability_letter", "release_letter"],
  buyer: ["pre_approval", "valuation", "final_offer"],
} as const;

/** An uploaded file's record. Append-only (trigger): a new upload supersedes an old one, never edits it. */
export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id").references(() => parties.id),
    kind: text("kind").$type<DocumentKind>().notNull(),
    fileName: text("file_name").notNull(),
    mime: text("mime").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    sha256: text("sha256").notNull(),
    storageKey: text("storage_key").notNull(),
    supersedesId: uuid("supersedes_id"),
    uploadedBy: text("uploaded_by").notNull(),
    uploadedAt: ts("uploaded_at").notNull(),
  },
  (t) => [
    index("documents_deal_idx").on(t.dealId, t.kind),
    check("documents_kind", oneOf(t.kind, DOCUMENT_KINDS)),
    check("documents_size", sql`${t.sizeBytes} > 0`),
  ],
);

export type NocRecordStatus = "matched" | "review" | "superseded";

/** The developer NOC a person entered. Only `status -> superseded` changes (trigger); a correction is a new row. */
export const nocRecords = pgTable(
  "noc_records",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    source: text("source").$type<"manual" | "reader">().notNull(),
    unitNo: text("unit_no").notNull(),
    sellerNames: text("seller_names").array().notNull(),
    issuedOn: calDate("issued_on").notNull(),
    expiresOn: calDate("expires_on").notNull(),
    serviceChargesCleared: boolean("service_charges_cleared").notNull(),
    /** Paid to the developer, off-plan resale: counts only with `paid_confirmed_by`. */
    paidFils: fils("paid_fils"),
    paidReadFils: fils("paid_read_fils"),
    paidConfirmedBy: uuid("paid_confirmed_by").references(() => spaUsers.id),
    status: text("status").$type<NocRecordStatus>().notNull(),
    mismatches: jsonb("mismatches").$type<string[]>().notNull().default([]),
    enteredBy: text("entered_by").notNull(),
    enteredAt: ts("entered_at").notNull(),
  },
  (t) => [
    check("noc_records_source", oneOf(t.source, ["manual", "reader"])),
    check("noc_records_status", oneOf(t.status, ["matched", "review", "superseded"])),
    check("noc_records_paid_confirmed", sql`${t.paidFils} is null or ${t.paidConfirmedBy} is not null`),
    check("noc_records_paid_positive", sql`${t.paidFils} is null or ${t.paidFils} >= 0`),
    uniqueIndex("noc_records_one_current_uq")
      .on(t.dealId)
      .where(sql`${t.status} <> 'superseded'`),
  ],
);

/** A bank letter on a resale with a mortgage (S15). An amount counts only once `confirmed_by` is set. */
export const bankLetters = pgTable(
  "bank_letters",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    side: text("side").$type<"seller" | "buyer">().notNull(),
    kind: text("kind").$type<Exclude<DocumentKind, "noc">>().notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    issuedOn: calDate("issued_on").notNull(),
    validUntil: calDate("valid_until"),
    /** Payoff or loan amount a person confirmed. Null until then. */
    amountFils: fils("amount_fils"),
    /** What the reader saw (C20) or the entering person typed before confirming: never used for a decision. */
    amountReadFils: fils("amount_read_fils"),
    confirmedBy: uuid("confirmed_by").references(() => spaUsers.id),
    confirmedAt: ts("confirmed_at"),
    status: text("status").$type<"current" | "superseded">().notNull().default("current"),
    enteredBy: text("entered_by").notNull(),
    enteredAt: ts("entered_at").notNull(),
  },
  (t) => [
    check("bank_letters_side", oneOf(t.side, ["seller", "buyer"])),
    check(
      "bank_letters_kind",
      sql`(${t.side} = 'seller' and ${t.kind} in ('liability_letter', 'release_letter')) or (${t.side} = 'buyer' and ${t.kind} in ('pre_approval', 'valuation', 'final_offer'))`,
    ),
    check("bank_letters_status", oneOf(t.status, ["current", "superseded"])),
    check(
      "bank_letters_amount_confirmed",
      sql`${t.amountFils} is null or (${t.confirmedBy} is not null and ${t.confirmedAt} is not null)`,
    ),
    check("bank_letters_amount_positive", sql`${t.amountFils} is null or ${t.amountFils} > 0`),
    uniqueIndex("bank_letters_one_current_uq")
      .on(t.dealId, t.kind)
      .where(sql`${t.status} = 'current'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C16: the transfer-day settlement statement (S48).

export type SettlementStatus = "proposed" | "approved" | "stale" | "superseded";
export const SETTLEMENT_STATUSES: readonly SettlementStatus[] = ["proposed", "approved", "stale", "superseded"];

/**
 * One statement version of a resale's transfer day, built by code from `settlementStatement` (S48). Its content never
 * changes (trigger); only `status` moves, and `approval_id` is set once. A `proposed` or `approved` version has price
 * lines that add up exactly to the deal's price (deferred constraint trigger).
 */
export const settlements = pgTable(
  "settlements",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    version: integer("version").notNull(),
    status: text("status").$type<SettlementStatus>().notNull(),
    rulesVersion: text("rules_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    /** The canonical inputs the statement was built from (price, deposit, confirmed letters, commissions, rule version). */
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    /** sha256 of the canonical inputs, the rulebook and policy versions and the letter row ids. */
    inputHash: text("input_hash").notNull(),
    priceFils: fils("price_fils").notNull(),
    buyerPaysFils: fils("buyer_pays_fils").notNull(),
    sellerReceivesFils: fils("seller_receives_fils").notNull(),
    approvalId: uuid("approval_id").references(() => spaApprovals.id),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    uniqueIndex("settlements_deal_version_uq").on(t.dealId, t.version),
    uniqueIndex("settlements_one_live_uq")
      .on(t.dealId)
      .where(sql`${t.status} in ('proposed', 'approved')`),
    check("settlements_status", oneOf(t.status, SETTLEMENT_STATUSES)),
    check("settlements_version_positive", sql`${t.version} > 0`),
    check("settlements_price_positive", sql`${t.priceFils} > 0`),
  ],
);

/** A line of a statement: who pays whom, how much, and where the amount came from. Insert-only (trigger). */
export const settlementLines = pgTable(
  "settlement_lines",
  {
    settlementId: uuid("settlement_id")
      .notNull()
      .references(() => settlements.id),
    seq: integer("seq").notNull(),
    code: text("code").notNull(),
    payer: text("payer").notNull(),
    payee: text("payee").notNull(),
    label: text("label").notNull(),
    amountFils: fils("amount_fils").notNull(),
    /** What the amount came from: the rule, "deal: price", a letter or a deposit. */
    source: text("source").notNull(),
    /** The letter, deposit or broker row the amount was read from, when there is one. */
    sourceRef: text("source_ref"),
  },
  (t) => [
    primaryKey({ columns: [t.settlementId, t.seq] }),
    check("settlement_lines_amount_positive", sql`${t.amountFils} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C17 (S49): helper runs, KYC runs and document requests.

/** One helper's answer about a record. Append-only (trigger); later helpers reuse this table. */
export const helperRuns = pgTable(
  "helper_runs",
  {
    id: uuid("id").primaryKey(),
    helper: text("helper").notNull(),
    dealId: uuid("deal_id").references(() => deals.id),
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    status: text("status").$type<"ok" | "needs_human">().notNull(),
    /** What the helper returned, without ID numbers. */
    result: jsonb("result").$type<Record<string, unknown>>().notNull(),
    reasons: jsonb("reasons").$type<string[]>().notNull(),
    modelTag: text("model_tag"),
    promptVersion: text("prompt_version"),
    rulesVersion: text("rules_version").notNull(),
    kycConfigVersion: integer("kyc_config_version"),
    amlPolicyVersion: integer("aml_policy_version"),
    visibility: text("visibility").$type<"staff" | "compliance">().notNull().default("staff"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("helper_runs_entity_idx").on(t.entityKind, t.entityId, t.createdAt),
    check("helper_runs_status", oneOf(t.status, ["ok", "needs_human"])),
    check("helper_runs_visibility", oneOf(t.visibility, ["staff", "compliance"])),
  ],
);

export type KycRunStatus = "passed" | "review" | "blocked" | "needs_human";
export type KycRunRole = "buyer_person" | "seller_person" | "beneficial_owner";
export const KYC_RUN_ROLES: readonly KycRunRole[] = ["buyer_person", "seller_person", "beneficial_owner"];

/**
 * One KYC check of one party, under the config version in force when it ran. Immutable (trigger). `identity` holds ID
 * numbers: it is never logged and never copied to events.
 */
export const kycRuns = pgTable(
  "kyc_runs",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    role: text("role").$type<KycRunRole>().notNull(),
    configScope: text("config_scope").notNull(),
    configVersion: integer("config_version").notNull(),
    status: text("status").$type<KycRunStatus>().notNull(),
    flags: jsonb("flags").$type<unknown[]>().notNull(),
    identity: jsonb("identity").$type<Record<string, unknown>>().notNull(),
    answers: jsonb("answers").$type<Record<string, string>>().notNull(),
    /** The earliest expiry among the documents read. A run no longer counts after it. */
    validUntil: calDate("valid_until"),
    /** Hash of the documents (and the config version) read: the same input is never read twice. */
    docsHash: text("docs_hash").notNull(),
    runId: uuid("run_id").references(() => helperRuns.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("kyc_runs_party_idx").on(t.dealId, t.partyId, t.createdAt),
    check("kyc_runs_status", oneOf(t.status, ["passed", "review", "blocked", "needs_human"])),
    check("kyc_runs_role", oneOf(t.role, KYC_RUN_ROLES)),
  ],
);

/** Documents were requested from a party for a deal (one row each). The config version is the one that applied. */
export const documentRequests = pgTable(
  "document_requests",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    kycRole: text("kyc_role").notNull(),
    configScope: text("config_scope").notNull(),
    configVersion: integer("config_version").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("document_requests_deal_party_uq").on(t.dealId, t.partyId),
    check(
      "document_requests_role",
      oneOf(t.kycRole, ["buyer_person", "seller_person", "company_party", "beneficial_owner"]),
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// C18 (S50): AML screening. Compliance-only tables: no route outside the compliance roles reads them (tipping-off, S6).

export const SCREENING_TRIGGERS = [
  "offer",
  "before_agreement",
  "before_transfer",
  "party_change",
  "periodic",
  "manual",
] as const;
export type ScreeningTrigger = (typeof SCREENING_TRIGGERS)[number];
export const AML_HIT_RULES = [
  "sanctions",
  "pep",
  "third_party_payer",
  "cash",
  "high_risk_country",
  "missing_source_of_funds",
  "complex_ownership",
  "not_screened",
  "unconfirmed",
] as const;
export type AmlHitRule = (typeof AML_HIT_RULES)[number];
export const AML_CASE_STATUSES = ["open", "info_requested", "cleared", "stopped", "reported"] as const;
export type AmlCaseStatus = (typeof AML_CASE_STATUSES)[number];

/**
 * One party, company, beneficial owner or non-party payer screened against the lists. Append-only (trigger). A payer
 * who is not a party has no `party_id`; `subject_key` is the party id, or `payer:<normalised name>`. Null scores mean
 * "not screened" (the service failed). `matches` holds the list entries found and the hits code evaluated.
 */
export const screenings = pgTable(
  "screenings",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id").references(() => parties.id),
    subjectKey: text("subject_key").notNull(),
    trigger: text("trigger").$type<ScreeningTrigger>().notNull(),
    listVersion: text("list_version").notNull(),
    sanctionsScore: doublePrecision("sanctions_score"),
    pepScore: doublePrecision("pep_score"),
    exact: boolean("exact").notNull(),
    matches: jsonb("matches").$type<Record<string, unknown>>().notNull(),
    screenedAt: ts("screened_at").notNull(),
  },
  (t) => [
    index("screenings_deal_idx").on(t.dealId, t.subjectKey, t.screenedAt),
    check("screenings_trigger", oneOf(t.trigger, SCREENING_TRIGGERS)),
  ],
);

/** A flag's case. Its status moves only through the `aml_flag` decision (trigger keeps every other column fixed). */
export const amlCases = pgTable(
  "aml_cases",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    status: text("status").$type<AmlCaseStatus>().notNull(),
    approvalId: uuid("approval_id").references(() => spaApprovals.id),
    /** Compliance-only wording: a model's, or the code template. Never a decision. */
    summary: text("summary").notNull(),
    summaryModel: text("summary_model"),
    /** A name read like an instruction to a model. Shown to compliance only. */
    instructionLike: boolean("instruction_like").notNull(),
    openedAt: ts("opened_at").notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    index("aml_cases_deal_idx").on(t.dealId, t.status),
    check("aml_cases_status", oneOf(t.status, AML_CASE_STATUSES)),
  ],
);

/** One hit of one code rule on a case. Append-only (trigger). */
export const amlHits = pgTable(
  "aml_hits",
  {
    id: uuid("id").primaryKey(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => amlCases.id),
    partyId: uuid("party_id").references(() => parties.id),
    subjectKey: text("subject_key").notNull(),
    rule: text("rule").$type<AmlHitRule>().notNull(),
    severity: text("severity").$type<"flag" | "warning">().notNull(),
    detail: text("detail").notNull(),
    listVersion: text("list_version").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("aml_hits_case_idx").on(t.caseId),
    check("aml_hits_rule", oneOf(t.rule, AML_HIT_RULES)),
    check("aml_hits_severity", oneOf(t.severity, ["flag", "warning"])),
  ],
);

// ---------------------------------------------------------------------------------------------
// C19: the prepared agreement and the payment plan rows it prints (S51).

export type AgreementStatus = "prepared" | "in_review" | "approved" | "superseded";
export const AGREEMENT_STATUSES: readonly AgreementStatus[] = ["prepared", "in_review", "approved", "superseded"];

/**
 * One payment plan row of a deal, typed by sales and checked by the rulebook's `validatePlan` (S51). Money is integer
 * fils. The rows are fixed once an agreement that prints them is live (checked by the Manager).
 */
export const paymentPlanRows = pgTable(
  "payment_plan_rows",
  {
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    seq: integer("seq").notNull(),
    label: text("label").notNull(),
    dueOn: calDate("due_on"),
    /** A row with no date is due at a milestone ("On completion of the structure"). */
    milestone: text("milestone"),
    amountFils: fils("amount_fils").notNull(),
    enteredBy: text("entered_by").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.dealId, t.seq] }),
    check("payment_plan_rows_amount_positive", sql`${t.amountFils} > 0`),
    check("payment_plan_rows_when", sql`${t.dueOn} is not null or ${t.milestone} is not null`),
  ],
);

/**
 * One prepared version of a deal's agreement (SPA, MOU or assignment, S51). The content columns never change
 * (trigger); only `status` moves forward and `approval_id` is set once. `field_sources` says where every printed value
 * came from (never the value itself); `values_hash` is the hash of the inputs, so a changed deal makes it stale.
 */
export const agreements = pgTable(
  "agreements",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    kind: text("kind").$type<(typeof SPA_TEMPLATE_KINDS)[number]>().notNull(),
    version: integer("version").notNull(),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => spaTemplateVersions.id),
    status: text("status").$type<AgreementStatus>().notNull(),
    /** sha256 of the PDF bytes. */
    docHash: text("doc_hash").notNull(),
    storageKey: text("storage_key").notNull(),
    valuesHash: text("values_hash").notNull(),
    fieldSources: jsonb("field_sources").$type<Record<string, string>>().notNull(),
    rulesVersion: text("rules_version").notNull(),
    policyVersion: integer("policy_version").notNull(),
    approvalId: uuid("approval_id").references(() => spaApprovals.id),
    preparedBy: text("prepared_by").notNull(),
    preparedAt: ts("prepared_at").notNull(),
  },
  (t) => [
    check("agreements_kind", oneOf(t.kind, SPA_TEMPLATE_KINDS)),
    check("agreements_status", oneOf(t.status, AGREEMENT_STATUSES)),
    check("agreements_version_positive", sql`${t.version} > 0`),
    uniqueIndex("agreements_version_uq").on(t.dealId, t.kind, t.version),
    uniqueIndex("agreements_one_live_uq")
      .on(t.dealId, t.kind)
      .where(sql`${t.status} <> 'superseded'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C20 (S52): what the document readers saw, and the company checks built from it.

/** Every profile the document reader reads. `sof_evidence` and `edd` are read only (no gate uses them yet). */
export const DOCUMENT_READ_PROFILES = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "final_offer",
  "sof_evidence",
  "edd",
  "trade_licence",
  "moa",
  "poa",
  "board_resolution",
  "title_deed",
  "oqood",
  "payment_receipt",
] as const;
export type DocumentReadProfile = (typeof DOCUMENT_READ_PROFILES)[number];

/**
 * What the reader copied off one document: `{value, confidence}` per field, exactly as printed. Immutable (trigger).
 * It holds no confirmation: an amount counts only as `amount_fils` with `confirmed_by` (S47). One read per document and
 * prompt version.
 */
export const documentReads = pgTable(
  "document_reads",
  {
    id: uuid("id").primaryKey(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    profile: text("profile").$type<DocumentReadProfile>().notNull(),
    fields: jsonb("fields").$type<Record<string, unknown>>().notNull(),
    modelTag: text("model_tag"),
    promptVersion: text("prompt_version").notNull(),
    /** Text on the document read like an instruction to the model. Flagged only; nothing else changes. */
    instructionFound: boolean("instruction_found").notNull().default(false),
    runId: uuid("run_id")
      .notNull()
      .references(() => helperRuns.id),
    readAt: ts("read_at").notNull(),
  },
  (t) => [
    check("document_reads_profile", oneOf(t.profile, DOCUMENT_READ_PROFILES)),
    uniqueIndex("document_reads_once_uq").on(t.documentId, t.promptVersion),
  ],
);

export type CompanyCheckStatus = "passed" | "review" | "needs_human";
export const COMPANY_CHECK_STATUSES: readonly CompanyCheckStatus[] = ["passed", "review", "needs_human"];

/** One company check of one company party (S52). Immutable (trigger): a new check is a new row. */
export const companyChecks = pgTable(
  "company_checks",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    status: text("status").$type<CompanyCheckStatus>().notNull(),
    licenceExpiresOn: calDate("licence_expires_on"),
    signerOk: boolean("signer_ok").notNull(),
    /** Shareholders at or above the rulebook threshold: name, bps, whether recorded as a beneficial owner. */
    owners: jsonb("owners").$type<unknown[]>().notNull(),
    /** Ownership layers code could not resolve; the AML rule counts them. */
    layers: integer("layers").notNull(),
    findings: jsonb("findings").$type<unknown[]>().notNull(),
    /** Hash of the company documents read: the same documents are never checked twice (an addition to the plan). */
    docsHash: text("docs_hash").notNull(),
    runId: uuid("run_id").references(() => helperRuns.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("company_checks_party_idx").on(t.dealId, t.partyId, t.createdAt),
    check("company_checks_status", oneOf(t.status, COMPANY_CHECK_STATUSES)),
    check("company_checks_layers", sql`${t.layers} >= 0`),
  ],
);

export const REGISTRATION_STATUSES = ["submitted", "issued", "rejected", "unavailable"] as const;
export type RegistrationStatus = (typeof REGISTRATION_STATUSES)[number];

/**
 * One attempt to register a deal with the registry (C27, S53): Oqood registration, Oqood transfer or trustee transfer.
 * Insert-only (trigger): the attempt, its request id, the answer and the approved gate it ran under are evidence. A
 * number counts only as an `issued` row; there is one per deal and kind. The approval is NOT NULL and must be an
 * approved gate of the right kind for the same deal, whatever the row says (trigger).
 */
export const registrations = pgTable(
  "registrations",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    kind: text("kind").$type<RegistryKind>().notNull(),
    attempt: integer("attempt").notNull(),
    /** `<dealId>:<kind>:<attempt>`: the registry gives the same answer to the same id. */
    requestId: text("request_id").notNull(),
    status: text("status").$type<RegistrationStatus>().notNull(),
    registryNo: text("registry_no"),
    issuedOn: calDate("issued_on"),
    reasons: jsonb("reasons").$type<RegistryRejection[]>().notNull(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => spaApprovals.id),
    /** sha256 of the payload sent (the payload holds ID numbers and is not stored). */
    payloadHash: text("payload_hash").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    // An "unavailable" answer is not an answer: the same attempt is tried again under the same request id (C21, S56),
    // each try a new insert-only row. Once the registry answered, nothing answers that attempt or request id again.
    uniqueIndex("registrations_deal_kind_attempt_uq")
      .on(t.dealId, t.kind, t.attempt)
      .where(sql`${t.status} <> 'unavailable'`),
    uniqueIndex("registrations_request_id_uq")
      .on(t.requestId)
      .where(sql`${t.status} <> 'unavailable'`),
    uniqueIndex("registrations_one_issued_uq")
      .on(t.dealId, t.kind)
      .where(sql`${t.status} = 'issued'`),
    check("registrations_kind", oneOf(t.kind, REGISTRY_KINDS)),
    check("registrations_status", oneOf(t.status, REGISTRATION_STATUSES)),
    check(
      "registrations_issued_needs_number",
      sql`${t.status} <> 'issued' or (${t.registryNo} is not null and ${t.issuedOn} is not null)`,
    ),
    check("registrations_attempt_positive", sql`${t.attempt} > 0`),
  ],
);

export const REGISTRY_REJECTION_SOURCES = ["code", "model"] as const;
export const REGISTRY_REJECTION_ACTIONS = ["fixed", "retry", "task"] as const;
export type RegistryRejectionAction = (typeof REGISTRY_REJECTION_ACTIONS)[number];

/**
 * What the `registry` helper made of one rejected attempt (C21, S56): the codes the registry gave, the field they were
 * mapped to (by a code table, else by the decision model, with its confidence) and what code then did: `fixed` (one
 * name-spelling fix, resubmitted under a new request id), `retry` or `task` (a person decides). One row per rejected
 * registration; append-only (trigger). No registry text and no name is stored.
 */
export const registryRejections = pgTable(
  "registry_rejections",
  {
    id: uuid("id").primaryKey(),
    registrationId: uuid("registration_id")
      .notNull()
      .references(() => registrations.id),
    codes: text("codes").array().notNull(),
    mappedField: text("mapped_field"),
    mappedConfidence: numeric("mapped_confidence", { precision: 3, scale: 2 }),
    source: text("source").$type<"code" | "model">().notNull(),
    action: text("action").$type<RegistryRejectionAction>().notNull(),
    taskId: uuid("task_id").references(() => spaTasks.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("registry_rejections_registration_uq").on(t.registrationId),
    check("registry_rejections_source", oneOf(t.source, REGISTRY_REJECTION_SOURCES)),
    check("registry_rejections_action", oneOf(t.action, REGISTRY_REJECTION_ACTIONS)),
    check(
      "registry_rejections_confidence",
      sql`${t.mappedConfidence} is null or (${t.mappedConfidence} >= 0 and ${t.mappedConfidence} <= 1)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// C28 (S54): outbound mail evidence and signing.

export const OUTBOUND_PURPOSES = ["link", "reminder", "receipt", "notice"] as const;
export type OutboundPurpose = (typeof OUTBOUND_PURPOSES)[number];
export const OUTBOUND_STATUSES = ["sending", "sent", "failed"] as const;
export type OutboundStatus = (typeof OUTBOUND_STATUSES)[number];

/**
 * Every email the SPA module sends (rule 10), stored as evidence: who it was meant for, which template and version,
 * the hash of the body and of each attachment, the mail server's answer. One row per (entity, purpose, milestone): the
 * row is claimed before sending, so a mail already sent is never sent twice. Only the send-result columns change, and a
 * sent row is final (trigger). The raw link in a body is never stored: only the body's hash.
 */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: uuid("id").primaryKey(),
    entityKind: text("entity_kind").notNull(),
    entityId: uuid("entity_id").notNull(),
    purpose: text("purpose").$type<OutboundPurpose>().notNull(),
    milestone: text("milestone").notNull(),
    /** Where the mail went (after a demo redirect, the redirect inbox). */
    toEmail: text("to_email").notNull(),
    /** Who it was meant for. */
    intendedTo: text("intended_to").notNull(),
    template: text("template").notNull(),
    templateVersion: integer("template_version").notNull(),
    subject: text("subject").notNull(),
    bodySha256: text("body_sha256"),
    attachmentSha256s: text("attachment_sha256s")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    status: text("status").$type<OutboundStatus>().notNull().default("sending"),
    messageId: text("message_id"),
    smtpResponse: text("smtp_response"),
    previewUrl: text("preview_url"),
    error: text("error"),
    sentAt: ts("sent_at"),
    createdAt: ts("created_at").notNull(),
    /** When the row was last claimed for sending (S54 amendment): a `sending` row older than the timeout may be claimed again. */
    claimedAt: ts("claimed_at"),
  },
  (t) => [
    uniqueIndex("outbound_messages_once_uq").on(t.entityId, t.purpose, t.milestone),
    check("outbound_messages_purpose", oneOf(t.purpose, OUTBOUND_PURPOSES)),
    check("outbound_messages_status", oneOf(t.status, OUTBOUND_STATUSES)),
  ],
);

export const ENVELOPE_STATUSES = ["open", "complete", "superseded"] as const;
export type EnvelopeStatus = (typeof ENVELOPE_STATUSES)[number];
export const SIGNATURE_ROLES = ["purchaser", "broker", "seller"] as const;
export type SignatureRole = (typeof SIGNATURE_ROLES)[number];

/**
 * The signing of one approved agreement (S54). `doc_hash` is the hash of the approved PDF every signer is shown; when
 * the last signer signs, the stamped PDF is stored and its hash goes to `signed_doc_hash`. One open envelope per
 * agreement; the agreement must be the deal's own `approved` one with the same hash (trigger).
 */
export const signingEnvelopes = pgTable(
  "signing_envelopes",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    docHash: text("doc_hash").notNull(),
    status: text("status").$type<EnvelopeStatus>().notNull().default("open"),
    signedDocHash: text("signed_doc_hash"),
    storageKey: text("storage_key"),
    createdAt: ts("created_at").notNull(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    check("signing_envelopes_status", oneOf(t.status, ENVELOPE_STATUSES)),
    check(
      "signing_envelopes_complete_needs",
      sql`${t.status} <> 'complete' or (${t.signedDocHash} is not null and ${t.storageKey} is not null and ${t.completedAt} is not null)`,
    ),
    uniqueIndex("signing_envelopes_one_open_uq")
      .on(t.agreementId)
      .where(sql`${t.status} = 'open'`),
    index("signing_envelopes_deal_idx").on(t.dealId),
  ],
);

/**
 * One signer's turn (S54). Only the SHA-256 of the emailed link's token is kept (the token exists only in the email).
 * `seq` is the signing order (buyers, broker, seller); a row can be signed only after every lower `seq` (trigger).
 */
export const signatures = pgTable(
  "signatures",
  {
    id: uuid("id").primaryKey(),
    envelopeId: uuid("envelope_id")
      .notNull()
      .references(() => signingEnvelopes.id),
    seq: integer("seq").notNull(),
    role: text("role").$type<SignatureRole>().notNull(),
    /** The party who answers for this line (a company's line is signed by its signatory, who is the person party). */
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    nameOnAgreement: text("name_on_agreement").notNull(),
    email: text("email").notNull(),
    linkTokenHash: text("link_token_hash").notNull().unique(),
    linkExpiresAt: ts("link_expires_at").notNull(),
    linkUsedAt: ts("link_used_at"),
    signedAt: ts("signed_at"),
    typedName: text("typed_name"),
    consent: boolean("consent"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    /** Where this signer's line is on the PDF (the C14 anchor), or `{}` when the template has none for the role. */
    anchor: jsonb("anchor").$type<Record<string, unknown>>().notNull(),
  },
  (t) => [
    uniqueIndex("signatures_envelope_seq_uq").on(t.envelopeId, t.seq),
    check("signatures_role", oneOf(t.role, SIGNATURE_ROLES)),
    check(
      "signatures_signed_complete",
      sql`${t.signedAt} is null or (${t.typedName} is not null and ${t.consent} is true and ${t.linkUsedAt} is not null)`,
    ),
  ],
);

// ---------------------------------------------------------------------------------------------
// C22: escrow accounts, payments and tasks (S55).

/**
 * The escrow account a project's buyers pay into, typed by an admin (S55). Append-only: a change supersedes the row and
 * adds a new one (trigger). One current row per project. A payment counts only into the project's current account.
 */
export const projectEscrowAccounts = pgTable(
  "project_escrow_accounts",
  {
    id: uuid("id").primaryKey(),
    projectCode: text("project_code").notNull(),
    accountHolder: text("account_holder").notNull(),
    /** Normalised: upper case, no spaces. `AE` plus 21 digits, mod-97 checked by code before it is stored. */
    iban: text("iban").notNull(),
    bankName: text("bank_name").notNull(),
    enteredBy: text("entered_by").notNull(),
    validFrom: ts("valid_from").notNull(),
    supersededAt: ts("superseded_at"),
  },
  (t) => [
    check("project_escrow_accounts_iban", sql`${t.iban} ~ '^AE[0-9]{21}$'`),
    uniqueIndex("project_escrow_accounts_current_uq")
      .on(t.projectCode)
      .where(sql`${t.supersededAt} is null`),
  ],
);

export type PaymentStatus = "read" | "counted" | "not_counted" | "needs_review";
export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["read", "counted", "not_counted", "needs_review"];
export type PaymentMethod = "transfer" | "cheque" | "cash" | "card" | "other";
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["transfer", "cheque", "cash", "card", "other"];

/**
 * One buyer payment against one plan row (S55). The reader's amount is `amount_read_fils` and never counts: a payment is
 * `counted` only with a finance person's `amount_fils` and `confirmed_by`, and only into the escrow account (CHECK). A row
 * is inserted unconfirmed and changes once, through `counted` (trigger); it is never deleted.
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    /** The plan row this payment is for. */
    seq: integer("seq").notNull(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id),
    readId: uuid("read_id")
      .notNull()
      .references(() => documentReads.id),
    status: text("status").$type<PaymentStatus>().notNull(),
    /** How it was paid. Cash feeds the AML cash rule (S55). */
    method: text("method").$type<PaymentMethod>().notNull(),
    amountReadFils: fils("amount_read_fils"),
    amountFils: fils("amount_fils"),
    paidOn: calDate("paid_on"),
    payerNameRead: text("payer_name_read"),
    /** The buyer the payer name matched, else null. */
    payerPartyId: uuid("payer_party_id").references(() => parties.id),
    /** Only the first and last digits of the account the receipt names. */
    accountReadMasked: text("account_read_masked"),
    intoEscrow: boolean("into_escrow").notNull(),
    payerIsBuyer: boolean("payer_is_buyer").notNull(),
    /** Why a row isn't simply waiting for finance: `not_escrow`, `no_escrow_account`, `account_unreadable`, `payer_review`, `instruction_found`. */
    reasonCode: text("reason_code"),
    registeredBy: text("registered_by").notNull(),
    createdAt: ts("created_at").notNull(),
    confirmedBy: text("confirmed_by"),
    confirmedAt: ts("confirmed_at"),
  },
  (t) => [
    foreignKey({
      name: "payments_plan_row_fk",
      columns: [t.dealId, t.seq],
      foreignColumns: [paymentPlanRows.dealId, paymentPlanRows.seq],
    }),
    check("payments_status", oneOf(t.status, PAYMENT_STATUSES)),
    check("payments_method", oneOf(t.method, PAYMENT_METHODS)),
    check("payments_amount_read_positive", sql`${t.amountReadFils} is null or ${t.amountReadFils} > 0`),
    check("payments_amount_positive", sql`${t.amountFils} is null or ${t.amountFils} > 0`),
    check("payments_amount_needs_confirmer", sql`${t.amountFils} is null or ${t.confirmedBy} is not null`),
    check("payments_confirmation_pair", sql`(${t.confirmedBy} is null) = (${t.confirmedAt} is null)`),
    check(
      "payments_counted_needs_confirmation",
      sql`${t.status} <> 'counted' or (${t.amountFils} is not null and ${t.confirmedBy} is not null and ${t.intoEscrow})`,
    ),
    uniqueIndex("payments_document_uq").on(t.documentId),
    index("payments_deal_idx").on(t.dealId, t.seq),
  ],
);

export type TaskKind =
  | "payment_not_escrow"
  | "payment_review"
  | "confirm_amount"
  | "default_flagged"
  | "milestone_reached"
  | "registry_rejected"
  | "registry_unavailable"
  | "instalment_overdue"
  | "helper_off"
  | "helper_rejected"
  | "chase_overdue"
  | "copilot_task";
export const TASK_KINDS: readonly TaskKind[] = [
  "payment_not_escrow",
  "payment_review",
  "confirm_amount",
  "default_flagged",
  "milestone_reached",
  "registry_rejected",
  "registry_unavailable",
  "instalment_overdue",
  "helper_off",
  "helper_rejected",
  "chase_overdue",
  "copilot_task",
];
export type TaskStatus = "open" | "done" | "cancelled";

/**
 * A job for a role (S55): general, for every later chunk. One open task per `dedupe_key`; only `status`, `done_at` and
 * `done_by` change, once (trigger). `detail` holds ids and codes, never personal data, and the wording never mentions
 * a compliance review.
 */
export const spaTasks = pgTable(
  "spa_tasks",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id").references(() => deals.id),
    kind: text("kind").$type<TaskKind>().notNull(),
    role: text("role").$type<SpaRole>().notNull(),
    title: text("title").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
    status: text("status").$type<TaskStatus>().notNull().default("open"),
    dedupeKey: text("dedupe_key").notNull(),
    createdAt: ts("created_at").notNull(),
    doneAt: ts("done_at"),
    doneBy: text("done_by"),
  },
  (t) => [
    check("spa_tasks_kind", oneOf(t.kind, TASK_KINDS)),
    check("spa_tasks_role", oneOf(t.role, ROLES)),
    check("spa_tasks_status", oneOf(t.status, ["open", "done", "cancelled"])),
    check(
      "spa_tasks_done_needs_who",
      sql`${t.status} = 'open' or (${t.doneAt} is not null and ${t.doneBy} is not null)`,
    ),
    uniqueIndex("spa_tasks_open_dedupe_uq")
      .on(t.dedupeKey)
      .where(sql`${t.status} = 'open'`),
    index("spa_tasks_role_idx").on(t.role, t.status),
  ],
);

// ---------------------------------------------------------------------------------------------
// C24 (S59): helper modes and review holds.

/**
 * How each switchable helper runs (S22, S59): one row per version of a (helper, scope), the latest is in force. Append-only
 * (trigger): a change is a new version, never an edit. The database refuses a helper that is not switchable (AML
 * screening, settlement, the chaser, collections), so a mode can't be set for one by any route.
 */
export const spaHelperSettings = pgTable(
  "spa_helper_settings",
  {
    helper: text("helper").notNull(),
    /** `*`, or for the document reader the document kind. A kind's version overrides `*` for that kind. */
    scope: text("scope").notNull().default("*"),
    version: integer("version").notNull(),
    mode: text("mode").$type<HelperMode>().notNull(),
    setBy: text("set_by").notNull(),
    setAt: ts("set_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.helper, t.scope, t.version] }),
    check("spa_helper_settings_helper", oneOf(t.helper, SWITCHABLE_HELPERS)),
    check("spa_helper_settings_mode", oneOf(t.mode, HELPER_MODES)),
    check("spa_helper_settings_scope", sql`length(${t.scope}) > 0`),
    check("spa_helper_settings_version", sql`${t.version} >= 1`),
  ],
);

export type HelperHoldStatus = "pending" | "released" | "rejected";

/**
 * An `ok` helper result held for a person (review mode, S22, S59). One per run. A held result does not count for any
 * fact until a sales officer (or the manager standing in) releases it through `helper_review`. A rejected hold stays
 * closed: the result never counts. Only `status` and `decided_at` change, once (trigger).
 */
export const helperReviewHolds = pgTable(
  "helper_review_holds",
  {
    runId: uuid("run_id")
      .primaryKey()
      .references(() => helperRuns.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => spaApprovals.id),
    status: text("status").$type<HelperHoldStatus>().notNull().default("pending"),
    createdAt: ts("created_at").notNull(),
    decidedAt: ts("decided_at"),
  },
  (t) => [
    check("helper_review_holds_status", oneOf(t.status, ["pending", "released", "rejected"])),
    check("helper_review_holds_decided", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
    index("helper_review_holds_deal_idx").on(t.dealId, t.status),
    uniqueIndex("helper_review_holds_approval_uq").on(t.approvalId),
  ],
);

/** `T-14`, `T-3`, `T+1`: days before (`T-`) or after (`T+`) a plan row's due date, from the policy. */
export type ReminderMilestone = `T${"-" | "+"}${number}`;

/**
 * One instalment reminder sent for one dated plan row (C21, S56): before the due date (`T-14`, `T-3`) or the day after
 * (`T+1`). Unique per deal, plan row and milestone, so each reminder goes once. Insert-only (trigger). It points at the
 * stored mail (`outbound_messages`), which holds the evidence; nothing here is personal data.
 */
export const collectionReminders = pgTable(
  "collection_reminders",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    planSeq: integer("plan_seq").notNull(),
    milestone: text("milestone").$type<ReminderMilestone>().notNull(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id),
    sentAt: ts("sent_at").notNull(),
  },
  (t) => [
    foreignKey({
      name: "collection_reminders_plan_row_fk",
      columns: [t.dealId, t.planSeq],
      foreignColumns: [paymentPlanRows.dealId, paymentPlanRows.seq],
    }),
    uniqueIndex("collection_reminders_once_uq").on(t.dealId, t.planSeq, t.milestone),
    // `T-<days>` before the due date, `T+<days>` after it: the policy sets the days (S56).
    check("collection_reminders_milestone", sql`${t.milestone} ~ '^T[+-][0-9]{1,3}$'`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C25 (S60): agreement review flags, chase templates, chases and pauses.

/**
 * What `agreement-review` found in one agreement (S60): advice for legal, never a decision. One row per agreement and prompt
 * version; immutable (trigger). `dropped` counts model flags the quote guard removed.
 */
export const agreementReviews = pgTable(
  "agreement_reviews",
  {
    id: uuid("id").primaryKey(),
    agreementId: uuid("agreement_id")
      .notNull()
      .references(() => agreements.id),
    flags: jsonb("flags").$type<AgreementFlag[]>().notNull(),
    dropped: integer("dropped").notNull(),
    modelTag: text("model_tag"),
    promptVersion: text("prompt_version").notNull(),
    /** The conditions text, or the agreement, read like an order to a model. Staff see this only. */
    instructionFound: boolean("instruction_found").notNull(),
    runId: uuid("run_id").references(() => helperRuns.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("agreement_reviews_once_uq").on(t.agreementId, t.promptVersion),
    check("agreement_reviews_dropped", sql`${t.dropped} >= 0`),
  ],
);

export const CHASE_TEMPLATE_KINDS = ["chase"] as const;
export const CHASE_TEMPLATE_STATUSES = ["draft", "approved", "retired"] as const;
export type ChaseTemplateStatus = (typeof CHASE_TEMPLATE_STATUSES)[number];

/**
 * A chase email an admin wrote (S23, S60). Draft, then approved by an admin, then retired when a newer one is approved. An
 * approved row never changes except to `retired` (trigger). Only the placeholders in `@spa/core` are allowed, and no AML
 * word: checked on save and on approval.
 */
export const chaseTemplates = pgTable(
  "chase_templates",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").notNull(),
    version: integer("version").notNull(),
    subject: text("subject").notNull(),
    body: text("body").notNull(),
    status: text("status").$type<ChaseTemplateStatus>().notNull().default("draft"),
    createdBy: text("created_by").notNull(),
    approvedBy: text("approved_by"),
    approvedAt: ts("approved_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("chase_templates_kind_version_uq").on(t.kind, t.version),
    check("chase_templates_kind", oneOf(t.kind, CHASE_TEMPLATE_KINDS)),
    check("chase_templates_status", oneOf(t.status, CHASE_TEMPLATE_STATUSES)),
    check("chase_templates_version", sql`${t.version} >= 1`),
    check(
      "chase_templates_approved_who",
      sql`${t.status} = 'draft' or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
  ],
);

/**
 * One chase sent for one item of one party at one step (`0` at the request, then one per policy reminder day). Unique per
 * party, item and step, insert-only (trigger). It points at the stored mail (`outbound_messages`) and keeps the template
 * version, the subject and the hash of the body the code filled in. `reason_code` is from the fixed list: never a
 * reason that names a review.
 */
export const chases = pgTable(
  "chases",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    itemKey: text("item_key").notNull(),
    reasonCode: text("reason_code").notNull(),
    step: integer("step").notNull(),
    templateId: uuid("template_id")
      .notNull()
      .references(() => chaseTemplates.id),
    templateVersion: integer("template_version").notNull(),
    subject: text("subject").notNull(),
    bodySha256: text("body_sha256").notNull(),
    outboundMessageId: uuid("outbound_message_id")
      .notNull()
      .references(() => outboundMessages.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("chases_once_uq").on(t.partyId, t.itemKey, t.step),
    index("chases_deal_idx").on(t.dealId, t.createdAt),
    check("chases_reason", oneOf(t.reasonCode, CHASE_REASON_CODES)),
    check("chases_step", sql`${t.step} >= 0`),
  ],
);

/** An agent paused chasing on a deal (S60). One open pause per deal; only `resumed_at` changes, once (trigger). */
export const chasePauses = pgTable(
  "chase_pauses",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    pausedBy: text("paused_by").notNull(),
    pausedAt: ts("paused_at").notNull(),
    resumedAt: ts("resumed_at"),
    resumedBy: text("resumed_by"),
  },
  (t) => [
    uniqueIndex("chase_pauses_one_open_uq")
      .on(t.dealId)
      .where(sql`${t.resumedAt} is null`),
    index("chase_pauses_deal_idx").on(t.dealId, t.pausedAt),
  ],
);

// ---------------------------------------------------------------------------------------------
// C26 (S61): assistants. Three chat assistants (party, listing page, template) read, draft and propose; nothing here is
// a state the SpaManager owns. Every conversation is stored, masked; a proposal is only ever applied by a person's click.

export const ASSISTANT_KINDS = ["party", "listing", "template", "staff"] as const;
export type AssistantKind = (typeof ASSISTANT_KINDS)[number];
export const ASSISTANT_ROLES = ["user", "assistant", "tool"] as const;
export const ASSISTANT_PROPOSAL_KINDS = ["remap_blank", "rename_placeholder"] as const;
export type AssistantProposalKind = (typeof ASSISTANT_PROPOSAL_KINDS)[number];
export const ASSISTANT_PROPOSAL_STATUSES = ["proposed", "applied", "dismissed"] as const;
export type AssistantProposalStatus = (typeof ASSISTANT_PROPOSAL_STATUSES)[number];

/** One conversation. `subject_id` is the deal and party (party), the listing ref (listing) or the template version (template); `principal_hash` is a hash of the token, user or client key, never the value. */
export const assistantThreads = pgTable(
  "assistant_threads",
  {
    id: uuid("id").primaryKey(),
    kind: text("kind").$type<AssistantKind>().notNull(),
    subjectId: text("subject_id").notNull(),
    principalHash: text("principal_hash").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("assistant_threads_kind", oneOf(t.kind, ASSISTANT_KINDS)),
    index("assistant_threads_subject_idx").on(t.kind, t.subjectId, t.principalHash),
  ],
);

/** Append-only (trigger). `content` is masked before it is stored. */
export const assistantMessages = pgTable(
  "assistant_messages",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    role: text("role").$type<"user" | "assistant" | "tool">().notNull(),
    content: text("content").notNull(),
    toolName: text("tool_name"),
    verified: boolean("verified").notNull().default(true),
    unverifiedValues: jsonb("unverified_values")
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    scopeBlocked: boolean("scope_blocked").notNull().default(false),
    modelTag: text("model_tag"),
    at: ts("at").notNull(),
  },
  (t) => [
    check("assistant_messages_role", oneOf(t.role, ASSISTANT_ROLES)),
    index("assistant_messages_thread_idx").on(t.threadId, t.at),
  ],
);

/** What the template assistant suggests. Only `status` and the apply columns ever change (trigger), and only by the apply route. */
export const assistantProposals = pgTable(
  "assistant_proposals",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    kind: text("kind").$type<AssistantProposalKind>().notNull(),
    templateVersionId: uuid("template_version_id")
      .notNull()
      .references(() => spaTemplateVersions.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<AssistantProposalStatus>().notNull().default("proposed"),
    appliedBy: text("applied_by"),
    appliedAt: ts("applied_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("assistant_proposals_kind", oneOf(t.kind, ASSISTANT_PROPOSAL_KINDS)),
    check("assistant_proposals_status", oneOf(t.status, ASSISTANT_PROPOSAL_STATUSES)),
    index("assistant_proposals_version_idx").on(t.templateVersionId, t.status),
  ],
);

// C36 (S68): the staff copilot. A proposal is a stored request for one of four actions; it does nothing until the same
// user clicks Confirm. A draft is text saved for the user to copy or open in a form; nothing is ever sent from it.
export const COPILOT_PROPOSAL_KINDS = [
  "request_documents",
  "create_task",
  "resend_signing_link",
  "prepare_agreement",
] as const;
export type CopilotProposalKind = (typeof COPILOT_PROPOSAL_KINDS)[number];
export const COPILOT_PROPOSAL_STATUSES = ["proposed", "confirmed", "cancelled", "expired"] as const;
export type CopilotProposalStatus = (typeof COPILOT_PROPOSAL_STATUSES)[number];
export const COPILOT_DRAFT_KINDS = ["email", "summary", "approval_note"] as const;
export type CopilotDraftKind = (typeof COPILOT_DRAFT_KINDS)[number];

/** Moves once from `proposed` (trigger); `payload` never changes; never deleted. */
export const copilotProposals = pgTable(
  "copilot_proposals",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => spaUsers.id),
    kind: text("kind").$type<CopilotProposalKind>().notNull(),
    dealId: uuid("deal_id").references(() => deals.id),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<CopilotProposalStatus>().notNull().default("proposed"),
    expiresAt: ts("expires_at").notNull(),
    confirmedAt: ts("confirmed_at"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("copilot_proposals_kind", oneOf(t.kind, COPILOT_PROPOSAL_KINDS)),
    check("copilot_proposals_status", oneOf(t.status, COPILOT_PROPOSAL_STATUSES)),
    index("copilot_proposals_user_idx").on(t.userId, t.status),
  ],
);

/** Immutable (trigger). */
export const copilotDrafts = pgTable(
  "copilot_drafts",
  {
    id: uuid("id").primaryKey(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => assistantThreads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => spaUsers.id),
    kind: text("kind").$type<CopilotDraftKind>().notNull(),
    dealId: uuid("deal_id").references(() => deals.id),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("copilot_drafts_kind", oneOf(t.kind, COPILOT_DRAFT_KINDS)),
    index("copilot_drafts_user_idx").on(t.userId, t.createdAt),
  ],
);

/** A visitor's enquiry about one published listing, emailed to its agent. Never stored without the visitor's consent. */
export const listingEnquiries = pgTable(
  "listing_enquiries",
  {
    id: uuid("id").primaryKey(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => listings.id),
    name: text("name").notNull(),
    email: text("email").notNull(),
    message: text("message").notNull(),
    consentAt: ts("consent_at").notNull(),
    outboundMessageId: uuid("outbound_message_id").references(() => outboundMessages.id),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("listing_enquiries_listing_idx").on(t.listingId, t.createdAt)],
);

/** Counts per hashed client key and Clock bucket (`chat:<listing>:<hour>`, `enquiry:<listing>:<day>`). */
export const assistantRateLimits = pgTable(
  "assistant_rate_limits",
  {
    keyHash: text("key_hash").notNull(),
    bucket: text("bucket").notNull(),
    n: integer("n").notNull(),
  },
  (t) => [primaryKey({ columns: [t.keyHash, t.bucket] }), check("assistant_rate_limits_n", sql`${t.n} >= 0`)],
);

// ---------------------------------------------------------------------------------------------
// C23 (S62): compliance records (exports, retention reviews, monthly reports) and staff alerts.

export const EXPORT_KINDS = ["case_pack", "monthly_report"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

/**
 * One export of a compliance record, who asked and when (S29, S62). Append-only by trigger. A `case_pack` belongs to a
 * deal; a `monthly_report` download belongs to none. The file itself is stored through the document store under
 * `storage_key`; the hash is of the bytes that were handed over.
 */
export const spaExports = pgTable(
  "exports",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id").references(() => deals.id),
    kind: text("kind").$type<ExportKind>().notNull(),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => spaUsers.id),
    requestedAt: ts("requested_at").notNull(),
    sha256: text("sha256").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    storageKey: text("storage_key").notNull(),
    fileCount: integer("file_count").notNull(),
  },
  (t) => [
    index("exports_deal_idx").on(t.dealId, t.requestedAt),
    check("exports_kind", oneOf(t.kind, EXPORT_KINDS)),
    check("exports_kind_deal", sql`(${t.kind} = 'case_pack') = (${t.dealId} is not null)`),
    check("exports_size", sql`${t.sizeBytes} > 0`),
    check("exports_files", sql`${t.fileCount} > 0`),
  ],
);

/**
 * The monthly list of deals past retention (S29, S62). A compliance role approves the list; nothing is deleted. The
 * years and the cut-off day used are kept with the list (rule 4).
 */
export const retentionReviews = pgTable(
  "retention_reviews",
  {
    id: uuid("id").primaryKey(),
    /** `yyyy-mm` of the Dubai month the list was made in. */
    period: text("period").notNull().unique(),
    status: text("status").$type<"listed" | "approved">().notNull().default("listed"),
    retentionYears: integer("retention_years").notNull(),
    /** A deal that ended on or before this day is listed. */
    cutoffOn: calDate("cutoff_on").notNull(),
    approvedBy: uuid("approved_by").references(() => spaUsers.id),
    approvedAt: ts("approved_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("retention_reviews_period", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`),
    check("retention_reviews_status", oneOf(t.status, ["listed", "approved"])),
    check(
      "retention_reviews_approved_needs_who",
      sql`${t.status} = 'listed' or (${t.approvedBy} is not null and ${t.approvedAt} is not null)`,
    ),
  ],
);

export const retentionReviewItems = pgTable(
  "retention_review_items",
  {
    reviewId: uuid("review_id")
      .notNull()
      .references(() => retentionReviews.id),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    /** The Dubai day of the deal's terminal event. */
    endedOn: calDate("ended_on").notNull(),
    status: text("status").$type<"listed" | "approved">().notNull().default("listed"),
  },
  (t) => [
    primaryKey({ columns: [t.reviewId, t.dealId] }),
    index("retention_review_items_deal_idx").on(t.dealId),
    check("retention_review_items_status", oneOf(t.status, ["listed", "approved"])),
  ],
);

/** The compliance report of one month, as a CSV and a PDF (S29, S62). Immutable by trigger; one per month. */
export const complianceReports = pgTable(
  "compliance_reports",
  {
    id: uuid("id").primaryKey(),
    period: text("period").notNull().unique(),
    csvSha256: text("csv_sha256").notNull(),
    pdfSha256: text("pdf_sha256").notNull(),
    csvKey: text("csv_key").notNull(),
    pdfKey: text("pdf_key").notNull(),
    generatedAt: ts("generated_at").notNull(),
  },
  (t) => [check("compliance_reports_period", sql`${t.period} ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'`)],
);

/**
 * How many hours a gate may wait before its approver is alerted (S30, S62). Versioned and append-only: the highest
 * version of a gate is in force; no row means the default in `@spa/core`.
 */
export const alertSettings = pgTable(
  "alert_settings",
  {
    gate: text("gate").$type<SpaGateId>().notNull(),
    version: integer("version").notNull(),
    thresholdHours: integer("threshold_hours").notNull(),
    setBy: uuid("set_by")
      .notNull()
      .references(() => spaUsers.id),
    setAt: ts("set_at").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.gate, t.version] }),
    check("alert_settings_gate", oneOf(t.gate, SpaGateId.options)),
    check("alert_settings_hours", sql`${t.thresholdHours} > 0`),
  ],
);

export const ALERT_LEVEL_VALUES = ["approver", "manager"] as const;

/**
 * An in-app alert (S62): one per (approval, level, user). Only `read_at` and the email link are set, once each; never
 * deleted. The text is built from the gate, the deal ref and `waited_hours` when read, so it can't hold more than that.
 */
export const alerts = pgTable(
  "alerts",
  {
    id: uuid("id").primaryKey(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => spaApprovals.id),
    level: text("level").$type<(typeof ALERT_LEVEL_VALUES)[number]>().notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => spaUsers.id),
    waitedHours: integer("waited_hours").notNull(),
    outboundMessageId: uuid("outbound_message_id").references(() => outboundMessages.id),
    readAt: ts("read_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("alerts_once_uq").on(t.approvalId, t.level, t.userId),
    index("alerts_user_idx").on(t.userId, t.readAt, t.createdAt),
    check("alerts_level", oneOf(t.level, ALERT_LEVEL_VALUES)),
    check("alerts_hours", sql`${t.waitedHours} >= 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C32 (S64): the developer's inventory. Projects, buildings and versioned price lists.

/**
 * A developer's project (S12, S64). Its escrow account is not a column: C22's `project_escrow_accounts` is keyed by
 * `code` and keeps every version, so the link is the project's code and always reads the current row. The code and
 * the buildings can't change once a deal exists on the project (trigger). Never deleted.
 */
export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey(),
    code: text("code").notNull().unique(),
    name: text("name").notNull(),
    emirate: text("emirate").notNull().default("dubai"),
    developerCompanyId: uuid("developer_company_id")
      .notNull()
      .references(() => companies.id),
    /** Calendar date in Asia/Dubai. */
    anticipatedCompletionOn: calDate("anticipated_completion_on"),
    /** Which document kind's template this project's agreements use; null reads as the SPA. */
    templateKind: text("template_kind").$type<(typeof SPA_TEMPLATE_KINDS)[number]>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    check(
      "projects_template_kind",
      sql`${t.templateKind} is null or ${t.templateKind} in ('spa', 'mou', 'assignment', 'listing_agreement')`,
    ),
  ],
);

export const buildings = pgTable(
  "buildings",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    code: text("code").notNull(),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("buildings_project_code_uq").on(t.projectId, t.code)],
);

/**
 * A project's price list, one version at a time (S64). A draft becomes published once; a published list and its items
 * never change and are never deleted (trigger). A new price is a new version. The version in use is the latest published.
 */
export const priceLists = pgTable(
  "price_lists",
  {
    id: uuid("id").primaryKey(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id),
    version: integer("version").notNull(),
    publishedAt: ts("published_at"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("price_lists_project_version_uq").on(t.projectId, t.version),
    check("price_lists_version", sql`${t.version} > 0`),
  ],
);

export const priceListItems = pgTable(
  "price_list_items",
  {
    priceListId: uuid("price_list_id")
      .notNull()
      .references(() => priceLists.id),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    priceFils: fils("price_fils").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.priceListId, t.unitId] }),
    check("price_list_items_price_positive", sql`${t.priceFils} > 0`),
  ],
);

// ---------------------------------------------------------------------------------------------
// C35 (S67): the buyer and seller portal's links. One person, one deal, one purpose each.

export const PORTAL_PURPOSES = ["documents", "view"] as const;
export type PortalPurpose = (typeof PORTAL_PURPOSES)[number];

/**
 * A portal link (S67). `documents` acts (upload, "Send my documents") and is used up on send; `view` only reads and
 * lives as long as the deal. A new link for the same deal, party and purpose supersedes the old one. Only the token's
 * SHA-256 is stored: the token itself exists only in the email.
 */
export const portalLinks = pgTable(
  "portal_links",
  {
    id: uuid("id").primaryKey(),
    dealId: uuid("deal_id")
      .notNull()
      .references(() => deals.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    purpose: text("purpose").$type<PortalPurpose>().notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    /** Null for `view`: it lives as long as the deal. */
    expiresAt: ts("expires_at"),
    usedAt: ts("used_at"),
    supersededAt: ts("superseded_at"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    check("portal_links_purpose", oneOf(t.purpose, PORTAL_PURPOSES)),
    uniqueIndex("portal_links_one_live_uq")
      .on(t.dealId, t.partyId, t.purpose)
      .where(sql`${t.supersededAt} is null and ${t.usedAt} is null`),
  ],
);

/**
 * Portal sign-in hand-offs already used (C38, S70): one row per `jti` of a portal token the exchange accepted, so a
 * token works once. Append-only (trigger in migration 0064); the table holds no personal data.
 */
export const portalHandoffs = pgTable("portal_handoffs", {
  jti: text("jti").primaryKey(),
  usedAt: ts("used_at").notNull(),
});
