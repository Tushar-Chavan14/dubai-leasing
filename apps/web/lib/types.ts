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
  kind: string;
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
  priceRange: { min: number; max: number } | null;
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

export interface CompanyPolicyView {
  askingRentRangeFils: Record<string, { min: number; max: number }>;
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
