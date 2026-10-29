/** Shapes returned by the engine API (only the fields the staff app reads). */

export interface Me {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface LeaseRef {
  id: string;
  ref: string;
  state: string;
  endOn: string;
  annualRentFils: number;
}

export interface UnitRow {
  id: string;
  code: string;
  building: string;
  community: string;
  companyId: string;
  category: "residential" | "commercial" | "retail";
  subtype: string | null;
  emirate: string;
  state: string;
  unitNo: string | null;
  floor: number | null;
  dldPropertyNo: string | null;
  makaniNo: string | null;
  plotNo: string | null;
  dewaPremiseNo: string | null;
  areaSqft: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  parkingSpaces: number | null;
  furnished: boolean | null;
  askingRentFils: number | null;
  priceApprovedAt: string | null;
  ownUseLockUntil: string | null;
  description: string | null;
  virtualTourUrl?: string | null;
  coverPhotoId: string | null;
  photoCount: number;
  lease: LeaseRef | null;
}

export interface UnitPhoto {
  id: string;
  unitId: string;
  caption: string | null;
  sort: number;
  bytes: number;
  mime: string;
}

export interface UnitEventRow {
  id: string;
  type: string;
  actor: string;
  at: string;
  fromState: string | null;
  toState: string | null;
  payload: Record<string, unknown>;
}

export interface UnitDetail extends Omit<UnitRow, "coverPhotoId" | "photoCount" | "lease"> {
  /** The unit's landlord is its company (D44). */
  landlord: { companyId: string; name: string };
  photos: UnitPhoto[];
  leases: {
    id: string;
    ref: string;
    state: string;
    startOn: string;
    endOn: string;
    annualRentFils: number;
    tenantName: string | null;
  }[];
  events: UnitEventRow[];
  approvals: { id: string; gate: string; status: string; title: string; createdAt: string }[];
  checklistMissing: string[];
  priceInRange: boolean;
  /** A null side means no limit on that side. */
  priceRange: { min: number | null; max: number | null; basis: unknown } | null;
  priceBasis?: { ruleId: string | null; sriLabel: string | null };
  actions: { event: "MARK_READY" | "PUBLISH" | "WITHDRAW"; to: string; allowed: boolean; reasons: string[] }[];
}

export interface ApprovalRow {
  id: string;
  gate: string;
  gateLabel: string;
  title: string;
  status: string;
  approverRole: string;
  proposedBy: string;
  createdAt: string;
  entityKind: string;
  entityId: string;
  proposal: Record<string, unknown>;
}

export interface LeaseRow {
  id: string;
  ref: string;
  unitCode: string;
  building: string;
  tenantName: string | null;
  state: string;
  startOn: string;
  endOn: string;
  annualRentFils: number;
  nextDeadline: { milestone: string; dueOn: string } | null;
}

export interface DeadlineRow {
  id: string;
  milestone: string;
  dueOn: string;
  leaseId: string;
  leaseRef: string;
  leaseState: string;
  unitCode: string;
}

export interface TaskRow {
  id: string;
  entityKind: string;
  entityId: string;
  kind: string;
  title: string;
  assigneeRole: string;
  status: string;
  dueOn: string | null;
  createdAt: string;
}

/** Telegram enquiry conversations (decision D24). */
export interface ConversationRow {
  id: string;
  channel: "telegram" | "whatsapp" | "web";
  status: "bot" | "handoff" | "closed";
  language: string | null;
  handoffReason: string | null;
  lastMessageAt: string | null;
  applicationId: string | null;
  applicationRef: string | null;
  partyName: string | null;
  /** Given first in every enquiry (D24). The list shows the phone masked. */
  contactEmail: string | null;
  contactPhone: string | null;
}

export interface ConversationDetail extends ConversationRow {
  flowStep: string;
  /** Applications already on file for the known person this email linked to (0 if none). */
  knownApplications: number;
  messages: {
    id: string;
    direction: "in" | "out";
    body: string;
    author: string | null;
    kind: string | null;
    at: string;
  }[];
}

export interface CompanyRow {
  id: string;
  name: string;
  slug: string;
  kind: "developer" | "realty" | "owner";
  active: boolean;
  unitCount: number;
  /** Legal details and signatory are complete enough to prepare a contract. */
  legalComplete: boolean;
}

/** Legal (landlord) details of a company; the signatory's ID number is masked for finance. */
export interface CompanyLegalView {
  companyName: string;
  legal: {
    legalNameEn: string | null;
    legalNameAr: string | null;
    tradeLicenceNo: string | null;
    tradeLicenceAuthority: string | null;
    tradeLicenceExpiresOn: string | null;
    reraOrn: string | null;
    registeredAddress: string | null;
    email: string | null;
    phone: string | null;
    chequePayeeName: string | null;
    signatoryName: string | null;
    signatoryTitle: string | null;
    signatoryEmail: string | null;
    signatoryIdKind: "emirates_id" | "passport" | null;
    signatoryIdNo: string | null;
    signatoryIdExpiresOn: string | null;
  };
  missing: string[];
}

export interface RentRuleRow {
  id: string;
  companyId: string;
  category: "residential" | "commercial" | "retail";
  subtype: string | null;
  emirate: string;
  community: string | null;
  minPctBp: number;
  maxPctBp: number;
  minRentFils: number | null;
  maxRentFils: number | null;
}

export interface ContractRuleRow {
  id: string;
  companyId: string;
  category: "residential" | "commercial" | "retail";
  subtype: string | null;
  tenures: ("annual" | "short_term")[];
  minCheques: number;
  maxCheques: number;
  clauseIds: string[];
  sampleDocumentId: string | null;
  /** An approved company template this rule's contracts are rendered in; null: the standard contract. */
  templateId: string | null;
}

/** Contract AI: a clause proposed from a sample contract (engine `/api/contract-rules/:id/clauses`). */
export interface CompanyClauseView {
  id: string;
  ref: string;
  title: string;
  text: string;
  quote: string | null;
  category: string;
  hasValues: boolean;
  status: "proposed" | "approved" | "rejected";
}
export interface RuleReview {
  sample: {
    documentId: string;
    status: "queued" | "done" | "failed" | "needs_human";
    reasons: string[];
    clauseCount: number;
    /** While queued: waiting for the model, or reading since `minutes`. */
    phase?: "waiting" | "running" | null;
    minutes?: number | null;
    /** The company template from the same sample is already made. */
    templateReady?: boolean;
  } | null;
  clauses: CompanyClauseView[];
}

/** Company contract template (engine `/api/companies/:id/contract-template`). */
export interface TemplateBlankView {
  id: string;
  label: string;
  before: string;
  after: string;
  marker: string;
  role: "field" | "signature";
  field: string;
  fieldType: string | null;
  note?: string;
  /** Description of the data-sheet key that fills this blank (null when none). */
  fieldLabel: string | null;
  /** How the mapping was chosen: a code rule, the model, or left empty (null for signature lines). */
  source: "matched" | "model" | "empty" | "admin" | null;
}
export interface CompanyTemplateView {
  id: string;
  version: number;
  status: "proposed" | "approved" | "retired";
  sampleDocumentId: string | null;
  sections: {
    numbering: string;
    title: string | null;
    items: { id: string; number: string | null; heading: string | null; paragraphs: string[] }[];
  };
  blanks: TemplateBlankView[];
  style: {
    fromSample: boolean;
    page: { widthPt: number; heightPt: number };
    font: { family: "serif" | "sans"; observed: string[] };
    sizes: { bodyPt: number; headingPt: number };
    accentColour: string | null;
    header: string | null;
    footer: string | null;
    flags: { authorityMarks: boolean; areas: ("header" | "footer" | "logo_area")[] };
  };
  review: {
    dropHeader: boolean;
    dropFooter: boolean;
    dropLogo: boolean;
    logoConfirmed: boolean;
    authorityChecked: boolean;
    valuesConfirmed: string[];
    authorityBodyConfirmed: string[];
    droppedParagraphs: string[];
  };
  /** Wording that needs a confirmation or a look (values, authority marks, rent or notice terms). */
  paragraphs: {
    key: string;
    kind: "title" | "heading" | "paragraph";
    text: string;
    values: boolean;
    authority: boolean;
    warning: string | null;
    fixedValues: string[];
    sampleOnly: boolean;
  }[];
  warnings: string[];
  hasLogo: boolean;
  problems: string[];
  approvedAt: string | null;
}
export interface CompanyTemplatePanel {
  templates: CompanyTemplateView[];
  extraction: {
    sampleDocumentId: string;
    status: "reading" | "ready" | "failed" | "retired";
    reasons: string[];
    minutes?: number;
  } | null;
  catalogue: { name: string; type: string; label: string }[];
  /** Active rules that point at a retired template (their contracts can't be prepared). */
  rulesOnRetired: number;
  /** Active rules that approving a proposed version would move to it. */
  rulesToMove: number;
}

/** Workspace and Home (engine `/api/records`, `/api/records/:kind/:id/log`, `/api/home`, `/api/views`). */
export const STAGES = [
  "Enquiry",
  "Viewing",
  "Documents",
  "Offer",
  "Reserved",
  "Contract",
  "Ejari",
  "Registered",
] as const;
export type Stage = (typeof STAGES)[number];
export type Owner = "leasing_officer" | "leasing_manager" | "finance" | "admin" | "agent" | "applicant" | "tenant";
export type LogAction =
  | "approve"
  | "reject"
  | "edit"
  | "send_offer"
  | "prepare_contract"
  | "record_viewing_outcome"
  | "record_reservation"
  | "retry_kyc"
  | "done";

export interface RecordRow {
  kind: "application" | "lease";
  id: string;
  ref: string;
  title: string;
  unitCode: string;
  stage: Stage;
  nextStep: string;
  owner: Owner;
  waitingForMe: boolean;
  /** An applicant or signer has to answer next. */
  waitingOnReply?: boolean;
  updatedAt: string;
}

export interface LogEntry {
  at: string;
  source: "event" | "approval" | "email" | "task";
  actor: { kind: "agent" | "user" | "applicant" | "tenant" | "system"; name: string };
  text: string;
  refId: string;
  pending: boolean;
  actions: LogAction[];
}

export interface HomeView {
  viewingsToday: number;
  offersOut: number;
  awaitingSignature: number;
  ejariPending: number;
  waitingForYou: number;
  agentToday: LogEntry[];
}

export interface SavedView {
  id: string;
  staffUserId: string;
  name: string;
  filter: { stage?: string; q?: string; mine?: boolean };
  createdAt: string;
}
