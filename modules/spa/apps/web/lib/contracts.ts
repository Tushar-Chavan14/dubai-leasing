import {
  DEAL_STATES,
  DealType,
  FURNISHED,
  LEAD_SOURCES,
  LEAD_STATUSES,
  SpaAmlPolicy,
  SpaKycConfig,
  SpaRole,
  UNIT_TYPES,
  VIEWING_STATUSES,
} from "@spa/core";
import { z } from "zod";

/**
 * What the staff screens read from the engine's C29 routes (S57), parsed at the boundary (zod). The engine already
 * filtered by role and masked personal numbers; the web adds nothing of its own and shows only what is here.
 */
const iso = z.string();
const Stage = z.enum([...DEAL_STATES, "ON_HOLD"]);
const Actor = z.object({ kind: z.string(), label: z.string() });

export const WaitingFor = z
  .object({ role: SpaRole.nullable(), label: z.string(), since: iso, waitedDays: z.number().int() })
  .nullable();

export const DealRowView = z.object({
  id: z.string(),
  ref: z.string(),
  type: DealType,
  typeLabel: z.string(),
  stage: Stage,
  stageLabel: z.string(),
  property: z.object({ kind: z.enum(["unit", "listing"]), label: z.string() }),
  sellers: z.array(z.string()),
  buyers: z.array(z.string()),
  priceFils: z.number().int(),
  onHold: z.boolean(),
  inDefault: z.boolean(),
  waitingFor: WaitingFor,
  owner: z.object({ label: z.string() }).nullable(),
  createdAt: iso,
  ageDays: z.number().int(),
});
export type DealRowView = z.infer<typeof DealRowView>;
export const DealsPage = z.object({ items: z.array(DealRowView), nextCursor: z.string().nullable() });
export type DealsPage = z.infer<typeof DealsPage>;

export const PartyView = z.object({
  partyId: z.string(),
  role: z.enum(["buyer", "seller"]),
  order: z.number().int(),
  shareBps: z.number().int().nullable(),
  kind: z.enum(["person", "company"]),
  name: z.string(),
  kyc: z.object({ status: z.string() }).nullable(),
  compliance: z.object({ label: z.string(), status: z.enum(["open", "none"]) }),
});
export type PartyView = z.infer<typeof PartyView>;

export const StepView = z.object({
  key: z.string(),
  label: z.string(),
  status: z.enum(["done", "current", "upcoming"]),
});
export type StepView = z.infer<typeof StepView>;

export const ApprovalItem = z.object({
  id: z.string(),
  gate: z.string(),
  gateLabel: z.string().optional(),
  title: z.string(),
  status: z.string(),
  approverRole: SpaRole.optional(),
  proposedBy: Actor.optional(),
  createdAt: iso.optional(),
  decidedAt: iso.nullable().optional(),
  decidedBy: z.string().nullable().optional(),
  decisionNote: z.string().nullable().optional(),
  reasons: z.array(z.string()).optional(),
});
export type ApprovalItem = z.infer<typeof ApprovalItem>;

export const TaskItem = z.object({
  id: z.string(),
  dealId: z.string().nullable(),
  kind: z.string(),
  role: SpaRole,
  title: z.string(),
  status: z.string(),
  createdAt: iso,
  doneAt: iso.nullable(),
});
export type TaskItem = z.infer<typeof TaskItem>;
export const TasksPage = z.object({ items: z.array(TaskItem), nextCursor: z.string().nullable() });

export const HelperRunItem = z.object({
  id: z.string(),
  helper: z.string(),
  status: z.string(),
  reasons: z.array(z.string()),
  modelTag: z.string().nullable(),
  createdAt: iso,
});
export type HelperRunItem = z.infer<typeof HelperRunItem>;

export const PlanRow = z.object({
  seq: z.number().int(),
  label: z.string(),
  dueOn: z.string().nullable(),
  milestone: z.string().nullable(),
  amountFils: z.number().int(),
  /** Not sent by the engine yet: when it is, `false` shows "Read, not confirmed". */
  confirmed: z.boolean().optional(),
});
export type PlanRow = z.infer<typeof PlanRow>;

export const DealHeader = DealRowView.extend({
  rulesVersion: z.string(),
  policyVersion: z.number().int().nullable().optional(),
  sellerMortgage: z.boolean(),
  buyerMortgage: z.boolean(),
  planTakenOver: z.boolean(),
  targetTransferOn: z.string().nullable(),
  unitNo: z.string().nullable(),
  projectCode: z.string().nullable(),
  inDefaultSince: z.string().nullable(),
  inDefaultReason: z.string().nullable(),
});
export type DealHeader = z.infer<typeof DealHeader>;

const Compliance = z.object({ label: z.string(), status: z.enum(["open", "none"]) });

/** A section that fails its own shape is left out rather than shown wrong. */
export const RecordView = z.object({
  deal: DealHeader,
  waitingFor: WaitingFor,
  sections: z.record(z.string(), z.unknown()),
});
export type RecordView = z.infer<typeof RecordView>;

/** The review of the latest agreement (C25, S60): suggestions for legal, never a decision. */
export const AgreementReviewSection = z.object({
  agreement: z.object({ id: z.string(), kind: z.string(), version: z.number().int(), status: z.string() }),
  review: z.object({
    status: z.enum(["pending", "ready", "held", "unavailable", "off"]),
    label: z.string(),
    note: z.string(),
    flags: z.array(
      z.object({
        kind: z.enum(["conflict", "unknown_amount", "unknown_date", "instruction_like"]),
        quote: z.string(),
        note: z.string(),
        in: z.enum(["agreement", "conditions"]),
        source: z.enum(["model", "code"]),
      }),
    ),
    dropped: z.number().int(),
    instructionFound: z.boolean(),
    model: z.string().nullable(),
    reviewedAt: z.string().nullable(),
  }),
});
export type AgreementReviewSection = z.infer<typeof AgreementReviewSection>;

/** What parties still owe and what was sent (C25, S60): reasons are the fixed words, so staff read what the party read. */
export const ChasingSection = z.object({
  paused: z.boolean(),
  pausedSince: z.string().nullable(),
  template: z.object({ version: z.number().int() }).nullable(),
  schedule: z.object({ reminderDays: z.array(z.number().int()), taskAfterDays: z.number().int() }),
  open: z.array(
    z.object({
      partyName: z.string(),
      item: z.string(),
      reason: z.string(),
      chased: z.number().int(),
      lastChasedAt: z.string().nullable(),
    }),
  ),
  history: z.array(
    z.object({
      partyName: z.string(),
      reason: z.string(),
      step: z.number().int(),
      templateVersion: z.number().int(),
      sentAt: z.string(),
    }),
  ),
});
export type ChasingSection = z.infer<typeof ChasingSection>;

/** The evidence sections (C39, S71). Each is absent for a role that may not read it and for a deal that has not reached it. */
export const DocumentItem = z.object({
  kind: z.string(),
  partyName: z.string().nullable(),
  uploadedOn: z.string(),
  readState: z.enum(["read", "not_read"]),
  confirmed: z.boolean(),
});
export type DocumentItem = z.infer<typeof DocumentItem>;
export const AmlSection = z.object({
  caseCount: z.number().int(),
  riskLevel: z.enum(["low", "medium", "high"]).nullable(),
  cases: z.array(z.object({ id: z.string(), status: z.string(), openedOn: z.string() })),
});
export type AmlSection = z.infer<typeof AmlSection>;
export const AgreementSection = z.object({
  kind: z.string(),
  version: z.number().int(),
  status: z.string(),
  templateName: z.string(),
  templateVersion: z.number().int(),
  preparedOn: z.string(),
});
export type AgreementSection = z.infer<typeof AgreementSection>;
export const SigningSection = z.object({
  status: z.string(),
  completedOn: z.string().nullable(),
  signers: z.array(
    z.object({
      seq: z.number().int(),
      role: z.string(),
      name: z.string(),
      state: z.enum(["signed", "waiting", "link_expired"]),
      linkExpiresOn: z.string(),
    }),
  ),
});
export type SigningSection = z.infer<typeof SigningSection>;
export const NocSection = z.object({
  status: z.string(),
  issuedOn: z.string(),
  expiresOn: z.string(),
  serviceChargesCleared: z.boolean(),
  paidFils: z.number().int().nullable(),
  paidConfirmed: z.boolean(),
  mismatches: z.array(z.string()),
});
export type NocSection = z.infer<typeof NocSection>;
export const FinanceSection = z.object({
  bankLetters: z.array(
    z.object({
      side: z.string(),
      kind: z.string(),
      issuedOn: z.string(),
      validUntil: z.string().nullable(),
      amountFils: z.number().int().nullable(),
      confirmed: z.boolean(),
    }),
  ),
  payments: z.array(
    z.object({
      seq: z.number().int(),
      status: z.string(),
      method: z.string(),
      amountReadFils: z.number().int().nullable(),
      amountFils: z.number().int().nullable(),
      paidOn: z.string().nullable(),
      account: z.string().nullable(),
      intoEscrow: z.boolean(),
      note: z.string().nullable(),
    }),
  ),
});
export type FinanceSection = z.infer<typeof FinanceSection>;
export const SettlementSection = z.object({
  statement: z
    .object({
      version: z.number().int(),
      status: z.string(),
      priceFils: z.number().int(),
      buyerPaysFils: z.number().int(),
      sellerReceivesFils: z.number().int(),
      differenceFils: z.number().int(),
      balancesToZero: z.boolean(),
      lines: z.array(
        z.object({
          seq: z.number().int(),
          code: z.string(),
          payer: z.string(),
          payee: z.string(),
          label: z.string(),
          amountFils: z.number().int(),
          source: z.string(),
        }),
      ),
    })
    .nullable(),
  reasons: z.array(z.string()),
});
export type SettlementSection = z.infer<typeof SettlementSection>;
export const RegistrationSection = z.object({
  attempts: z.array(
    z.object({
      kind: z.string(),
      attempt: z.number().int(),
      status: z.string(),
      registryNo: z.string().nullable(),
      issuedOn: z.string().nullable(),
      createdOn: z.string(),
      reasons: z.array(z.object({ code: z.string(), field: z.string().nullable().optional(), message: z.string() })),
    }),
  ),
});
export type RegistrationSection = z.infer<typeof RegistrationSection>;

export interface RecordSections {
  /** Evidence sections (C39): null when the engine sent none (role or step), never an empty shell. */
  documents?: DocumentItem[] | null;
  aml?: AmlSection | null;
  agreement?: AgreementSection | null;
  signing?: SigningSection | null;
  noc?: NocSection | null;
  finance?: FinanceSection | null;
  settlement?: SettlementSection | null;
  registration?: RegistrationSection | null;
  parties: PartyView[];
  steps: StepView[];
  compliance: z.infer<typeof Compliance> | null;
  approvals: ApprovalItem[];
  tasks: TaskItem[];
  helperRuns: HelperRunItem[];
  /** Absent for a deal with no instalments. */
  paymentPlan: PlanRow[] | null;
  /** Absent before legal's step (C25). */
  agreementReview: AgreementReviewSection | null;
  /** Absent for a closed deal (C25). */
  chasing: ChasingSection | null;
}
const list = <T extends z.ZodType>(schema: T, raw: unknown): z.infer<T>[] => {
  const r = z.array(schema).safeParse(raw);
  return r.success ? r.data : [];
};
export function readSections(sections: Record<string, unknown>): RecordSections {
  const plan = z.array(PlanRow).safeParse(sections.payment_plan);
  const c = Compliance.safeParse(sections.compliance);
  const agreement = AgreementReviewSection.safeParse(sections.agreement_review);
  const chasing = ChasingSection.safeParse(sections.chasing);
  const one = <T extends z.ZodType>(schema: T, key: string) => {
    const r = schema.safeParse(sections[key]);
    return r.success ? r.data : null;
  };
  const documents = z.array(DocumentItem).safeParse(sections.documents);
  return {
    documents: documents.success ? documents.data : null,
    aml: one(AmlSection, "aml"),
    agreement: one(AgreementSection, "agreement"),
    signing: one(SigningSection, "signing"),
    noc: one(NocSection, "noc"),
    finance: one(FinanceSection, "finance"),
    settlement: one(SettlementSection, "settlement"),
    registration: one(RegistrationSection, "registration"),
    parties: list(PartyView, sections.parties),
    steps: list(StepView, sections.steps),
    compliance: c.success ? c.data : null,
    approvals: list(ApprovalItem, sections.approvals),
    tasks: list(TaskItem, sections.tasks),
    helperRuns: list(HelperRunItem, sections.helper_runs),
    paymentPlan: "payment_plan" in sections && plan.success ? plan.data : null,
    agreementReview: agreement.success ? agreement.data : null,
    chasing: chasing.success ? chasing.data : null,
  };
}

export const EventItem = z.object({
  id: z.string(),
  type: z.string(),
  label: z.string(),
  at: iso,
  actor: Actor,
  fromState: z.string().nullable(),
  toState: z.string().nullable(),
});
export type EventItem = z.infer<typeof EventItem>;
export const EventsPage = z.object({ items: z.array(EventItem), nextCursor: z.string().nullable() });

export const Summary = z.object({
  role: SpaRole,
  /** M5 (S79): today's viewings and new leads, for the Work badge. */
  leads: z.object({ viewings: z.number().int(), newLeads: z.number().int() }).optional(),
  inbox: z.object({ open: z.number().int() }),
  tasks: z.object({ open: z.number().int() }),
  deals: z.object({
    open: z.number().int(),
    mine: z.number().int(),
    onHold: z.number().int(),
    inDefault: z.number().int(),
    byStage: z.record(z.string(), z.number().int()),
  }),
});
export type Summary = z.infer<typeof Summary>;

/** The review of an agreement as the engine puts it on the `agreement_approval` card (S60). */
export const AgreementReviewView = AgreementReviewSection.shape.review;
export type AgreementReviewView = z.infer<typeof AgreementReviewView>;

/** The result a `helper_review` card holds (S63): the helper, its status and the reasons it gave (masked by the engine). */
export const HeldResult = z.object({
  helper: z.string(),
  label: z.string(),
  status: z.string(),
  reasons: z.array(z.string()),
});
export type HeldResult = z.infer<typeof HeldResult>;

/**
 * An inbox item: the gate as this role may read it (a compliance gate never arrives for another role). `mayDecide` is
 * the engine's answer for the signed-in user (right role, not admin, not their own proposal): the only thing that
 * decides whether a decide button is drawn.
 */
export const InboxItem = ApprovalItem.extend({
  entity: z.object({ kind: z.string(), id: z.string() }),
  entityRef: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  proposal: z.record(z.string(), z.unknown()).optional(),
  mayDecide: z
    .union([z.object({ ok: z.literal(true) }), z.object({ ok: z.literal(false), reason: z.string() })])
    .optional(),
  agreementReview: AgreementReviewView.optional(),
  heldResult: HeldResult.optional(),
});
export type InboxItem = z.infer<typeof InboxItem>;
export const InboxPage = z.object({ items: z.array(InboxItem), nextCursor: z.string().nullable() });

/** Settings → AI helpers (C24, S59): what the engine sends an admin or a sales manager. */
export const HelperSettings = z.object({
  canEdit: z.boolean(),
  helpers: z.array(
    z.object({
      helper: z.string(),
      label: z.string(),
      model: z.string().nullable(),
      availableScopes: z.array(z.string()),
      /** The scopes that may be set to review; absent means all of them. */
      reviewScopes: z.array(z.string()).optional(),
      settings: z.array(
        z.object({
          scope: z.string(),
          mode: z.enum(["auto", "review", "off"]),
          version: z.number().int(),
          setAt: z.string().nullable(),
          setBy: z.string().nullable(),
        }),
      ),
    }),
  ),
});
export type HelperSettings = z.infer<typeof HelperSettings>;

/** The signed-in user's alerts (C23, S62): the sentence is written by the engine (gate, deal and hours only). */
export const AlertItem = z.object({
  id: z.string(),
  text: z.string(),
  level: z.enum(["approver", "manager"]),
  dealId: z.string().nullable(),
  dealRef: z.string().nullable(),
  createdAt: iso,
  readAt: iso.nullable(),
});
export type AlertItem = z.infer<typeof AlertItem>;
export const AlertsView = z.object({ items: z.array(AlertItem), unread: z.number().int() });
export type AlertsView = z.infer<typeof AlertsView>;

/** Compliance records (C23, S62): only the two compliance roles are answered; everyone else gets a 403. */
export const RetentionReview = z.object({
  id: z.string(),
  period: z.string(),
  status: z.enum(["listed", "approved"]),
  retentionYears: z.number().int(),
  cutoffOn: z.string(),
  createdAt: iso,
  approvedBy: z.string().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: iso.nullable(),
  items: z.array(z.object({ ref: z.string(), endedOn: z.string(), status: z.enum(["listed", "approved"]) })),
});
export type RetentionReview = z.infer<typeof RetentionReview>;
export const RetentionList = z.object({ items: z.array(RetentionReview) });
export const ReportItem = z.object({
  id: z.string(),
  period: z.string(),
  generatedAt: iso,
  csvSha256: z.string(),
  pdfSha256: z.string(),
});
export type ReportItem = z.infer<typeof ReportItem>;
export const ReportList = z.object({ items: z.array(ReportItem) });
export const ExportItem = z.object({
  id: z.string(),
  kind: z.enum(["case_pack", "monthly_report"]),
  dealRef: z.string().nullable(),
  requestedBy: z.string(),
  requestedByName: z.string(),
  requestedAt: iso,
  sha256: z.string(),
  sizeBytes: z.number().int(),
  fileCount: z.number().int(),
});
export type ExportItem = z.infer<typeof ExportItem>;
export const ExportLogView = z.object({ items: z.array(ExportItem) });

// ---------------------------------------------------------------------------------------------
// C32 (S64): Inventory and Listings. The engine filtered by role and company kind and masked the escrow account; the web
// shows what is here and nothing else.

const UnitStateKey = z.enum(["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"]);
export type UnitStateKey = z.infer<typeof UnitStateKey>;

/** One marketing photo of a project, unit or listing (S75). Its bytes come through `/media/<id>`, never a path. */
export const MediaItem = z.object({ id: z.string(), caption: z.string().nullable(), sort: z.number().int() });
export type MediaItem = z.infer<typeof MediaItem>;
export const ActivityItem = z.object({
  id: z.string(),
  label: z.string(),
  at: z.string(),
  actor: z.string(),
  changed: z.array(z.string()),
  note: z.string().nullable().default(null),
});
export type ActivityItem = z.infer<typeof ActivityItem>;

const UnitType = z.enum(UNIT_TYPES);
const OpenDealRef = z.object({
  id: z.string(),
  ref: z.string(),
  state: z.string(),
  stageLabel: z.string().default(""),
});

export const UnitRow = z.object({
  id: z.string(),
  code: z.string(),
  state: UnitStateKey,
  type: UnitType.nullable(),
  bedrooms: z.number().int().nullable(),
  internalSqft: z.number().int().nullable(),
  view: z.string().nullable(),
  floor: z.number().int().nullable(),
  project: z.object({ id: z.string(), name: z.string() }).nullable(),
  building: z.object({ id: z.string(), name: z.string() }).nullable(),
  priceFils: z.number().nullable(),
  coverMediaId: z.string().nullable(),
  openDeal: OpenDealRef.nullable(),
});
export type UnitRow = z.infer<typeof UnitRow>;
export const UnitsPage = z.object({
  items: z.array(UnitRow),
  next: z.string().nullable(),
  facets: z.object({
    projects: z.array(z.object({ id: z.string(), name: z.string() })),
    types: z.array(UnitType),
    beds: z.array(z.number().int()),
    /** Units per status under the other filters (the status chips' counts). */
    states: z.partialRecord(UnitStateKey, z.number().int()).default({}),
  }),
});
export type UnitsPage = z.infer<typeof UnitsPage>;

export const UnitRecord = z.object({
  id: z.string(),
  code: z.string(),
  state: UnitStateKey,
  type: UnitType.nullable(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  internalSqft: z.number().int().nullable(),
  balconySqft: z.number().int().nullable(),
  floor: z.number().int().nullable(),
  view: z.string().nullable(),
  parkingSpaces: z.number().int().nullable(),
  description: z.string().nullable(),
  project: z
    .object({ id: z.string(), code: z.string(), name: z.string(), community: z.string().nullable() })
    .nullable(),
  building: z.object({ id: z.string(), code: z.string(), name: z.string() }).nullable(),
  media: z.array(MediaItem),
  priceHistory: z.array(z.object({ version: z.number().int(), publishedAt: z.string(), priceFils: z.number() })),
  currentPriceFils: z.number().nullable(),
  openDeal: OpenDealRef.nullable(),
  pastDeals: z.array(OpenDealRef),
  activity: z.array(ActivityItem),
});
export type UnitRecord = z.infer<typeof UnitRecord>;

export const ProjectRow = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  emirate: z.string(),
  anticipatedCompletionOn: z.string().nullable(),
  community: z.string().nullable().default(null),
  coverMediaId: z.string().nullable().default(null),
  buildings: z.number().int(),
  units: z.number().int(),
  byState: z.record(UnitStateKey, z.number().int()),
  priceListVersion: z.number().int().nullable(),
});
export type ProjectRow = z.infer<typeof ProjectRow>;
export const ProjectsList = z.object({ items: z.array(ProjectRow), unplacedUnits: z.number().int() });
export type ProjectsList = z.infer<typeof ProjectsList>;

export const ProjectRecord = z.object({
  id: z.string(),
  code: z.string(),
  name: z.string(),
  emirate: z.string(),
  anticipatedCompletionOn: z.string().nullable(),
  community: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  description: z.string().nullable().default(null),
  /** M5 (S79): who gets this project's leads and viewings; the choices come only for an admin. */
  salesAgent: z.object({ id: z.string(), name: z.string() }).nullable().default(null),
  salesAgentOptions: z.array(z.object({ id: z.string(), name: z.string() })).default([]),
  media: z.array(MediaItem).default([]),
  activity: z.array(ActivityItem).default([]),
  templateKind: z.string().nullable(),
  template: z.object({ name: z.string(), version: z.number().int() }).nullable(),
  /** The last four characters only (the engine masks it; there is no other field). */
  escrow: z.object({ bankName: z.string(), accountMasked: z.string() }).nullable(),
  buildings: z.array(z.object({ id: z.string(), code: z.string(), name: z.string(), units: z.number().int() })),
  units: z.array(
    z.object({
      id: z.string(),
      code: z.string(),
      buildingId: z.string(),
      state: UnitStateKey,
      stateLabel: z.string(),
      listPriceFils: z.number().int().nullable(),
      deal: z
        .object({ id: z.string(), ref: z.string(), stage: z.string(), stageLabel: z.string(), open: z.boolean() })
        .nullable(),
    }),
  ),
  priceLists: z.array(
    z.object({
      id: z.string(),
      version: z.number().int(),
      status: z.enum(["draft", "published"]),
      publishedAt: z.string().nullable(),
      prices: z.number().int(),
      inUse: z.boolean(),
    }),
  ),
});
export type ProjectRecord = z.infer<typeof ProjectRecord>;

export const PermitView = z.object({
  no: z.string().nullable(),
  issuedOn: z.string().nullable(),
  expiresOn: z.string().nullable(),
  daysLeft: z.number().int().nullable(),
  status: z.enum(["none", "valid", "expiring", "expired"]),
});
export type PermitView = z.infer<typeof PermitView>;
const PageState = z.object({ state: z.enum(["live", "hidden", "off"]), label: z.string() });

const ListingStateKey = z.enum(["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED", "UNDER_OFFER", "SOLD", "WITHDRAWN"]);
export type ListingStateKey = z.infer<typeof ListingStateKey>;

export const ListingRowView = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  community: z.string().nullable(),
  bedrooms: z.number().int().nullable().default(null),
  bathrooms: z.number().int().nullable().default(null),
  sizeSqft: z.number().int().nullable().default(null),
  unitType: UnitType.nullable().default(null),
  view: z.string().nullable().default(null),
  agent: z.string().nullable().default(null),
  coverMediaId: z.string().nullable().default(null),
  sellerKind: z.string(),
  askingPriceFils: z.number().int().nullable(),
  state: z.string(),
  stateLabel: z.string(),
  permit: PermitView,
  page: PageState,
  offer: z.object({ state: z.string(), label: z.string(), validUntil: z.string() }).nullable(),
});
export type ListingRowView = z.infer<typeof ListingRowView>;
export const ListingsPage = z.object({
  items: z.array(ListingRowView),
  nextCursor: z.string().nullable(),
  facets: z
    .object({
      communities: z.array(z.string()),
      types: z.array(UnitType),
      beds: z.array(z.number().int()),
      agents: z.array(z.object({ id: z.string(), name: z.string() })),
      /** Listings per status under the other filters (the status chips' counts). */
      states: z.partialRecord(ListingStateKey, z.number().int()).default({}),
    })
    .default({ communities: [], types: [], beds: [], agents: [], states: {} }),
});
export type ListingsPage = z.infer<typeof ListingsPage>;

export const LISTING_STEP_EVENTS = ["VERIFY", "ACTIVATE", "PUBLISH", "UNPUBLISH", "WITHDRAW"] as const;
export type ListingStepEvent = (typeof LISTING_STEP_EVENTS)[number];
const OwnershipKind = z.enum(["title_deed", "oqood"]);

export const ListingRecord = z.object({
  id: z.string(),
  ref: z.string(),
  title: z.string(),
  community: z.string().nullable(),
  description: z.string().nullable(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable().default(null),
  sizeSqft: z.number().int().nullable(),
  unitType: UnitType.nullable().default(null),
  floor: z.number().int().nullable().default(null),
  view: z.string().nullable().default(null),
  parkingSpaces: z.number().int().nullable().default(null),
  furnished: z.enum(FURNISHED).nullable().default(null),
  askingPriceFils: z.number().int().nullable(),
  state: z.string(),
  stateLabel: z.string(),
  agent: z.string().nullable(),
  agentUserId: z.string().nullable().default(null),
  sellerKind: z.string(),
  /** Null for a role that doesn't see sellers (admin). */
  sellers: z
    .array(
      z.object({
        partyId: z.string().default(""),
        name: z.string(),
        kind: z.enum(["person", "company"]),
        shareBps: z.number().int().nullable(),
        signed: z.boolean(),
      }),
    )
    .nullable(),
  ownership: z
    .object({
      kind: OwnershipKind,
      matched: z.boolean(),
      /** The document's number and owners, for the sales roles only. */
      ref: z.string().nullable().optional(),
      owners: z.array(z.string()).nullable().optional(),
      waitingForManager: z.boolean().optional(),
    })
    .nullable(),
  permit: PermitView,
  page: PageState,
  offer: z
    .object({
      state: z.string(),
      label: z.string(),
      priceFils: z.number().int(),
      validUntil: z.string(),
      createdAt: z.string(),
    })
    .nullable(),
  media: z.array(MediaItem).default([]),
  documents: z
    .array(
      z.object({
        id: z.string(),
        kind: z.enum(["title_deed", "oqood", "listing_agreement", "permit"]),
        kindLabel: z.string(),
        fileName: z.string(),
        uploadedAt: z.string(),
      }),
    )
    .nullable()
    .default(null),
  next: z
    .object({ event: z.enum(LISTING_STEP_EVENTS), label: z.string(), reasons: z.array(z.string()) })
    .nullable()
    .default(null),
  actions: z.array(z.enum(["UNPUBLISH", "WITHDRAW"])).default([]),
  lastUnpublish: z.object({ on: z.string(), reason: z.string() }).nullable().default(null),
  openDeal: OpenDealRef.omit({ state: true }).nullable().default(null),
  activity: z.array(ActivityItem).default([]),
});
export type ListingRecord = z.infer<typeof ListingRecord>;

/** The Compliance screen's case tabs and rows (C33, S65): what `GET /api/compliance/cases` answers a compliance role. */
export const CASE_TABS = ["open", "info_requested", "edd", "reported", "closed"] as const;
export type CaseTab = (typeof CASE_TABS)[number];
/** The model's (or the template's) wording, always labelled. It is never a finding and is shown as plain text. */
export const Suggestion = z.object({
  label: z.string(),
  text: z.string(),
  fromModel: z.boolean(),
  model: z.string().nullable(),
  instructionLike: z.boolean(),
});
export type Suggestion = z.infer<typeof Suggestion>;
export const CaseRow = z.object({
  id: z.string(),
  kind: z.enum(["case", "edd"]),
  status: z.string(),
  dealId: z.string(),
  dealRef: z.string(),
  openedAt: iso,
  closedAt: iso.nullable(),
  rules: z.array(z.string()),
  partyName: z.string().nullable(),
  suggestion: Suggestion.nullable(),
});
export type CaseRow = z.infer<typeof CaseRow>;
export const CasesPage = z.object({ items: z.array(CaseRow), nextCursor: z.string().nullable() });
export type CasesPage = z.infer<typeof CasesPage>;

const Check = z.object({
  rule: z.enum(["sanctions", "pep"]),
  score: z.number().nullable(),
  threshold: z.number().nullable(),
  thresholdPending: z.boolean(),
  over: z.boolean(),
  list: z.string(),
  date: z.string(),
});
export const CaseSubject = z.object({
  subjectKey: z.string(),
  partyId: z.string().nullable(),
  label: z.string(),
  screening: z
    .object({
      id: z.string(),
      trigger: z.string(),
      listLabel: z.string(),
      listVersion: z.string(),
      exact: z.boolean(),
      notScreened: z.boolean(),
      date: z.string(),
      checks: z.array(Check),
      entries: z.array(z.object({ list: z.string(), entryId: z.string(), score: z.number() })),
    })
    .nullable(),
  hits: z.array(z.object({ rule: z.string(), severity: z.string(), detail: z.string(), listVersion: z.string() })),
  risk: z
    .object({
      level: z.enum(["low", "medium", "high"]),
      points: z.number().int(),
      flagged: z.boolean(),
      policyVersion: z.number().int(),
      rulesVersion: z.string(),
      breakdown: z.array(z.object({ source: z.string(), points: z.number() })).catch([]),
      date: z.string(),
    })
    .nullable(),
});
export type CaseSubject = z.infer<typeof CaseSubject>;
export const CaseView = z.object({
  label: z.string(),
  case: z.object({
    id: z.string(),
    kind: z.enum(["case", "edd"]),
    status: z.string(),
    openedAt: iso,
    closedAt: iso.nullable(),
  }),
  dealId: z.string(),
  dealRef: z.string(),
  suggestion: Suggestion.nullable(),
  subjects: z.array(CaseSubject),
  sourceOfFunds: z.array(
    z.object({
      id: z.string(),
      profile: z.string(),
      fileName: z.string(),
      partyName: z.string(),
      fields: z.record(z.string(), z.unknown()),
      instructionFound: z.boolean(),
      readAt: iso,
    }),
  ),
  approval: InboxItem.nullable(),
  trail: z.array(EventItem),
});
export type CaseView = z.infer<typeof CaseView>;

// ---- C34 (S66): Settings screens ---------------------------------------------------------------------------------------

const TemplateKind = z.enum(["spa", "mou", "assignment", "listing_agreement"]);
const VersionStatus = z.enum(["in_review", "approved", "rejected", "retired"]);
const UploadStatus = z.enum(["queued", "reading", "done", "failed", "needs_human"]);

/** Settings → Templates (S66): the list, one template, one version. Model text (headings, labels) is shown as plain text only. */
export const TemplateList = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      documentKind: TemplateKind,
      projectCodes: z.array(z.string()),
      createdAt: iso,
      inUse: z.object({ versionId: z.string(), version: z.number().int() }).nullable(),
      latest: z.object({ versionId: z.string(), version: z.number().int(), status: VersionStatus }).nullable(),
    }),
  ),
});
export type TemplateList = z.infer<typeof TemplateList>;

export const TemplateRecord = z.object({
  id: z.string(),
  name: z.string(),
  documentKind: TemplateKind,
  projectCodes: z.array(z.string()),
  createdAt: iso,
  versions: z.array(
    z.object({
      id: z.string(),
      version: z.number().int(),
      status: VersionStatus,
      createdAt: iso,
      decidedAt: iso.nullable(),
      approvalId: z.string().nullable(),
      rulesVersion: z.string(),
      blockers: z.number().int(),
      warnings: z.number().int(),
    }),
  ),
  uploads: z.array(
    z.object({
      id: z.string(),
      fileName: z.string(),
      status: UploadStatus,
      reason: z.string().nullable(),
      versionId: z.string().nullable(),
      uploadedAt: iso,
      finishedAt: iso.nullable(),
    }),
  ),
});
export type TemplateRecord = z.infer<typeof TemplateRecord>;

export const TemplateVersionView = z.object({
  id: z.string(),
  templateId: z.string(),
  templateName: z.string(),
  documentKind: TemplateKind,
  version: z.number().int(),
  status: VersionStatus,
  approvalId: z.string().nullable(),
  rulesVersion: z.string(),
  createdAt: iso,
  decidedAt: iso.nullable(),
  checks: z.array(
    z.object({
      code: z.string(),
      severity: z.enum(["blocker", "warning"]),
      message: z.string(),
      blankId: z.string().optional(),
    }),
  ),
  blanks: z.array(
    z.object({
      id: z.string(),
      label: z.string(),
      kind: z.string(),
      role: z.string(),
      field: z.string(),
      fieldType: z.string().nullable(),
      source: z.string(),
      before: z.string(),
      after: z.string(),
    }),
  ),
  title: z.string().nullable(),
  sections: z.array(
    z.object({ number: z.string().nullable(), heading: z.string().nullable(), paragraphs: z.array(z.string()) }),
  ),
  canRemap: z.boolean(),
  choices: z.array(z.object({ key: z.string(), label: z.string(), type: z.string() })),
});
export type TemplateVersionView = z.infer<typeof TemplateVersionView>;

/** Settings → KYC forms (S41, S66): the index, and one form with its draft and published versions. */
const KycRoleName = z.enum(["buyer_person", "seller_person", "company_party", "beneficial_owner"]);
export const KycIndex = z.object({
  items: z.array(
    z.object({
      role: KycRoleName,
      dealType: DealType.nullable(),
      scope: z.string(),
      version: z.number().int().nullable(),
      hasDraft: z.boolean(),
    }),
  ),
});
export type KycIndex = z.infer<typeof KycIndex>;

export const KycDetail = z.object({
  role: KycRoleName,
  dealType: DealType.nullable(),
  scope: z.string(),
  effective: z.object({ version: z.number().int(), scope: z.string(), config: SpaKycConfig }),
  draft: SpaKycConfig.nullable(),
  versions: z.array(z.object({ version: z.number().int(), publishedAt: iso.nullable() })),
});
export type KycDetail = z.infer<typeof KycDetail>;

/** Settings → Alerts (S62): one entry per gate and one generic compliance entry. */
export const AlertSettingsView = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      hours: z.number().int(),
      isDefault: z.boolean(),
      version: z.number().int(),
    }),
  ),
});
export type AlertSettingsView = z.infer<typeof AlertSettingsView>;

/** The compliance rules page (S42, S66): only the compliance roles are answered. */
export const AmlPolicyView = z.object({
  version: z.number().int(),
  values: SpaAmlPolicy,
  confirmWithCompliance: z.boolean(),
  mayPublish: z.boolean(),
  history: z.array(z.object({ version: z.number().int(), createdAt: iso })),
});
export type AmlPolicyView = z.infer<typeof AmlPolicyView>;

/** A copilot draft read back for the inbox note box (C36, S68): its own user only; the engine answers 404 to anyone else. */
export const CopilotDraftView = z.object({
  id: z.string(),
  kind: z.enum(["email", "summary", "approval_note"]),
  dealId: z.string().nullable(),
  body: z.string(),
  createdAt: z.string(),
});
export type CopilotDraftView = z.infer<typeof CopilotDraftView>;

/** The remaining Settings pages (C40, S72). Read as the engine answers them: statuses and numbers, nothing the engine did not filter. */
export const CompanyView = z.object({
  company: z.object({ name: z.string(), kind: z.enum(["developer", "brokerage", "both"]) }),
  signatories: z.array(
    z.object({
      companyName: z.string(),
      signatories: z.array(
        z.object({ name: z.string(), title: z.string(), authority: z.enum(["poa", "board_resolution"]) }),
      ),
    }),
  ),
});
export type CompanyView = z.infer<typeof CompanyView>;

export const PlansView = z.object({
  page: z.literal("plans"),
  version: z.number().int(),
  values: z.object({
    maxDiscountBps: z.number().int(),
    commission: z.object({ sellerSideBps: z.number().int(), buyerSideBps: z.number().int() }),
    depositBps: z.number().int(),
    holdDays: z.number().int(),
    offerValidityDays: z.number().int(),
    instalmentReminders: z.object({ beforeDays: z.array(z.number().int()), afterDays: z.array(z.number().int()) }),
  }),
});
export type PlansView = z.infer<typeof PlansView>;

export const SigningView = z.object({
  page: z.literal("signing"),
  version: z.number().int(),
  values: z.object({
    signingLinkDays: z.number().int(),
    signingOrder: z.record(DealType, z.array(z.enum(["buyer", "seller"]))),
  }),
});
export type SigningView = z.infer<typeof SigningView>;

export const RulebookView = z.object({
  rulesVersion: z.string(),
  effectiveFrom: z.string(),
  sources: z.array(z.string()),
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      kind: z.enum(["bps", "fils", "text"]),
      status: z.enum(["confirmed", "pending"]),
      bps: z.number().int().optional(),
      amountFils: z.number().int().optional(),
      value: z.string().optional(),
    }),
  ),
  feePreview: z.object({
    priceFils: z.number().int(),
    status: z.enum(["ready", "pending"]),
    totalFils: z.number().int().optional(),
    buyerFils: z.number().int().optional(),
    sellerFils: z.number().int().optional(),
  }),
});
export type RulebookView = z.infer<typeof RulebookView>;

export const UsersView = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      role: SpaRole,
      active: z.boolean(),
      isYou: z.boolean(),
    }),
  ),
});
export type UsersView = z.infer<typeof UsersView>;

export const ModelsView = z.object({
  items: z.array(
    z.object({
      key: z.string(),
      label: z.string(),
      tag: z.string().nullable(),
      status: z.enum(["in_use", "not_set_up"]),
    }),
  ),
});
export const IntegrationsView = z.object({
  items: z.array(
    z.object({ key: z.string(), label: z.string(), status: z.enum(["connected", "simulated", "not_set_up"]) }),
  ),
});
export const DemoClockView = z.object({ today: z.string(), offsetDays: z.number().int(), demo: z.boolean() });
export type DemoClockView = z.infer<typeof DemoClockView>;

/** Settings -> Viewings (S79): the days, hours, slot length, lead time, horizon and the per-email cap. */
export const ViewingsPolicyView = z.object({
  page: z.literal("viewings"),
  version: z.number().int(),
  values: z.object({
    viewings: z.object({
      viewingDays: z.array(z.number().int()),
      viewingStartHour: z.number().int(),
      viewingEndHour: z.number().int(),
      viewingSlotMinutes: z.number().int(),
      viewingLeadHours: z.number().int(),
      viewingHorizonDays: z.number().int(),
    }),
    leads: z.object({ perEmailPerDay: z.number().int() }),
  }),
});
export type ViewingsPolicyView = z.infer<typeof ViewingsPolicyView>;

// ---------------------------------------------------------------------------------------------
// M5 (S79): leads and viewings, as the engine's staff routes answer them. Codes are for logic, labels for the page.

const LeadStatusKey = z.enum(LEAD_STATUSES);
const LeadSourceKey = z.enum(LEAD_SOURCES);
export const LeadRow = z.object({
  id: z.string(),
  ref: z.string(),
  name: z.string(),
  email: z.string(),
  status: LeadStatusKey,
  statusLabel: z.string(),
  source: LeadSourceKey,
  sourceLabel: z.string(),
  propertyRef: z.string(),
  propertyTitle: z.string(),
  lastMessage: z.string(),
  agentName: z.string().nullable(),
  createdAt: iso,
});
export type LeadRow = z.infer<typeof LeadRow>;
export const LeadsPage = z.object({ items: z.array(LeadRow), mineOnly: z.boolean(), canSeeAll: z.boolean() });
export type LeadsPage = z.infer<typeof LeadsPage>;

export const ViewingRow = z.object({
  id: z.string(),
  leadId: z.string(),
  leadRef: z.string(),
  visitorName: z.string(),
  startsAt: iso,
  endsAt: iso,
  status: z.enum(VIEWING_STATUSES),
  statusLabel: z.string(),
  outcomeNote: z.string().nullable(),
  cancelReason: z.string().nullable(),
  propertyRef: z.string(),
  propertyTitle: z.string(),
  propertyKind: z.enum(["listing", "unit"]),
  propertyId: z.string(),
  agentName: z.string().nullable(),
  needsOutcome: z.boolean(),
  canChange: z.boolean(),
});
export type ViewingRow = z.infer<typeof ViewingRow>;
export const ViewingsPage = z.object({
  when: z.enum(["today", "upcoming", "past"]),
  mineOnly: z.boolean(),
  canSeeAll: z.boolean(),
  items: z.array(ViewingRow),
});
export type ViewingsPage = z.infer<typeof ViewingsPage>;

export const LeadRecord = z.object({
  id: z.string(),
  ref: z.string(),
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  status: LeadStatusKey,
  statusLabel: z.string(),
  source: LeadSourceKey,
  sourceLabel: z.string(),
  consentAt: iso,
  createdAt: iso,
  dealId: z.string().nullable(),
  property: z
    .object({ kind: z.enum(["listing", "unit"]), ref: z.string(), title: z.string(), id: z.string() })
    .nullable(),
  agent: z.object({ id: z.string(), name: z.string() }).nullable(),
  messages: z.array(z.object({ seq: z.number().int(), body: z.string(), createdAt: iso })),
  viewings: z.array(
    z.object({
      id: z.string(),
      startsAt: iso,
      endsAt: iso,
      status: z.enum(VIEWING_STATUSES),
      statusLabel: z.string(),
      outcomeNote: z.string().nullable(),
      cancelReason: z.string().nullable(),
      needsOutcome: z.boolean(),
    }),
  ),
  activity: z.array(
    z.object({ id: z.string(), label: z.string(), at: iso, actor: z.string(), note: z.string().nullable() }),
  ),
});
export type LeadRecord = z.infer<typeof LeadRecord>;
export const SlotsAnswer = z.object({ slots: z.array(z.string()) });

/** M6 (S81): the figures a primary deal's form shows, computed by the engine from the rulebook and the policy. */
export const DealQuote = z.object({
  listPriceFils: z.number().int().nullable(),
  priceFils: z.number().int().nullable(),
  discountBps: z.number().int().nullable(),
  maxDiscountBps: z.number().int(),
  withinPolicy: z.boolean(),
  bookingMinBps: z.number().int(),
  bookingMinFils: z.number().int().nullable(),
  bookingFils: z.number().int().nullable(),
  bookingOk: z.boolean(),
  dldFeeFils: z.number().int().nullable(),
  dldFeePayer: z.string(),
  commission: z.object({ buyerSideBps: z.number().int(), sellerSideBps: z.number().int() }),
  reasons: z.array(z.string()),
});
export type DealQuote = z.infer<typeof DealQuote>;

/** A listing's offers (M6): terms, each seller's answer, the deal once accepted. Buyers are null without sales rights. */
export const OfferRow = z.object({
  id: z.string(),
  status: z.enum(["SENT", "ACCEPTED", "REJECTED", "EXPIRED", "WITHDRAWN"]),
  statusLabel: z.string(),
  priceFils: z.number().int(),
  buyerMortgage: z.boolean(),
  sellerMortgage: z.boolean(),
  targetTransferOn: z.string().nullable(),
  conditions: z.string().nullable(),
  validUntil: z.string(),
  createdAt: z.string(),
  sellers: z.array(
    z.object({ name: z.string(), answer: z.enum(["accept", "reject"]).nullable(), answerLabel: z.string() }),
  ),
  buyers: z.array(z.object({ name: z.string(), email: z.string(), shareBps: z.number().int().nullable() })).nullable(),
  deal: z.object({ id: z.string(), ref: z.string() }).nullable(),
  deposit: z.object({ amountFils: z.number().int(), bank: z.string(), chequeOn: z.string() }).nullable().default(null),
  canRecordDeposit: z.boolean().default(false),
  canWithdraw: z.boolean(),
});
export type OfferRow = z.infer<typeof OfferRow>;
export const OffersView = z.object({
  offers: z.array(OfferRow),
  terms: z.object({ depositBps: z.number().int(), validityDays: z.number().int(), validityMaxDays: z.number().int() }),
});
export type OffersView = z.infer<typeof OffersView>;
