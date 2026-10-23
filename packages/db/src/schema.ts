import type {
  Addendum,
  AddendumFlag,
  ApplicationState,
  ApprovalStatus,
  CalendarDate,
  CompanyPolicy,
  ContractFields,
  ContractStatus,
  EjariAutofix,
  EjariPayload,
  EjariRejection,
  EntityKind,
  EnquiryFlow,
  FieldSource,
  GateId,
  InboundType,
  LeaseState,
  OfferTerms,
  StaffRole,
  UnitState,
} from "@leasing/core";
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  real,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * Conventions: UUIDv7 ids generated in code; money is integer fils (`bigint` read as number);
 * legal dates are `date` (Asia/Dubai calendar dates); instants are `timestamptz`.
 */
const id = () => uuid("id").primaryKey();
const fils = (name: string) => bigint(name, { mode: "number" });
const calDate = (name: string) => date(name, { mode: "string" }).$type<CalendarDate>();
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();
const updatedAt = () => ts("updated_at").notNull().defaultNow();

export const staffUsers = pgTable("staff_users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").$type<StaffRole>().notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: createdAt(),
});

export const parties = pgTable(
  "parties",
  {
    id: id(),
    kind: text("kind").$type<"individual" | "company">().notNull(),
    fullNameEn: text("full_name_en").notNull(),
    fullNameAr: text("full_name_ar"),
    email: text("email"),
    phone: text("phone"),
    nationality: text("nationality"),
    emiratesIdNo: text("emirates_id_no"),
    passportNo: text("passport_no"),
    tradeLicenceNo: text("trade_licence_no"),
    birthDate: calDate("birth_date"),
    // Expiry dates and visa number, copied from verified KYC extraction (never retyped).
    idExpiresOn: calDate("id_expires_on"),
    passportExpiresOn: calDate("passport_expires_on"),
    visaNo: text("visa_no"),
    visaExpiresOn: calDate("visa_expires_on"),
    tradeLicenceExpiresOn: calDate("trade_licence_expires_on"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("parties_email_idx").on(t.email), uniqueIndex("parties_emirates_id_uq").on(t.emiratesIdNo)],
);

export const units = pgTable("units", {
  id: id(),
  /** Short code staff use, e.g. "MRN-1204". */
  code: text("code").notNull().unique(),
  building: text("building").notNull(),
  community: text("community").notNull(),
  kind: text("kind").$type<"residential" | "commercial">().notNull().default("residential"),
  state: text("state").$type<UnitState>().notNull().default("PREP"),
  dldPropertyNo: text("dld_property_no"),
  unitNo: text("unit_no"),
  makaniNo: text("makani_no"),
  plotNo: text("plot_no"),
  areaSqft: integer("area_sqft"),
  bedrooms: smallint("bedrooms"),
  furnished: boolean("furnished"),
  dewaPremiseNo: text("dewa_premise_no"),
  askingRentFils: fils("asking_rent_fils"),
  priceApprovedAt: ts("price_approved_at"),
  landlordPartyId: uuid("landlord_party_id").references(() => parties.id),
  ownUseLockUntil: calDate("own_use_lock_until"),
  /** Listing text shown to applicants. */
  description: text("description"),
  floor: smallint("floor"),
  bathrooms: smallint("bathrooms"),
  parkingSpaces: smallint("parking_spaces"),
  /** Optional external virtual tour (https), shown on the applicant's property page. */
  virtualTourUrl: text("virtual_tour_url"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const applications = pgTable(
  "applications",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    state: text("state").$type<ApplicationState>().notNull().default("ENQUIRY"),
    source: text("source").$type<"telegram" | "staff" | "import" | "copilot">().notNull(),
    reservationPaidOn: calDate("reservation_paid_on"),
    /** The current offer (`OfferTerms`); earlier revisions live in the event log. */
    offer: jsonb("offer").$type<OfferTerms>(),
    /** Reference shown to the applicant, e.g. "A-7KQ2MX". */
    ref: text("ref"),
    requestedMoveInOn: calDate("requested_move_in_on"),
    kycVerifiedAt: ts("kyc_verified_at"),
    offerAcceptedAt: ts("offer_accepted_at"),
    reservationFils: fils("reservation_fils"),
    reservationRef: text("reservation_ref"),
    /** Booked viewing appointment (an instant, not a legal date). */
    viewingAt: ts("viewing_at"),
    viewingOutcome: text("viewing_outcome").$type<"attended" | "no_show">(),
    viewingOutcomeAt: ts("viewing_outcome_at"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("applications_unit_idx").on(t.unitId),
    index("applications_party_idx").on(t.partyId),
    uniqueIndex("applications_ref_uq").on(t.ref),
    // Backstop for one viewing per slot (bookViewing checks the whole slot under the unit's lock).
    uniqueIndex("applications_viewing_uq")
      .on(t.unitId, t.viewingAt)
      .where(sql`${t.state} = 'VIEWING'`),
  ],
);

export const leases = pgTable(
  "leases",
  {
    id: id(),
    /** Short human reference, e.g. "L-0088". */
    ref: text("ref").notNull().unique(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    applicationId: uuid("application_id").references(() => applications.id),
    previousLeaseId: uuid("previous_lease_id"),
    state: text("state").$type<LeaseState>().notNull().default("CONTRACT"),
    startOn: calDate("start_on").notNull(),
    endOn: calDate("end_on").notNull(),
    annualRentFils: fils("annual_rent_fils").notNull(),
    cheques: smallint("cheques").notNull(),
    depositFils: fils("deposit_fils").notNull(),
    rulesVersion: text("rules_version").notNull(),
    ejariNo: text("ejari_no"),
    ejariIssuedOn: calDate("ejari_issued_on"),
    ejariCancelledOn: calDate("ejari_cancelled_on"),
    depositSettledOn: calDate("deposit_settled_on"),
    /** Step 10: the date the tenant leaves (the lease end unless a person agreed otherwise). */
    moveOutOn: calDate("move_out_on"),
    source: text("source").$type<"engine" | "import" | "demo">().notNull().default("engine"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("leases_unit_idx").on(t.unitId),
    index("leases_state_idx").on(t.state),
    uniqueIndex("leases_unit_start_uq").on(t.unitId, t.startOn),
  ],
);

export const leaseParties = pgTable(
  "lease_parties",
  {
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    role: text("role").$type<"tenant" | "landlord" | "occupant">().notNull(),
  },
  (t) => [primaryKey({ columns: [t.leaseId, t.partyId, t.role] })],
);

/** Append-only audit log for every entity (units, applications, leases). */
export const leaseEvents = pgTable(
  "lease_events",
  {
    id: id(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    type: text("type").notNull(),
    fromState: text("from_state"),
    toState: text("to_state"),
    actor: text("actor").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    rulesVersion: text("rules_version"),
    /** From Clock (demo offset applies). */
    at: ts("at").notNull(),
    recordedAt: ts("recorded_at").notNull().defaultNow(),
  },
  (t) => [index("lease_events_entity_idx").on(t.entityKind, t.entityId, t.at)],
);

/**
 * Marketing photos of a unit (not tenant documents). Stored on local disk under MEDIA_DIR by
 * SHA-256; `sort` 0 is the cover.
 */
export const unitPhotos = pgTable(
  "unit_photos",
  {
    id: id(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id),
    sha256: text("sha256").notNull(),
    path: text("path").notNull(),
    mime: text("mime").notNull(),
    bytes: integer("bytes").notNull(),
    caption: text("caption"),
    sort: smallint("sort").notNull().default(0),
    uploadedBy: text("uploaded_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("unit_photos_unit_idx").on(t.unitId, t.sort),
    uniqueIndex("unit_photos_unit_sha_uq").on(t.unitId, t.sha256),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: id(),
    partyId: uuid("party_id").references(() => parties.id),
    leaseId: uuid("lease_id").references(() => leases.id),
    applicationId: uuid("application_id").references(() => applications.id),
    kind: text("kind").notNull(),
    sha256: text("sha256").notNull(),
    path: text("path").notNull(),
    mime: text("mime"),
    extracted: jsonb("extracted"),
    verifiedAt: ts("verified_at"),
    expiresOn: calDate("expires_on"),
    /** Tenant uploads: uploaded → verified | rejected (after KYC). Generated documents stay null. */
    status: text("status").$type<"uploaded" | "submitted" | "verified" | "rejected">(),
    /** front | back | page (ID cards have two sides). */
    side: text("side"),
    bytes: integer("bytes"),
    uploadedViaLinkId: uuid("uploaded_via_link_id"),
    /** Tenancy photos (phase 3): the room a condition photo shows, and what the file belongs to. */
    room: text("room"),
    inspectionId: uuid("inspection_id"),
    paymentId: uuid("payment_id"),
    complaintId: uuid("complaint_id"),
    /** Who uploaded it: `user:<id>` (staff) or `tenant:<partyId>` (portal). */
    uploadedBy: text("uploaded_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("documents_inspection_idx").on(t.inspectionId),
    index("documents_party_idx").on(t.partyId),
    index("documents_sha_idx").on(t.sha256),
    index("documents_application_idx").on(t.applicationId),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: id(),
    gate: text("gate").$type<GateId>().notNull(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    /** Unique per open proposal, e.g. "<leaseId>:renewal_notice" — avoids duplicates on job retries. */
    dedupeKey: text("dedupe_key").notNull(),
    title: text("title").notNull(),
    proposal: jsonb("proposal").$type<Record<string, unknown>>().notNull(),
    /** Source refs shown in the inbox: documents, helper runs, rules, events. */
    sources: jsonb("sources").$type<ApprovalSource[]>().notNull().default([]),
    reasons: text("reasons")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    rulesVersion: text("rules_version"),
    approverRole: text("approver_role").$type<StaffRole>().notNull(),
    status: text("status").$type<ApprovalStatus>().notNull().default("pending"),
    proposedBy: text("proposed_by").notNull(),
    /** Lease/unit/application event to apply on approval, if any. */
    onApproveEvent: text("on_approve_event"),
    decidedBy: uuid("decided_by").references(() => staffUsers.id),
    decidedAt: ts("decided_at"),
    decisionNote: text("decision_note"),
    editedProposal: jsonb("edited_proposal").$type<Record<string, unknown>>(),
    /** The event that consumed this approval (for gated transitions). */
    consumedByEventId: uuid("consumed_by_event_id"),
    createdEventId: uuid("created_event_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    index("approvals_status_idx").on(t.status, t.createdAt),
    index("approvals_entity_idx").on(t.entityKind, t.entityId),
    uniqueIndex("approvals_dedupe_uq").on(t.dedupeKey),
  ],
);

export type ApprovalSource =
  | { kind: "rule"; rulesVersion: string; rule: string; value: string }
  | { kind: "event"; eventId: string; label: string }
  | { kind: "document"; documentId: string; label: string }
  | { kind: "helper_run"; helperRunId: string; label: string }
  | { kind: "field"; label: string; value: string };

export const deadlines = pgTable(
  "deadlines",
  {
    id: id(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    milestone: text("milestone").notNull(),
    dueOn: calDate("due_on").notNull(),
    status: text("status")
      .$type<"pending" | "done" | "skipped" | "failed" | "cancelled">()
      .notNull()
      .default("pending"),
    jobId: text("job_id"),
    rulesVersion: text("rules_version"),
    note: text("note"),
    firedAt: ts("fired_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("deadlines_entity_milestone_uq").on(t.entityId, t.milestone),
    index("deadlines_due_idx").on(t.status, t.dueOn),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
    assigneeRole: text("assignee_role").$type<StaffRole>().notNull(),
    status: text("status").$type<"open" | "done" | "cancelled">().notNull().default("open"),
    dueOn: calDate("due_on"),
    dedupeKey: text("dedupe_key").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("tasks_dedupe_uq").on(t.dedupeKey), index("tasks_status_idx").on(t.status)],
);

export const payments = pgTable(
  "payments",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    seq: smallint("seq").notNull(),
    dueOn: calDate("due_on").notNull(),
    amountFils: fils("amount_fils").notNull(),
    method: text("method").$type<"cheque" | "transfer" | "cash">().notNull().default("cheque"),
    chequeNo: text("cheque_no"),
    status: text("status")
      .$type<"scheduled" | "paid" | "bounced" | "overdue" | "cancelled">()
      .notNull()
      .default("scheduled"),
    paidOn: calDate("paid_on"),
    /** Finance's reference for the payment (bank reference, receipt number). */
    paidRef: text("paid_ref"),
    /** `user:<id>` who confirmed it paid (finance confirms every payment, D27). */
    confirmedBy: text("confirmed_by"),
    bouncedOn: calDate("bounced_on"),
    /** Friendly reminders sent for this payment since it became overdue or bounced. */
    friendlyCount: smallint("friendly_count").notNull().default(0),
    formalReminderSentOn: calDate("formal_reminder_sent_on"),
    /** Formal reminder sent + rulebook days (lease's pinned version). A person decides what follows. */
    evictionEligibleOn: calDate("eviction_eligible_on"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("payments_lease_seq_uq").on(t.leaseId, t.seq)],
);

export const complaints = pgTable(
  "complaints",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    /** Reference shown to the tenant, e.g. "C-7KQ2MX". */
    ref: text("ref"),
    /** Tenant-written: classified, never obeyed. */
    text: text("text").notNull(),
    room: text("room"),
    /** "Is anyone at risk?" ticked by the tenant. */
    atRisk: boolean("at_risk").notNull().default(false),
    source: text("source").$type<"portal" | "staff">().notNull().default("portal"),
    inboundEventId: uuid("inbound_event_id"),
    helperRunId: uuid("helper_run_id"),
    category: text("category"),
    categoryConfidence: real("category_confidence"),
    urgency: smallint("urgency"),
    safety: real("safety"),
    legalThreat: real("legal_threat"),
    injection: real("injection"),
    language: text("language"),
    status: text("status")
      .$type<"open" | "triaging" | "review" | "escalated" | "ticketed" | "closed">()
      .notNull()
      .default("open"),
    closedReason: text("closed_reason"),
    createdAt: createdAt(),
  },
  (t) => [index("complaints_lease_idx").on(t.leaseId), uniqueIndex("complaints_inbound_uq").on(t.inboundEventId)],
);

/** Maintenance work from a complaint (step 8). Due time from company policy by urgency. */
export const maintenanceTickets = pgTable(
  "maintenance_tickets",
  {
    id: id(),
    ref: text("ref").notNull().unique(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    complaintId: uuid("complaint_id")
      .notNull()
      .references(() => complaints.id),
    category: text("category").notNull(),
    /** 0 = can wait a week … 3 = emergency. */
    urgency: smallint("urgency").notNull(),
    status: text("status").$type<"open" | "in_progress" | "done" | "cancelled">().notNull().default("open"),
    dueBy: ts("due_by").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
    updatedAt: ts("updated_at").notNull(),
    closedAt: ts("closed_at"),
  },
  (t) => [
    uniqueIndex("maintenance_tickets_complaint_uq").on(t.complaintId),
    index("maintenance_tickets_status_idx").on(t.status, t.dueBy),
  ],
);

export const inspections = pgTable("inspections", {
  id: id(),
  leaseId: uuid("lease_id")
    .notNull()
    .references(() => leases.id),
  kind: text("kind").$type<"move_in" | "move_out">().notNull(),
  status: text("status").$type<"scheduled" | "done">().notNull().default("scheduled"),
  scheduledOn: calDate("scheduled_on"),
  /** Move-out: the slot the tenant booked (or staff set). */
  scheduledAt: ts("scheduled_at"),
  /** `tenant:<partyId>` or `user:<id>`. */
  bookedBy: text("booked_by"),
  items: jsonb("items").notNull().default([]),
  photos: jsonb("photos").notNull().default([]),
  /** Move-out: the vision model's per-room suggestions (never applied by themselves, D29). */
  suggestions: jsonb("suggestions").$type<Record<string, unknown>[]>().notNull().default([]),
  /** Move-out: damage items an officer confirmed (price-list item × quantity, or an "other" amount). */
  findings: jsonb("findings").$type<Record<string, unknown>[]>().notNull().default([]),
  doneOn: calDate("done_on"),
  createdAt: createdAt(),
});

/**
 * Deposit statements (step 10). Each revision is computed in code from the deposit, the confirmed
 * findings and the price list in force; amounts are never edited by hand. Finance acts on every
 * refund: `refund` approval when above the threshold, disputed or with an "other" item, and in all
 * cases the payout record that settles the deposit.
 */
export const depositStatements = pgTable(
  "deposit_statements",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    revision: smallint("revision").notNull(),
    inspectionId: uuid("inspection_id").references(() => inspections.id),
    depositFils: fils("deposit_fils").notNull(),
    items: jsonb("items").$type<Record<string, unknown>[]>().notNull().default([]),
    deductionsFils: fils("deductions_fils").notNull(),
    refundFils: fils("refund_fils").notNull(),
    /** Damage beyond the deposit: a manager decides; never claimed automatically. */
    owedFils: fils("owed_fils").notNull().default(0),
    /** Company policy version the prices came from (null = built-in defaults). */
    policyVersion: integer("policy_version"),
    status: text("status")
      .$type<"sent" | "accepted" | "disputed" | "approved" | "paid" | "superseded">()
      .notNull()
      .default("sent"),
    needsApproval: boolean("needs_approval").notNull().default(false),
    approvalId: uuid("approval_id"),
    documentId: uuid("document_id"),
    responseInboundId: uuid("response_inbound_id"),
    paidOn: calDate("paid_on"),
    paymentRef: text("payment_ref"),
    paidBy: text("paid_by"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("deposit_statements_lease_rev_uq").on(t.leaseId, t.revision)],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    channel: text("channel").$type<"telegram" | "whatsapp">().notNull(),
    externalChatId: text("external_chat_id").notNull(),
    partyId: uuid("party_id").references(() => parties.id),
    applicationId: uuid("application_id").references(() => applications.id),
    assignedTo: uuid("assigned_to").references(() => staffUsers.id),
    status: text("status").$type<"bot" | "handoff" | "closed">().notNull().default("bot"),
    language: text("language"),
    /** The Telegram user who owns this private chat; an update from anyone else is refused. */
    externalUserId: text("external_user_id"),
    /** Booking flow state for this customer only (`EnquiryFlow`). */
    flow: jsonb("flow").$type<EnquiryFlow>().notNull().default({ step: "idle" }),
    /** Bumped on every change to `flow`; a slow model answer for an older version is discarded. */
    flowVersion: integer("flow_version").notNull().default(0),
    handoffReason: text("handoff_reason"),
    /** Asked first in every enquiry, for follow-up: email (lowercased, required to go on) and phone (+E.164, optional). */
    contactEmail: text("contact_email"),
    contactPhone: text("contact_phone"),
    contactAt: ts("contact_at"),
    lastMessageAt: ts("last_message_at"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("conversations_channel_chat_uq").on(t.channel, t.externalChatId),
    index("conversations_status_idx").on(t.status, t.lastMessageAt),
    index("conversations_contact_email_idx").on(t.contactEmail),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id),
    direction: text("direction").$type<"in" | "out">().notNull(),
    body: text("body").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    /** Inbound: the Telegram update id, so a redelivered update is stored and answered once. */
    externalId: text("external_id"),
    /** Who wrote an outbound message: `system` (the bot) or `user:<id>` (an officer). */
    author: text("author"),
    at: ts("at").notNull(),
  },
  (t) => [
    index("messages_conversation_idx").on(t.conversationId, t.at),
    uniqueIndex("messages_external_uq").on(t.conversationId, t.direction, t.externalId),
  ],
);

export const helperRuns = pgTable(
  "helper_runs",
  {
    id: id(),
    helper: text("helper").notNull(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    inputHash: text("input_hash").notNull(),
    output: jsonb("output"),
    status: text("status").$type<"ok" | "needs_human" | "failed">().notNull(),
    model: text("model"),
    confidence: real("confidence"),
    latencyMs: integer("latency_ms"),
    attempt: smallint("attempt").notNull().default(1),
    tokens: integer("tokens"),
    eventId: uuid("event_id"),
    at: ts("at").notNull(),
  },
  (t) => [index("helper_runs_entity_idx").on(t.entityKind, t.entityId, t.at)],
);

export const companyPolicy = pgTable("company_policy", {
  id: id(),
  version: integer("version").notNull().unique(),
  effectiveFrom: calDate("effective_from").notNull(),
  values: jsonb("values").$type<CompanyPolicy>().notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
});

/** Singleton row (id = 1). */
export const demoSettings = pgTable("demo_settings", {
  id: smallint("id").primaryKey().default(1),
  clockOffsetMs: bigint("clock_offset_ms", { mode: "number" }).notNull().default(0),
  updatedAt: updatedAt(),
});

// ---------------------------------------------------------------------------------------------
// Phase 1: SRI, outbound email evidence, tenant portal links and inbound submissions.

/** Smart Rental Index averages (mock table for the MVP; manual entries by staff). */
export const sriAverages = pgTable(
  "sri_averages",
  {
    id: id(),
    community: text("community").notNull(),
    bedrooms: smallint("bedrooms").notNull(),
    avgAnnualRentFils: fils("avg_annual_rent_fils").notNull(),
    source: text("source").$type<"mock" | "manual">().notNull(),
    effectiveFrom: calDate("effective_from").notNull(),
    createdBy: text("created_by").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("sri_averages_uq").on(t.community, t.bedrooms, t.effectiveFrom)],
);

/** A staff-entered SRI value for one lease (e.g. from the DLD calculator for that unit). */
export const sriOverrides = pgTable(
  "sri_overrides",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    /** The term (lease end date) the value was entered for; it never carries into the next term. */
    leaseEndOn: calDate("lease_end_on"),
    avgAnnualRentFils: fils("avg_annual_rent_fils").notNull(),
    reason: text("reason").notNull(),
    enteredBy: text("entered_by").notNull(),
    at: ts("at").notNull(),
  },
  (t) => [index("sri_overrides_lease_idx").on(t.leaseId, t.at)],
);

/** Every email sent, with what is needed as evidence (architecture §8). One row per purpose and milestone. */
export const outboundMessages = pgTable(
  "outbound_messages",
  {
    id: id(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    purpose: text("purpose")
      .$type<"notice" | "formal_reminder" | "reminder" | "offer" | "link" | "receipt">()
      .notNull(),
    /** Idempotency key within the purpose, e.g. "renewal_notice@2027-03-29#2". */
    milestone: text("milestone").notNull(),
    to: text("to").notNull(),
    /** In demo mode mail is redirected; this is who it was meant for. */
    intendedTo: text("intended_to").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    bodySha256: text("body_sha256"),
    attachmentSha256s: text("attachment_sha256s")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    documentId: uuid("document_id"),
    approvalId: uuid("approval_id"),
    status: text("status").$type<"sending" | "sent" | "failed">().notNull().default("sending"),
    messageId: text("message_id"),
    smtpResponse: text("smtp_response"),
    previewUrl: text("preview_url"),
    error: text("error"),
    sentAt: ts("sent_at"),
    acknowledgedAt: ts("acknowledged_at"),
    eventId: uuid("event_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("outbound_messages_uq").on(t.entityId, t.purpose, t.milestone),
    index("outbound_messages_entity_idx").on(t.entityId, t.createdAt),
  ],
);

/** Magic links for the tenant portal; only the SHA-256 of the token is stored. */
/**
 * Rulebook versions (decision D23). The code base version (`packages/rulebook`) is upserted at
 * engine start; admins add versions as drafts and publish them. Published rows are immutable
 * (trigger in migration 0009) because leases and decisions pin their `rulesVersion`.
 */
export const rulebooks = pgTable("rulebooks", {
  id: id(),
  version: text("version").notNull().unique(),
  emirate: text("emirate").$type<"dubai">().notNull(),
  status: text("status").$type<"draft" | "published">().notNull(),
  basedOn: text("based_on"),
  effectiveFrom: calDate("effective_from").notNull(),
  /** `RulebookValues` (validated with Zod in `packages/rulebook`). */
  values: jsonb("values").$type<Record<string, unknown>>().notNull(),
  referenceRules: jsonb("reference_rules").$type<{ id: string; title: string; text: string }[]>().notNull().default([]),
  createdBy: text("created_by").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
  publishedBy: text("published_by"),
  publishedAt: ts("published_at"),
});

export const actionLinks = pgTable(
  "action_links",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    purpose: text("purpose")
      .$type<
        | "tenancy"
        | "notice_ack"
        | "application"
        | "viewing"
        | "kyc_upload"
        | "offer"
        | "sign"
        | "move_in_ack"
        | "deposit_response"
      >()
      .notNull(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    partyId: uuid("party_id").references(() => parties.id),
    /** For notice links: the outbound message they acknowledge. */
    outboundMessageId: uuid("outbound_message_id"),
    singleUse: boolean("single_use").notNull(),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("action_links_entity_idx").on(t.entityId)],
);

/** Raw tenant or staff-on-behalf submissions; processed later by the Manager (architecture §8a). */
export const inboundEvents = pgTable(
  "inbound_events",
  {
    id: id(),
    /** Short reference shown to the tenant, e.g. "R-7KQ2M9". */
    ref: text("ref").notNull().unique(),
    type: text("type").$type<InboundType>().notNull(),
    entityKind: text("entity_kind").$type<EntityKind>().notNull(),
    entityId: uuid("entity_id").notNull(),
    channel: text("channel").$type<"portal" | "staff">().notNull(),
    actor: text("actor").notNull(),
    linkId: uuid("link_id"),
    /** One reply per kind per term: "<type>@<leaseEnd>" (portal) or a random key (staff). */
    dedupeKey: text("dedupe_key").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"received" | "applied" | "stored_only" | "failed">().notNull().default("received"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    receivedAt: ts("received_at").notNull(),
    processedAt: ts("processed_at"),
  },
  (t) => [
    uniqueIndex("inbound_events_dedupe_uq").on(t.dedupeKey),
    index("inbound_events_entity_idx").on(t.entityId, t.receivedAt),
  ],
);

/** Staff copilot conversations (architecture §8b). One thread per user; never shared. */
export const copilotThreads = pgTable(
  "copilot_threads",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => staffUsers.id),
    /** The page the chat was opened on, if any (e.g. a lease). */
    contextKind: text("context_kind").$type<"lease" | "unit" | "approval">(),
    contextId: uuid("context_id"),
    title: text("title").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("copilot_threads_user_idx").on(t.userId, t.createdAt)],
);

/**
 * Every turn and tool call, for audit: tool arguments and a hash of what the tool returned,
 * the values in an answer that no tool result backed ("unverified"), model and latency.
 */
export const copilotMessages = pgTable(
  "copilot_messages",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => copilotThreads.id),
    role: text("role").$type<"user" | "assistant" | "tool">().notNull(),
    content: text("content").notNull(),
    toolName: text("tool_name"),
    toolArgs: jsonb("tool_args").$type<Record<string, unknown>>(),
    toolResultSha256: text("tool_result_sha256"),
    toolOk: boolean("tool_ok"),
    unverified: jsonb("unverified").$type<string[]>(),
    model: text("model"),
    latencyMs: integer("latency_ms"),
    at: ts("at").notNull(),
  },
  (t) => [index("copilot_messages_thread_idx").on(t.threadId, t.at)],
);

/**
 * Actions the copilot proposed and only the user's Confirm click carries out (decision D25).
 * Today one kind: `create_application`. Single-use; expires; the result is kept for audit.
 */
export const copilotProposals = pgTable(
  "copilot_proposals",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => copilotThreads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => staffUsers.id),
    kind: text("kind").$type<"create_application" | "create_task" | "request_approval">().notNull(),
    /** What will be done on Confirm, validated when proposed and again on Confirm. */
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
    /** What the card shows (unit, applicant, viewing time as labels). */
    summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
    status: text("status").$type<"pending" | "confirmed" | "cancelled" | "failed">().notNull().default("pending"),
    /** Confirmed: the application id and ref. Failed: the reason. */
    result: jsonb("result").$type<Record<string, unknown>>(),
    expiresAt: ts("expires_at").notNull(),
    createdAt: ts("created_at").notNull(),
    decidedAt: ts("decided_at"),
  },
  (t) => [index("copilot_proposals_thread_idx").on(t.threadId, t.createdAt)],
);

/**
 * Text the copilot drafted for a person to edit and use (D26): an email to the tenant or a note on
 * an approval. Nothing here is ever sent or posted by the copilot.
 */
export const copilotDrafts = pgTable(
  "copilot_drafts",
  {
    id: id(),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => copilotThreads.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => staffUsers.id),
    kind: text("kind").$type<"email" | "approval_note" | "case_summary">().notNull(),
    leaseId: uuid("lease_id").references(() => leases.id),
    approvalId: uuid("approval_id").references(() => approvals.id),
    subject: text("subject"),
    body: text("body").notNull(),
    /** Set when a person used it (sent the email / posted the note), or discarded it. */
    status: text("status").$type<"draft" | "used" | "discarded">().notNull().default("draft"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("copilot_drafts_thread_idx").on(t.threadId, t.createdAt)],
);

/** Notes staff add to an approval for the approver (a copilot draft can prefill one). */
export const approvalNotes = pgTable(
  "approval_notes",
  {
    id: id(),
    approvalId: uuid("approval_id")
      .notNull()
      .references(() => approvals.id),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [index("approval_notes_approval_idx").on(t.approvalId, t.createdAt)],
);

/**
 * Tenancy contract versions (step 5). Fields are copied from records with a source per field;
 * a new version supersedes the open one. Approved (`final_contract`) → sent for signature →
 * signed by every signer → the signed PDF (with a signature record page) is stored with its hash.
 */
export const contracts = pgTable(
  "contracts",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    version: smallint("version").notNull(),
    status: text("status").$type<ContractStatus>().notNull(),
    fields: jsonb("fields").$type<ContractFields>().notNull(),
    sources: jsonb("sources").$type<Record<string, FieldSource>>().notNull(),
    addendum: jsonb("addendum").$type<Addendum>().notNull(),
    flags: jsonb("flags").$type<AddendumFlag[]>().notNull().default([]),
    /** Hash of the records the fields were copied from; a change makes the approval stale. */
    inputHash: text("input_hash").notNull(),
    helperRunId: uuid("helper_run_id"),
    documentId: uuid("document_id"),
    sha256: text("sha256").notNull(),
    approvalId: uuid("approval_id"),
    signedDocumentId: uuid("signed_document_id"),
    signedSha256: text("signed_sha256"),
    sentAt: ts("sent_at"),
    signedAt: ts("signed_at"),
    createdBy: text("created_by").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [
    uniqueIndex("contracts_lease_version_uq").on(t.leaseId, t.version),
    index("contracts_lease_idx").on(t.leaseId, t.createdAt),
  ],
);

/** One row per person who signs a contract version (tenant and landlord), with the signing evidence. */
export const contractSigners = pgTable(
  "contract_signers",
  {
    id: id(),
    contractId: uuid("contract_id")
      .notNull()
      .references(() => contracts.id),
    partyId: uuid("party_id")
      .notNull()
      .references(() => parties.id),
    role: text("role").$type<"tenant" | "landlord">().notNull(),
    /** The name the signer must type (typo-class match), from the contract fields. */
    nameEn: text("name_en").notNull(),
    email: text("email"),
    linkId: uuid("link_id"),
    outboundMessageId: uuid("outbound_message_id"),
    signedAt: ts("signed_at"),
    typedName: text("typed_name"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    inboundEventId: uuid("inbound_event_id"),
    createdAt: ts("created_at").notNull(),
  },
  (t) => [uniqueIndex("contract_signers_uq").on(t.contractId, t.role)],
);

/**
 * Every attempt to register a lease in Ejari (step 6), under the `ejari_submission` approval it
 * belongs to. Attempt 2 exists only after one typo-class auto-fix; anything else goes to a person.
 */
export const ejariSubmissions = pgTable(
  "ejari_submissions",
  {
    id: id(),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id),
    approvalId: uuid("approval_id").notNull(),
    attempt: smallint("attempt").notNull(),
    payload: jsonb("payload").$type<EjariPayload>().notNull(),
    payloadSha256: text("payload_sha256").notNull(),
    status: text("status").$type<"queued" | "sending" | "issued" | "rejected" | "error">().notNull(),
    /** Unreachable-registry retries for this attempt. */
    tries: smallint("tries").notNull().default(0),
    ejariNo: text("ejari_no"),
    reasons: jsonb("reasons").$type<EjariRejection[]>().notNull().default([]),
    error: text("error"),
    /** The typo-class corrections made before this attempt (attempt 2 only). */
    autofix: jsonb("autofix").$type<EjariAutofix[]>(),
    certificateDocumentId: uuid("certificate_document_id"),
    createdAt: ts("created_at").notNull(),
    completedAt: ts("completed_at"),
  },
  (t) => [
    uniqueIndex("ejari_submissions_attempt_uq").on(t.approvalId, t.attempt),
    index("ejari_submissions_lease_idx").on(t.leaseId, t.createdAt),
  ],
);
