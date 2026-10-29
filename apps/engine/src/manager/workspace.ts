import {
  type ApplicationState,
  approvalGates,
  canDecideGate,
  type CalendarDate,
  type GateId,
  type LeaseState,
  type StaffRole,
  startOfDubaiDay,
  addDays,
} from "@leasing/core";
import {
  applications,
  approvals,
  contracts,
  type Db,
  leaseEvents,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  staffUsers,
  tasks,
  units,
} from "@leasing/db";
import { and, desc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { isGateEditable } from "./gate-rules.ts";
import { DEFAULT_KYC_STUCK_MINUTES, kycCheckState } from "./kyc-check.ts";
import { isTenancyMilestone } from "./milestones.ts";

const TENANCY_EVENTS = new Set([
  "PAYMENTS_SCHEDULED",
  "PAYMENT_CONFIRMED",
  "PAYMENT_OVERDUE",
  "NOTICE_SENT",
  "NOTICE_QUEUED",
  "CASE_PACK_EXPORTED",
]);
const TENANCY_GATES = new Set<GateId>([
  "formal_reminder",
  "renewal_notice",
  "vacate_notice",
  "refund",
  "safety_complaint",
]);
const TENANCY_EMAILS = new Set(["notice", "formal_reminder", "reminder", "receipt"]);
const isTenancyEvent = (type: string, payload: Record<string, unknown>) =>
  TENANCY_EVENTS.has(type) ||
  (type.startsWith("MILESTONE_") && typeof payload.milestone === "string" && isTenancyMilestone(payload.milestone));

/** Read models behind the staff Workspace and Home screens. Nothing here writes or decides anything. */

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

export type Owner = StaffRole | "agent" | "applicant" | "tenant";

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

export interface LogEntry {
  at: string;
  source: "event" | "approval" | "email" | "task";
  actor: { kind: "agent" | "user" | "applicant" | "tenant" | "system"; name: string };
  text: string;
  refId: string;
  pending: boolean;
  actions: LogAction[];
  /** Move-in to move-out (renewals, rent, notices, move-out): out of scope while TENANCY_OPS is off. */
  tenancy?: boolean;
}

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
  /** An applicant or signer has to answer next (documents, an open offer, the signatures). The Workspace may suggest a reply draft. */
  waitingOnReply: boolean;
  /** A prepare-the-contract task is open: the lease has no prepared contract yet. */
  contractHeld: boolean;
  /** The contract is out with the signers. */
  contractSent: boolean;
  updatedAt: string;
}

export interface HomeView {
  viewingsToday: number;
  offersOut: number;
  awaitingSignature: number;
  ejariPending: number;
  waitingForYou: number;
  agentToday: LogEntry[];
}

export type RecordState = { kind: "application"; state: ApplicationState } | { kind: "lease"; state: LeaseState };

/** The stage a record sits in, or null when it is off the pipeline (rejected, withdrawn, converted). */
export function stageFor(r: RecordState): Stage | null {
  if (r.kind === "application") {
    switch (r.state) {
      case "ENQUIRY":
        return "Enquiry";
      case "VIEWING":
        return "Viewing";
      case "SCREENING":
        return "Documents";
      case "OFFER":
        return "Offer";
      case "RESERVED":
        return "Reserved";
      default:
        return null;
    }
  }
  if (r.state === "CONTRACT") return "Contract";
  if (r.state === "REGISTRATION") return "Ejari";
  return "Registered";
}

/** Plain next-step copy for a stage. `offerHeld`: the offer is stored but waits for a person to send it. */
export function nextStepFor(r: {
  stage: Stage;
  offerHeld?: boolean;
  contractHeld?: boolean;
  /** The contract is out with the signers. */
  contractSent?: boolean;
}): string {
  switch (r.stage) {
    case "Enquiry":
      return "Confirm a viewing time with the applicant.";
    case "Viewing":
      return "Hold the viewing, then record whether the applicant came.";
    case "Documents":
      return "Agent is checking the applicant's documents.";
    case "Offer":
      return r.offerHeld ? "Send the offer to the applicant." : "Waiting for the applicant to answer the offer.";
    case "Reserved":
      return "Agent is creating the lease from the reservation.";
    case "Contract":
      return r.contractHeld
        ? "Prepare the contract."
        : r.contractSent
          ? "Waiting for the signers."
          : "Approve the final contract, then collect signatures.";
    case "Ejari":
      return "Approve the Ejari submission and wait for the registration.";
    case "Registered":
      return "Registered. Nothing to do before move-in.";
  }
}

const ACTOR_NOUN: Record<GateId, string> = {
  price_out_of_range: "the asking rent",
  offer_out_of_limits: "the offer terms",
  final_contract: "the final contract",
  ejari_submission: "the Ejari submission",
  formal_reminder: "the formal late-payment reminder",
  renewal_notice: "the renewal notice",
  vacate_notice: "the vacate notice",
  refund: "the refund",
  kyc_review: "the identity check",
  ejari_rejected_twice: "the twice-rejected Ejari submission",
  safety_complaint: "the safety complaint",
};

const humanise = (type: string) => {
  const s = type.toLowerCase().replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const rev = (p: Record<string, unknown>) => (typeof p.revision === "number" ? ` ${p.revision}` : "");

type EventText = (s: string, p: Record<string, unknown>) => string;
const EVENT_TEXT: Record<string, EventText> = {
  APPLICATION_CREATED: (s) => `${s} opened an application.`,
  ENQUIRY_CONTACT_SET: (s) => `${s} saved the applicant's contact details.`,
  ENQUIRY_HANDOFF: (s) => `${s} handed the enquiry to staff.`,
  RETURNED_TO_BOT: (s) => `${s} handed the enquiry back to the agent.`,
  STAFF_REPLIED: (s) => `${s} replied to the enquiry.`,
  VIEWING_REQUESTED: (s) => `${s} asked for a viewing time.`,
  VIEWING_BOOKED: (s) => `${s} booked a viewing.`,
  VIEWING_BOOKED_BY_ENQUIRER: (s) => `${s} booked a viewing.`,
  APPLIED_FROM_CHAT: (s) => `${s} applied from the chat without a viewing.`,
  VIEWING_NO_SHOW: (s) => `${s} marked the viewing as a no-show.`,
  APPLIED: (s) => `${s} moved the application to document checks.`,
  DOCUMENTS_REQUESTED: (s) => `${s} asked the applicant for documents.`,
  DOCUMENT_UPLOADED: (s) => `${s} uploaded a document.`,
  DOCUMENT_REMOVED: (s) => `${s} removed a document.`,
  KYC_VERIFIED: (s) => `${s} verified the applicant's identity documents.`,
  KYC_FAILED: (s) => `${s} rejected the application after the identity check.`,
  HELPER_RAN: (s) => `${s} finished a check.`,
  OFFER_MADE: (s, p) => `${s} drafted offer revision${rev(p).trim() ? rev(p) : " 1"}, within limits.`,
  OFFER_HELD: (s, p) => `${s} held offer revision${rev(p).trim() ? rev(p) : ""} for a person to send.`,
  OFFER_SENT: (s, p) => `${s} sent offer revision${rev(p).trim() ? rev(p) : ""} to the applicant.`,
  OFFER_REVISED: (s) => `${s} revised the offer.`,
  OFFER_ANSWERED: (s) => `${s} recorded the applicant's answer to the offer.`,
  OFFER_ACCEPTED: (s) => `${s} marked the offer as accepted.`,
  OFFER_DECLINED: (s) => `${s} marked the offer as declined.`,
  OFFER_EXPIRED: (s) => `${s} closed the offer because it expired.`,
  PRICE_APPROVED: (s) => `${s} approved the asking rent.`,
  RESERVATION_RECORDED: (s) => `${s} recorded the reservation payment.`,
  WITHDRAWN: (s) => `${s} marked the applicant as withdrawn.`,
  LEASE_CREATED: (s) => `${s} created the lease.`,
  PARTY_LINKED: (s) => `${s} linked a person to the lease.`,
  CONTRACT_PREP_HELD: (s) => `${s} held contract preparation for a person to start.`,
  CONTRACT_PREPARED: (s) => `${s} prepared the contract.`,
  CONTRACT_REJECTED: (s) => `${s} rejected the contract draft.`,
  CONTRACT_SENT: (s) => `${s} sent the contract for signing.`,
  CONTRACT_SIGNED_BY: (s) => `${s} signed the contract.`,
  CONTRACT_SUPERSEDED: (s) => `${s} replaced the contract with a newer version.`,
  SIGN_LINK_RESENT: (s) => `${s} sent the signing link again.`,
  CONTRACT_SIGNED: (s) => `${s} confirmed the contract is signed.`,
  EJARI_SUBMISSION_QUEUED: (s) => `${s} queued the Ejari submission.`,
  EJARI_SUBMISSION_FAILED: (s) => `${s} could not reach the registry for the Ejari submission.`,
  EJARI_AUTOFIX: (s) => `${s} corrected small typing mistakes before resubmitting to Ejari.`,
  EJARI_REJECTED: (s) => `${s} recorded that the registry rejected the Ejari submission.`,
  EJARI_ISSUED: (s) => `${s} recorded the Ejari registration.`,
  EJARI_CANCELLED: (s) => `${s} cancelled the Ejari registration.`,
  APPROVAL_NOTE_ADDED: (s) => `${s} added a note to an approval.`,
  APPROVAL_CANCELLED: (s) => `${s} cancelled an approval that no longer applies.`,
  MILESTONE_FIRED: (s) => `${s} ran a scheduled step.`,
  MILESTONE_SKIPPED: (s) => `${s} skipped a scheduled step.`,
  PAYMENTS_SCHEDULED: (s) => `${s} scheduled the rent payments.`,
  PAYMENT_CONFIRMED: (s) => `${s} confirmed a payment.`,
  PAYMENT_OVERDUE: (s) => `${s} marked a payment as overdue.`,
  COPILOT_PROPOSAL_CONFIRMED: (s) => `${s} confirmed a copilot proposal.`,
  IMPORTED: (s) => `${s} imported this record.`,
  NOTICE_SENT: (s) => `${s} sent a notice.`,
  NOTICE_QUEUED: (s) => `${s} queued a notice.`,
  CASE_PACK_EXPORTED: (s) => `${s} exported the case pack.`,
  INBOUND_RECEIVED: (s) => `${s} received a message.`,
  // Document check steps (helper:kyc). Plain words; no ID numbers, no document content.
  KYC_CHECK_STARTED: (_s, p) =>
    `Checking ${Number(p.documents ?? 0)} document${Number(p.documents) === 1 ? "" : "s"} with ${String(p.model ?? "the local model")}.`,
  KYC_DOC_READ: (_s, p) =>
    p.ok
      ? `Read the ${String(p.doc)} (${Number(p.index)} of ${Number(p.total)}) in ${Number(p.seconds)} s.`
      : `Could not read the ${String(p.doc)} (${Number(p.index)} of ${Number(p.total)}): ${
          p.why === "timeout"
            ? "the model timed out"
            : p.why === "file_missing"
              ? "the file is missing"
              : p.why === "model_error"
                ? "the model failed"
                : "the image wasn't clear enough"
        }.`,
  KYC_DECISION_STEP: () => "Running the identity checks (ID format, expiry, names) on what was read.",
  KYC_CHECK_FINISHED: (_s, p) =>
    p.verdict === "verified"
      ? "Document check finished: nothing flagged."
      : `Document check finished: ${Number(p.flags ?? 0)} point${Number(p.flags) === 1 ? "" : "s"} for an officer to review.`,
  KYC_CHECK_FAILED: (_s, p) =>
    `Document check attempt ${Number(p.attempt ?? 1)} stopped: ${String(p.reason ?? "it did not finish")}`,
  KYC_CHECK_RETRY_REQUESTED: (s) => `${s} asked for the document check to run again.`,
};

/** Events that the approval, task and email sources already show, so the log would say it twice. */
const COVERED_ELSEWHERE = new Set(["APPROVAL_REQUESTED", "APPROVAL_DECIDED", "TASK_CREATED", "TASK_DONE"]);

export type DescribeInput =
  | { source: "event"; type: string; payload: Record<string, unknown>; subject: string }
  | { source: "approval"; gate: GateId; status: string; subject: string; canDecide: boolean }
  | { source: "email"; purpose: string; status: string }
  | { source: "task"; title: string; status: string };

const EMAIL_PURPOSE: Record<string, string> = {
  offer: "offer link",
  link: "portal link",
  notice: "notice",
  formal_reminder: "formal late-payment reminder",
  reminder: "rent reminder",
  receipt: "receipt",
};

/** One plain sentence for a log entry. Unknown event types fall back to a humanised name. */
export function describeEntry(i: DescribeInput): string {
  switch (i.source) {
    case "event":
      return (EVENT_TEXT[i.type] ?? ((s) => `${humanise(i.type)} by ${s.toLowerCase() === "you" ? "you" : s}.`))(
        i.subject,
        i.payload,
      );
    case "approval": {
      const noun = ACTOR_NOUN[i.gate] ?? approvalGates[i.gate].label.toLowerCase();
      if (i.status === "pending")
        return i.canDecide ? `Your approval is needed for ${noun}.` : `Waiting for approval of ${noun}.`;
      if (i.status === "approved") return `${i.subject} approved ${noun}.`;
      if (i.status === "rejected") return `${i.subject} rejected ${noun}.`;
      if (i.status === "edited") return `${i.subject} edited and approved ${noun}.`;
      return `Approval of ${noun} was cancelled.`;
    }
    case "email": {
      const what = EMAIL_PURPOSE[i.purpose] ?? "message";
      if (i.status === "sent") return `Email sent: ${what}.`;
      if (i.status === "failed") return `Email failed to send: ${what}.`;
      return `Email on its way: ${what}.`;
    }
    case "task": {
      const title = i.title.trim().replace(/[.!?]+$/, "");
      if (i.status === "open") return `To do: ${title}.`;
      if (i.status === "done") return `Task done: ${title}.`;
      return `Task cancelled: ${title}.`;
    }
  }
}

/** Task kinds finished by their own action, never by "Mark done" (explicit list; `completeTask` refuses the first two and the landlord question). */
const NO_MARK_DONE = new Set(["send_offer", "prepare_contract", "record_reservation", "landlord_intent"]);

const TASK_ACTION: Record<string, LogAction> = {
  send_offer: "send_offer",
  prepare_contract: "prepare_contract",
  record_reservation: "record_reservation",
};

/** Mirrors the web's `canDecideApproval`: the proposer never decides their own proposal. */
export function canDecide(a: { gate: GateId; proposedBy: string }, me: { id: string; role: StaffRole }): boolean {
  if (a.proposedBy === `user:${me.id}` || a.proposedBy === `copilot:${me.id}`) return false;
  return canDecideGate(a.gate, me.role);
}

/** The assignee's role or a leasing manager may finish a task (`completeTask`). */
export const canDoTask = (assignee: StaffRole, role: StaffRole) => role === assignee || role === "leasing_manager";

interface Me {
  id: string;
  role: StaffRole;
}

async function staffNames(db: Db) {
  const rows = await db.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers);
  return new Map(rows.map((r) => [r.id, r.name]));
}

function actorOf(
  actor: string,
  entityKind: string,
  me: Me,
  names: Map<string, string>,
  personName: string,
): { actor: LogEntry["actor"]; subject: string } {
  const [prefix, rest = ""] = [actor.split(":")[0]!, actor.split(":").slice(1).join(":")];
  switch (prefix) {
    case "helper":
    case "copilot":
      return { actor: { kind: "agent", name: "Agent" }, subject: "Agent" };
    case "user": {
      if (rest === me.id) return { actor: { kind: "user", name: "You" }, subject: "You" };
      const name = names.get(rest) ?? "A colleague";
      return { actor: { kind: "user", name }, subject: name };
    }
    case "tenant":
    case "enquirer":
    case "applicant":
      return {
        actor: { kind: entityKind === "lease" ? "tenant" : "applicant", name: personName },
        subject: personName,
      };
    case "landlord":
      return { actor: { kind: "system", name: "Landlord" }, subject: "The landlord" };
    default:
      return { actor: { kind: "system", name: "System" }, subject: "System" };
  }
}

interface Scope {
  ids: string[];
  /** entity id -> display name of the applicant or tenant */
  names: Map<string, string>;
}

/** Builds the merged, newest-first log over the given entity ids. */
async function buildLog(
  db: Db,
  me: Me,
  scope: Scope,
  opts: { since?: Date; before?: Date; agentOnly?: boolean; limit?: number; now?: Date; kycStuckMs?: number },
): Promise<LogEntry[]> {
  if (!scope.ids.length) return [];
  const emailAt = sql`coalesce(${outboundMessages.sentAt}, ${outboundMessages.createdAt})`;
  const emailWindow = and(
    opts.since ? sql`${emailAt} >= ${opts.since.toISOString()}::timestamptz` : undefined,
    opts.before ? sql`${emailAt} < ${opts.before.toISOString()}::timestamptz` : undefined,
  );
  const eventWindow = and(
    opts.since ? gte(leaseEvents.at, opts.since) : undefined,
    opts.before ? lt(leaseEvents.at, opts.before) : undefined,
  );
  const [events, apps, msgs, tks, names] = await Promise.all([
    db
      .select()
      .from(leaseEvents)
      .where(and(inArray(leaseEvents.entityId, scope.ids), eventWindow))
      .orderBy(desc(leaseEvents.at))
      .limit(500),
    db
      .select()
      .from(approvals)
      .where(inArray(approvals.entityId, scope.ids))
      .orderBy(desc(approvals.createdAt))
      .limit(200),
    db
      .select()
      .from(outboundMessages)
      .where(and(inArray(outboundMessages.entityId, scope.ids), emailWindow))
      .orderBy(desc(sql`coalesce(${outboundMessages.sentAt}, ${outboundMessages.createdAt})`))
      .limit(200),
    db.select().from(tasks).where(inArray(tasks.entityId, scope.ids)).orderBy(desc(tasks.createdAt)).limit(200),
    staffNames(db),
  ]);
  const inWindow = (d: Date) => (!opts.since || d >= opts.since) && (!opts.before || d < opts.before);
  const out: LogEntry[] = [];
  const person = (id: string) => scope.names.get(id) ?? "The applicant";

  for (const e of events) {
    if (COVERED_ELSEWHERE.has(e.type)) continue;
    const a = actorOf(e.actor, e.entityKind, me, names, person(e.entityId));
    out.push({
      at: e.at.toISOString(),
      source: "event",
      actor: a.actor,
      text: describeEntry({ source: "event", type: e.type, payload: e.payload, subject: a.subject }),
      refId: e.id,
      pending: false,
      actions: [],
      ...(isTenancyEvent(e.type, e.payload) ? { tenancy: true } : {}),
    });
  }
  for (const ap of apps) {
    const open = ap.status === "pending";
    const at = open ? ap.createdAt : (ap.decidedAt ?? ap.createdAt);
    if (!inWindow(at)) continue;
    const who = open ? ap.proposedBy : ap.decidedBy ? `user:${ap.decidedBy}` : ap.proposedBy;
    const a = actorOf(who, ap.entityKind, me, names, person(ap.entityId));
    const mayDecide = open && canDecide(ap, me);
    out.push({
      at: at.toISOString(),
      source: "approval",
      actor: a.actor,
      text: describeEntry({
        source: "approval",
        gate: ap.gate,
        status: ap.status,
        subject: a.subject,
        canDecide: mayDecide,
      }),
      refId: ap.id,
      pending: mayDecide,
      actions: mayDecide ? ["approve", "reject", ...(isGateEditable(ap.gate) ? (["edit"] as const) : [])] : [],
      ...(TENANCY_GATES.has(ap.gate) ? { tenancy: true } : {}),
    });
  }
  for (const m of msgs) {
    out.push({
      at: (m.sentAt ?? m.createdAt).toISOString(),
      source: "email",
      actor: { kind: "system", name: "System" },
      text: describeEntry({ source: "email", purpose: m.purpose, status: m.status }),
      refId: m.id,
      pending: false,
      actions: [],
      ...(TENANCY_EMAILS.has(m.purpose) ? { tenancy: true } : {}),
    });
  }
  for (const t of tks) {
    if (!inWindow(t.createdAt)) continue;
    const a = actorOf(t.createdBy, t.entityKind, me, names, person(t.entityId));
    const mine = t.status === "open" && canDoTask(t.assigneeRole, me.role);
    const special = TASK_ACTION[t.kind];
    out.push({
      at: t.createdAt.toISOString(),
      source: "task",
      actor: a.actor,
      text: describeEntry({ source: "task", title: t.title, status: t.status }),
      refId: t.id,
      pending: mine,
      actions: mine ? [...(special ? [special] : []), ...(NO_MARK_DONE.has(t.kind) ? [] : (["done"] as const))] : [],
    });
  }
  // A viewing whose time has passed waits for its outcome (attended or no-show), for leasing roles.
  if (opts.now && (me.role === "leasing_officer" || me.role === "leasing_manager")) {
    const due = await db
      .select({ id: applications.id, viewingAt: applications.viewingAt })
      .from(applications)
      .where(
        and(
          inArray(applications.id, scope.ids),
          eq(applications.state, "VIEWING"),
          sql`${applications.viewingAt} <= ${opts.now.toISOString()}::timestamptz`,
        ),
      );
    for (const v of due) {
      out.push({
        at: v.viewingAt!.toISOString(),
        source: "event",
        actor: { kind: "system", name: "System" },
        text: "The viewing time has passed. Record whether the applicant came.",
        refId: v.id,
        pending: true,
        actions: ["record_viewing_outcome"],
      });
    }
  }
  // A document check that failed or has run too long: say why, and let leasing staff run it again.
  if (opts.now) {
    for (const appId of scope.ids) {
      const st = await kycCheckState(db, appId, opts.now, opts.kycStuckMs ?? DEFAULT_KYC_STUCK_MINUTES * 60_000);
      if (st.state !== "stuck" && st.state !== "failed") continue;
      const leasing = me.role === "leasing_officer" || me.role === "leasing_manager";
      out.push({
        at: st.since.toISOString(),
        source: "event",
        actor: { kind: "system", name: "System" },
        text: `Document check didn't finish: ${st.reason}.`,
        refId: st.inboundId,
        pending: leasing,
        actions: leasing ? ["retry_kyc"] : [],
      });
    }
  }
  const filtered = opts.agentOnly
    ? out.filter((e) => !e.pending && (e.actor.kind === "agent" || e.actor.kind === "system"))
    : out;
  filtered.sort((x, y) => Number(y.pending) - Number(x.pending) || y.at.localeCompare(x.at));
  return filtered.slice(0, opts.limit ?? 300);
}

interface Loaded {
  rows: (RecordRow & {
    _entityIds: string[];
    _offerHeld: boolean;
    _waitingItems: number;
    _companyId: string;
    _category: string;
    _appRef: string;
  })[];
}

/** Applications (not yet converted) and leases as one list, newest change first. */
export async function loadRecords(db: Db, me: Me): Promise<Loaded> {
  const [apps, lss, tenantRows, openApprovals, openTasks, sentContracts] = await Promise.all([
    db
      .select({
        a: applications,
        unitCode: units.code,
        companyId: units.companyId,
        category: units.category,
        name: parties.fullNameEn,
      })
      .from(applications)
      .innerJoin(units, eq(units.id, applications.unitId))
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(inArray(applications.state, ["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"])),
    db
      .select({
        l: leases,
        unitCode: units.code,
        companyId: units.companyId,
        category: units.category,
        appRef: applications.ref,
      })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .leftJoin(applications, eq(applications.id, leases.applicationId)),
    db
      .select({ leaseId: leaseParties.leaseId, name: parties.fullNameEn })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(eq(leaseParties.role, "tenant")),
    db.select().from(approvals).where(eq(approvals.status, "pending")),
    db.select().from(tasks).where(eq(tasks.status, "open")),
    db.selectDistinct({ leaseId: contracts.leaseId }).from(contracts).where(eq(contracts.status, "sent")),
  ]);
  const sentLeaseIds = new Set(sentContracts.map((c) => c.leaseId));
  const tenant = new Map(tenantRows.map((r) => [r.leaseId, r.name]));
  const approvalsBy = new Map<string, typeof openApprovals>();
  for (const a of openApprovals) approvalsBy.set(a.entityId, [...(approvalsBy.get(a.entityId) ?? []), a]);
  const tasksBy = new Map<string, typeof openTasks>();
  for (const t of openTasks) tasksBy.set(t.entityId, [...(tasksBy.get(t.entityId) ?? []), t]);

  const build = (
    kind: "application" | "lease",
    id: string,
    state: RecordState,
    base: {
      ref: string;
      appRef?: string;
      title: string;
      unitCode: string;
      updatedAt: Date;
      companyId: string;
      category: string;
    },
    ids: string[],
  ) => {
    const stage = stageFor(state);
    if (!stage) return null;
    const ap = ids.flatMap((i) => approvalsBy.get(i) ?? []);
    const tk = ids.flatMap((i) => tasksBy.get(i) ?? []);
    const waitingItems =
      ap.filter((a) => canDecide(a, me)).length + tk.filter((t) => canDoTask(t.assigneeRole, me.role)).length;
    const waitingForMe = waitingItems > 0;
    const offerHeld = tk.some((t) => t.kind === "send_offer");
    const contractHeld = tk.some((t) => t.kind === "prepare_contract");
    const contractSent = kind === "lease" && sentLeaseIds.has(id);
    const nextStep = nextStepFor({ stage, offerHeld, contractHeld, contractSent });
    let owner: Owner;
    if (waitingForMe) owner = me.role;
    else if (ap[0]) owner = ap[0].approverRole;
    else if (tk[0]) owner = tk[0].assigneeRole;
    else if (stage === "Offer" || stage === "Documents" || stage === "Enquiry" || stage === "Viewing")
      owner = stage === "Offer" || stage === "Documents" ? "applicant" : "agent";
    else owner = stage === "Registered" ? "tenant" : "agent";
    return {
      kind,
      id,
      ref: base.ref,
      title: base.title,
      unitCode: base.unitCode,
      stage,
      nextStep,
      owner,
      waitingForMe,
      waitingOnReply: stage === "Documents" || (stage === "Offer" && !offerHeld) || contractSent,
      contractHeld,
      contractSent,
      updatedAt: base.updatedAt.toISOString(),
      _entityIds: ids,
      _offerHeld: offerHeld,
      _waitingItems: waitingItems,
      _companyId: base.companyId,
      _category: base.category,
      _appRef: base.appRef ?? "",
    };
  };

  const rows: Loaded["rows"] = [];
  for (const r of apps) {
    const row = build(
      "application",
      r.a.id,
      { kind: "application", state: r.a.state },
      {
        ref: r.a.ref ?? r.a.id.slice(0, 8),
        title: r.name,
        unitCode: r.unitCode,
        updatedAt: r.a.updatedAt,
        companyId: r.companyId,
        category: r.category,
      },
      [r.a.id],
    );
    if (row) rows.push(row);
  }
  for (const r of lss) {
    const ids = r.l.applicationId ? [r.l.id, r.l.applicationId] : [r.l.id];
    const row = build(
      "lease",
      r.l.id,
      { kind: "lease", state: r.l.state },
      {
        ref: r.l.ref,
        ...(r.appRef ? { appRef: r.appRef } : {}),
        title: tenant.get(r.l.id) ?? "Tenant",
        unitCode: r.unitCode,
        updatedAt: r.l.updatedAt,
        companyId: r.companyId,
        category: r.category,
      },
      ids,
    );
    if (row) rows.push(row);
  }
  rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { rows };
}

export interface RecordFilter {
  q?: string | undefined;
  stage?: string | undefined;
  mine?: boolean | undefined;
  /** Only records on this company's units. */
  companyId?: string | undefined;
  /** Only records on units of this property category. */
  category?: string | undefined;
  /** One record by id. */
  id?: string | undefined;
  /** At most this many rows (the count is the caller's `total`). */
  limit?: number | undefined;
}

export async function listRecords(db: Db, me: Me, f: RecordFilter): Promise<RecordRow[]> {
  return (await listRecordsCounted(db, me, f)).rows;
}

/** The filtered rows (cut to `limit`) and how many matched before the cut. */
export async function listRecordsCounted(
  db: Db,
  me: Me,
  f: RecordFilter,
): Promise<{ rows: RecordRow[]; total: number }> {
  const { rows } = await loadRecords(db, me);
  const q = f.q?.trim().toLowerCase();
  const hits = rows
    .filter((r) => !f.stage || r.stage === f.stage)
    .filter((r) => !f.id || r.id === f.id)
    .filter((r) => !f.mine || r.waitingForMe)
    .filter((r) => !f.companyId || r._companyId === f.companyId)
    .filter((r) => !f.category || r._category === f.category)
    .filter((r) => !q || [r.title, r.unitCode, r.ref, r._appRef].some((v) => v.toLowerCase().includes(q)));
  return {
    total: hits.length,
    rows: (f.limit === undefined ? hits : hits.slice(0, f.limit)).map(
      ({ _entityIds, _offerHeld, _waitingItems, _companyId, _category, _appRef, ...r }) => r,
    ),
  };
}

/** The merged activity log of an application or lease (a lease includes the application it came from). */
export async function recordLog(
  db: Db,
  me: Me,
  kind: "application" | "lease",
  id: string,
  now: Date,
  kycStuckMs?: number,
): Promise<LogEntry[] | null> {
  let ids: string[];
  let name: string | undefined;
  if (kind === "application") {
    const [r] = await db
      .select({ name: parties.fullNameEn })
      .from(applications)
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(eq(applications.id, id));
    if (!r) return null;
    name = r.name;
    const [l] = await db.select({ id: leases.id }).from(leases).where(eq(leases.applicationId, id));
    ids = l ? [id, l.id] : [id];
  } else {
    const [l] = await db.select().from(leases).where(eq(leases.id, id));
    if (!l) return null;
    const [t] = await db
      .select({ name: parties.fullNameEn })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(and(eq(leaseParties.leaseId, id), eq(leaseParties.role, "tenant")));
    name = t?.name;
    ids = l.applicationId ? [id, l.applicationId] : [id];
  }
  const names = new Map(ids.map((i) => [i, name ?? "The applicant"]));
  return buildLog(db, me, { ids, names }, { now, ...(kycStuckMs ? { kycStuckMs } : {}) });
}

/** An application and the lease made from it share one record: the entity pairs whose events belong to it. */
async function recordEntities(db: Db, kind: "application" | "lease", id: string) {
  if (kind === "application") {
    const [a] = await db.select({ id: applications.id }).from(applications).where(eq(applications.id, id));
    if (!a) return null;
    const [l] = await db.select({ id: leases.id }).from(leases).where(eq(leases.applicationId, id));
    return [{ kind, id }, ...(l ? [{ kind: "lease" as const, id: l.id }] : [])];
  }
  const [l] = await db.select({ applicationId: leases.applicationId }).from(leases).where(eq(leases.id, id));
  if (!l) return null;
  return [{ kind, id }, ...(l.applicationId ? [{ kind: "application" as const, id: l.applicationId }] : [])];
}

/**
 * A cheap change marker for one record: the newest `lease_events` id (UUIDv7, so it grows with time) over the
 * record's application and lease, plus how many of its approvals wait. Read through the (kind, id, at) index; the
 * client only compares it for equality to decide when to refetch. Null when the record does not exist.
 */
export async function recordVersion(db: Db, kind: "application" | "lease", id: string): Promise<string | null> {
  const pairs = await recordEntities(db, kind, id);
  if (!pairs) return null;
  const [e] = await db
    .select({ id: leaseEvents.id })
    .from(leaseEvents)
    .where(or(...pairs.map((p) => and(eq(leaseEvents.entityKind, p.kind), eq(leaseEvents.entityId, p.id)))))
    .orderBy(desc(leaseEvents.id))
    .limit(1);
  const [pending] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(
      and(
        eq(approvals.status, "pending"),
        or(...pairs.map((p) => and(eq(approvals.entityKind, p.kind), eq(approvals.entityId, p.id)))),
      ),
    );
  return `${e?.id ?? "none"}:${pending?.n ?? 0}`;
}

/** Change marker for the record list and Home tiles: newest event overall (primary key index), pending approvals, open tasks. */
export async function listVersion(db: Db): Promise<string> {
  const [e] = await db.select({ id: leaseEvents.id }).from(leaseEvents).orderBy(desc(leaseEvents.id)).limit(1);
  const [a] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(approvals)
    .where(eq(approvals.status, "pending"));
  const [t] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(tasks)
    .where(eq(tasks.status, "open"));
  return `${e?.id ?? "none"}:${a?.n ?? 0}:${t?.n ?? 0}`;
}

/** The Home tiles and the pipeline counts come from here, so the two can never disagree. */
async function homeCounts(ctx: EngineContext, me: Me) {
  const db = ctx.database.db;
  const today: CalendarDate = ctx.clock.today();
  const dayStart = startOfDubaiDay(today);
  const dayEnd = startOfDubaiDay(addDays(today, 1));
  const [{ rows }, viewings, ejari, signing] = await Promise.all([
    loadRecords(db, me),
    db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.state, "VIEWING"),
          gte(applications.viewingAt, dayStart),
          lt(applications.viewingAt, dayEnd),
        ),
      ),
    db.select({ id: leases.id }).from(leases).where(eq(leases.state, "REGISTRATION")),
    // Contract sent to the signers and not yet fully signed.
    db
      .selectDistinct({ id: contracts.leaseId })
      .from(contracts)
      .innerJoin(leases, eq(leases.id, contracts.leaseId))
      .where(and(eq(contracts.status, "sent"), eq(leases.state, "CONTRACT"))),
  ]);
  const offersOut = rows.filter((r) => r.kind === "application" && r.stage === "Offer" && !r._offerHeld);
  return {
    rows,
    dayStart,
    dayEnd,
    tiles: {
      viewingsToday: viewings.length,
      offersOut: offersOut.length,
      awaitingSignature: signing.length,
      ejariPending: ejari.length,
      // Same scope as /records waitingForMe: items on live records only, counted as items.
      waitingForYou: rows.reduce((n, r) => n + r._waitingItems, 0),
    },
  };
}

export async function homeView(ctx: EngineContext, me: Me): Promise<HomeView> {
  const { rows, dayStart, dayEnd, tiles } = await homeCounts(ctx, me);
  const recent = await buildLog(
    ctx.database.db,
    me,
    { ids: rows.flatMap((r) => r._entityIds), names: new Map() },
    { since: dayStart, before: dayEnd, agentOnly: true, limit: 8 },
  );
  return { ...tiles, agentToday: recent };
}

export interface PipelineSummary {
  /** Records per stage (the Workspace's stage tabs). */
  stages: Record<Stage, number>;
  /** Offer stage split: out with the applicant, or held for a person to send. */
  offer: { sent: number; held: number };
  /** Contract stage split: out with the signers, or still to prepare or approve. */
  contract: { awaitingSignature: number; other: number };
  viewingsToday: number;
  waitingForYou: number;
  openTasks: number;
  /** Total records on the pipeline. */
  total: number;
}

/** Counts per stage for the copilot and the Home tiles: the same rows and the same tile numbers. */
export async function pipelineSummary(ctx: EngineContext, me: Me): Promise<PipelineSummary> {
  const { rows, tiles } = await homeCounts(ctx, me);
  const stages = Object.fromEntries(STAGES.map((st) => [st, rows.filter((r) => r.stage === st).length])) as Record<
    Stage,
    number
  >;
  const live = new Set(rows.flatMap((r) => r._entityIds));
  const open = await ctx.database.db.select({ entityId: tasks.entityId }).from(tasks).where(eq(tasks.status, "open"));
  return {
    stages,
    offer: { sent: tiles.offersOut, held: stages.Offer - tiles.offersOut },
    contract: { awaitingSignature: tiles.awaitingSignature, other: stages.Contract - tiles.awaitingSignature },
    viewingsToday: tiles.viewingsToday,
    waitingForYou: tiles.waitingForYou,
    openTasks: open.filter((t) => live.has(t.entityId)).length,
    total: rows.length,
  };
}
