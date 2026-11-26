import { toDubaiDate } from "@platform/kernel/dates";
import { maskPii, maskPiiText } from "@platform/kernel/pii";
import { type RoleSet, type DealStep, dealSteps, type DealState, eventVisibleTo, isComplianceGate, isComplianceRole, mayDecide, type SpaGateId, spaGates, type SpaRole, stageKey, type StepKey, stepsFor, taskVisibleTo, hasAnyRole, rolesOf } from "@spa/core";
import {
  agreements,
  amlCases,
  amlHits,
  dealEvents,
  dealParties,
  helperRuns,
  kycRuns,
  parties,
  paymentPlanRows,
  spaApprovals,
  type SpaDb,
  spaTasks,
  spaUsers,
} from "@spa/db";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { agreementReviewView } from "./agreement-review.ts";
import { chasingView } from "./chase.ts";
import type { SpaContext } from "./context.ts";
import type { DealRow } from "./facts.ts";
import { nocStatusView } from "./noc-status.ts";
import { paymentsView } from "./payments.ts";
import { agreementView, amlSummary, documentsView } from "./record-reads.ts";
import { registrationsView } from "./registry.ts";
import { settlementView } from "./settlement.ts";
import { signingView } from "./signing.ts";

/**
 * What every read route says, filtered by the session's role (S57, specs §3, design §4.3). Everything a person reads
 * goes through a view here: personal numbers are masked, and a compliance matter is a neutral "Compliance review"
 * for every role except `compliance_officer` and `mlro` (admin is not one). Nothing here writes.
 */
export interface Viewer {
  id: string;
  /** The main role; what the viewer may see and do is decided from every role they hold (`rolesOf`, M5c, S83). */
  role: SpaRole;
  roles?: readonly SpaRole[] | undefined;
}
type Reader = { db: SpaDb };
export type EventRow = typeof dealEvents.$inferSelect;
export type ApprovalRow = typeof spaApprovals.$inferSelect;
export type HelperRunRow = typeof helperRuns.$inferSelect;
export type TaskRow = typeof spaTasks.$inferSelect;

export const COMPLIANCE_LABEL = "Compliance review";

// ---------------------------------------------------------------------------------------------
// Names: `user:<id>` actors become the person's name.

export async function userNames(
  db: SpaDb,
  actors: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const ids = [
    ...new Set(
      actors
        .map((a) => (a?.startsWith("user:") || a?.startsWith("copilot:") ? a.slice(a.indexOf(":") + 1) : a))
        .filter((x): x is string => !!x && /^[0-9a-f-]{36}$/.test(x)),
    ),
  ];
  if (!ids.length) return new Map();
  const rows = await db
    .select({ id: spaUsers.id, name: spaUsers.name })
    .from(spaUsers)
    .where(inArray(spaUsers.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

export interface ActorView {
  kind: "user" | "system" | "helper" | "copilot" | "party";
  label: string;
}
function viewActor(actor: string, names: ReadonlyMap<string, string>): ActorView {
  const [kind = "", rest = ""] = [actor.slice(0, actor.indexOf(":")), actor.slice(actor.indexOf(":") + 1)];
  if (kind === "user") return { kind: "user", label: names.get(rest) ?? "Staff" };
  if (kind === "copilot") return { kind: "copilot", label: "Copilot" };
  if (kind === "party") return { kind: "party", label: "A party" };
  if (kind === "helper") return { kind: "helper", label: rest || "Helper" };
  return { kind: "system", label: "System" };
}

// ---------------------------------------------------------------------------------------------
// Events

export interface EventView {
  id: string;
  type: string;
  label: string;
  at: Date;
  actor: ActorView;
  fromState: string | null;
  toState: string | null;
  payload: Record<string, unknown>;
}

const humanise = (type: string): string => {
  const words = type.toLowerCase().replaceAll("_", " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
};
const gateName = (gate: unknown): string =>
  gate === "compliance_review"
    ? COMPLIANCE_LABEL
    : typeof gate === "string" && gate in spaGates
      ? spaGates[gate as SpaGateId].label
      : "Approval";
export function eventLabel(type: string, payload: Record<string, unknown>): string {
  if (type === "COMPLIANCE_REVIEW_RECORDED") return COMPLIANCE_LABEL;
  if (type === "APPROVAL_PROPOSED") return `Approval requested: ${gateName(payload.gate)}`;
  if (type === "APPROVAL_DECIDED") return `Approval decided: ${gateName(payload.gate)}`;
  return humanise(type);
}
const stateFor = (s: string | null, role: RoleSet): string | null =>
  s === null ? null : s === "AML_HOLD" ? stageKey("AML_HOLD", role) : s;

/** One timeline entry for a role, or null when the role may not see this type (fail closed). */
export function viewEvent(
  row: EventRow,
  role: RoleSet,
  names: ReadonlyMap<string, string> = new Map(),
): EventView | null {
  if (!eventVisibleTo(row.type, role)) return null;
  const raw = row.payload ?? {};
  // A compliance review, and the approval events of a compliance gate, say only that a review happened (S42, S50).
  const neutral =
    !isComplianceRole(role) &&
    (row.type === "COMPLIANCE_REVIEW_RECORDED" ||
      ((row.type === "APPROVAL_PROPOSED" || row.type === "APPROVAL_DECIDED") && raw.gate === "compliance_review"));
  let payload: Record<string, unknown>;
  if (neutral && row.type === "COMPLIANCE_REVIEW_RECORDED") payload = {};
  else if (neutral) {
    const { approvalId: _hidden, ...rest } = raw;
    payload = maskPii(rest);
  } else payload = maskPii(raw);
  return {
    id: row.id,
    type: row.type,
    label: eventLabel(row.type, raw),
    at: row.at,
    actor: neutral ? { kind: "system", label: "System" } : viewActor(row.actor, names),
    fromState: stateFor(row.fromState, role),
    toState: stateFor(row.toState, role),
    payload,
  };
}

// ---------------------------------------------------------------------------------------------
// Approvals

export interface NeutralApprovalView {
  id: string;
  gate: "compliance_review";
  title: "Compliance review";
  status: "open" | "closed";
  entity: { kind: string; id: string };
}
export interface ApprovalView {
  id: string;
  gate: string;
  gateLabel: string;
  title: string;
  status: ApprovalRow["status"];
  outcome: string | null;
  entity: { kind: string; id: string };
  approverRole: SpaRole;
  proposedBy: ActorView;
  proposal: Record<string, unknown>;
  reasons: string[];
  createdAt: Date;
  decidedAt: Date | null;
  decidedBy: string | null;
  decisionNote: string | null;
  editedProposal: Record<string, unknown> | null;
  mayDecide: { ok: true } | { ok: false; reason: string };
}

/** Whether a role is shown this approval as it is (false: only the neutral open/closed form). */
export const sees = (gate: string, role: RoleSet): boolean => !isComplianceGate(gate) || isComplianceRole(role);

export function viewApproval(
  row: ApprovalRow,
  viewer: Viewer,
  names: ReadonlyMap<string, string> = new Map(),
): ApprovalView | NeutralApprovalView {
  const entity = { kind: row.entityKind as string, id: row.entityId };
  if (!sees(row.gate, rolesOf(viewer)))
    return {
      id: row.id,
      gate: "compliance_review",
      title: COMPLIANCE_LABEL,
      status: row.status === "pending" ? "open" : "closed",
      entity,
    };
  return {
    id: row.id,
    gate: row.gate,
    gateLabel: spaGates[row.gate].label,
    title: maskPiiText(row.title),
    status: row.status,
    outcome: row.outcome,
    entity,
    approverRole: row.approverRole,
    proposedBy: viewActor(row.proposedBy, names),
    proposal: maskPii(row.proposal),
    reasons: row.reasons.map(maskPiiText),
    createdAt: row.createdAt,
    decidedAt: row.decidedAt,
    decidedBy: row.decidedBy ? (names.get(row.decidedBy) ?? "Staff") : null,
    decisionNote: row.decisionNote === null ? null : maskPiiText(row.decisionNote),
    editedProposal: row.editedProposal ? maskPii(row.editedProposal) : null,
    mayDecide:
      row.status === "pending"
        ? mayDecide({ gate: row.gate, proposedBy: row.proposedBy }, viewer)
        : { ok: false, reason: `this approval is already ${row.status}` },
  };
}

// ---------------------------------------------------------------------------------------------
// Helper runs and tasks

export interface HelperRunView {
  id: string;
  helper: string;
  status: string;
  reasons: string[];
  result: Record<string, unknown>;
  modelTag: string | null;
  createdAt: Date;
}
/** A run the helper marked for compliance is hidden from every other role. */
export function viewHelperRun(row: HelperRunRow, role: RoleSet): HelperRunView | null {
  if (row.visibility === "compliance" && !isComplianceRole(role)) return null;
  return {
    id: row.id,
    helper: row.helper,
    status: row.status,
    reasons: row.reasons.map(maskPiiText),
    result: maskPii(row.result),
    modelTag: row.modelTag,
    createdAt: row.createdAt,
  };
}

export interface TaskView {
  id: string;
  dealId: string | null;
  kind: string;
  role: SpaRole;
  title: string;
  detail: Record<string, unknown>;
  status: string;
  createdAt: Date;
  doneAt: Date | null;
}
export const viewTask = (row: TaskRow): TaskView => ({
  id: row.id,
  dealId: row.dealId,
  kind: row.kind,
  role: row.role,
  title: maskPiiText(row.title),
  detail: maskPii(row.detail),
  status: row.status,
  createdAt: row.createdAt,
  doneAt: row.doneAt,
});

// ---------------------------------------------------------------------------------------------
// Waiting for: who the deal waits for and since when (design §4.2). The age is the caller's Clock, never `new Date()`.

export interface WaitingFor {
  /** The role that acts next; null when nobody on the staff acts (signers) or the role may not be named (a review). */
  role: SpaRole | null;
  label: string;
  since: Date;
  waitedDays: number;
}
const BY_STATE: Partial<Record<DealState, { role: SpaRole | null; label: string }>> = {
  OFFER_AGREED: { role: "sales_officer", label: "Start the party checks" },
  PARTY_CHECK: { role: "sales_officer", label: "Checking parties" },
  AGREEMENT_DRAFT: { role: "sales_officer", label: "Prepare the agreement" },
  LEGAL_REVIEW: { role: "legal", label: "Legal approval" },
  SIGNING: { role: null, label: "Waiting for signers" },
  NOC: { role: "sales_admin", label: "Developer NOC" },
  FINANCE: { role: "sales_officer", label: "Bank letters" },
  SETTLEMENT: { role: "finance", label: "Settlement statement" },
  REGISTRATION: { role: "sales_admin", label: "Oqood registration" },
  TRANSFER: { role: "sales_admin", label: "Transfer" },
  INSTALMENTS: { role: "finance", label: "Instalments" },
};
const DAY_MS = 86_400_000;

/**
 * The oldest open gate decides; with none, the state does. A compliance review is named to nobody but the compliance
 * roles: everyone else reads "Compliance review" with no role (S57).
 */
export function waitingFor(
  deal: { state: DealState; createdAt: Date },
  pending: readonly { id: string; gate: SpaGateId; approverRole: SpaRole; createdAt: Date }[],
  enteredAt: Date | null,
  role: RoleSet,
  now: Date,
): WaitingFor | null {
  if (deal.state === "COMPLETED" || deal.state === "HANDED_OVER" || deal.state === "CANCELLED") return null;
  const done = (who: SpaRole | null, label: string, since: Date): WaitingFor => ({
    role: who,
    label,
    since,
    waitedDays: Math.max(0, Math.floor((now.getTime() - since.getTime()) / DAY_MS)),
  });
  const oldest = pending.toSorted((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : 1))[0];
  if (oldest) {
    if (!sees(oldest.gate, role)) return done(null, COMPLIANCE_LABEL, oldest.createdAt);
    return done(oldest.approverRole, spaGates[oldest.gate].label, oldest.createdAt);
  }
  const since = enteredAt ?? deal.createdAt;
  if (deal.state === "AML_HOLD")
    return done(isComplianceRole(role) ? "compliance_officer" : null, COMPLIANCE_LABEL, since);
  const s = BY_STATE[deal.state];
  return s ? done(s.role, s.label, since) : null;
}

// ---------------------------------------------------------------------------------------------
// The deal record: sections, each with its own rule for when it applies (design §4.3). Later chunks append theirs.

export interface RecordSection {
  key: string;
  /** A section that does not apply to this deal is absent from the record, never empty. */
  appliesTo(deal: DealRow): boolean;
  /**
   * The steps this section belongs to (C39, S71): it needs one of them in this deal type's list (`appliesTo`) and the
   * deal to have reached it (the record loader checks that against the `steps` section).
   */
  steps?: readonly StepKey[];
  /** The roles that may read the section. A role that may not never gets the key: absent, not empty. */
  visibleTo?(role: RoleSet): boolean;
  load(r: Reader, deal: DealRow, viewer: Viewer, ctx: SpaContext): Promise<unknown>;
}

const OPEN_CASE = ["open", "info_requested"] as const;

/** The deal's compliance status as sales read it: a review is open or there is none. Nothing more. */
async function complianceOpen(
  db: SpaDb,
  deal: DealRow,
): Promise<{ open: boolean; partyIds: Set<string>; cases: number }> {
  const cases = await db
    .select({ id: amlCases.id })
    .from(amlCases)
    .where(and(eq(amlCases.dealId, deal.id), inArray(amlCases.status, [...OPEN_CASE])));
  const hits = cases.length
    ? await db
        .select({ partyId: amlHits.partyId })
        .from(amlHits)
        .where(
          inArray(
            amlHits.caseId,
            cases.map((c) => c.id),
          ),
        )
    : [];
  const pending = await db
    .select({ gate: spaApprovals.gate, proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(eq(spaApprovals.entityKind, "deal"), eq(spaApprovals.entityId, deal.id), eq(spaApprovals.status, "pending")),
    );
  const gated = pending.filter((p) => isComplianceGate(p.gate));
  const partyIds = new Set<string>();
  for (const h of hits) if (h.partyId) partyIds.add(h.partyId);
  for (const g of gated) if (typeof g.proposal.partyId === "string") partyIds.add(g.proposal.partyId);
  return { open: cases.length > 0 || gated.length > 0 || deal.state === "AML_HOLD", partyIds, cases: cases.length };
}

const AGREEMENT_REVIEW_STATES: readonly string[] = [
  "LEGAL_REVIEW",
  "SIGNING",
  "REGISTRATION",
  "NOC",
  "FINANCE",
  "SETTLEMENT",
  "TRANSFER",
  "INSTALMENTS",
];
const CHASING_CLOSED: readonly string[] = ["CANCELLED", "COMPLETED", "HANDED_OVER"];

const STAFF_READERS: readonly SpaRole[] = [
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "admin",
  "legal",
  "finance",
];
/** Who the payments route lets read them, less the compliance roles (the section never carries the payer check). */
const PAYMENT_READERS: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin", "finance"];
const SETTLEMENT_READERS: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "legal", "finance"];
const COMPLIANCE_READERS: readonly SpaRole[] = ["compliance_officer", "mlro"];
const stepApplies = (deal: DealRow, keys: readonly StepKey[]) =>
  stepsFor(deal.dealType, deal).some((d) => keys.includes(d.key));

export const RECORD_SECTIONS: readonly RecordSection[] = [
  {
    key: "parties",
    appliesTo: () => true,
    async load({ db }, deal) {
      const rows = await db
        .select({
          partyId: dealParties.partyId,
          role: dealParties.role,
          order: dealParties.order,
          shareBps: dealParties.shareBps,
          kind: parties.kind,
          name: parties.fullNameEn,
        })
        .from(dealParties)
        .innerJoin(parties, eq(parties.id, dealParties.partyId))
        .where(eq(dealParties.dealId, deal.id))
        .orderBy(asc(dealParties.role), asc(dealParties.order));
      const runs = await db
        .select({ partyId: kycRuns.partyId, status: kycRuns.status })
        .from(kycRuns)
        .where(eq(kycRuns.dealId, deal.id))
        .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id));
      const latest = new Map<string, string>();
      for (const r of runs) if (!latest.has(r.partyId)) latest.set(r.partyId, r.status);
      const c = await complianceOpen(db, deal);
      return rows.map((p) => ({
        partyId: p.partyId,
        role: p.role,
        order: p.order,
        shareBps: p.shareBps,
        kind: p.kind,
        name: maskPiiText(p.name),
        kyc: latest.has(p.partyId) ? { status: latest.get(p.partyId)! } : null,
        // S57: "Compliance review: open" or "none", never "no hits" and never a detail.
        compliance: { label: COMPLIANCE_LABEL, status: c.partyIds.has(p.partyId) ? "open" : "none" },
      }));
    },
  },
  {
    key: "steps",
    appliesTo: () => true,
    async load({ db }, deal) {
      const seen = await db
        .selectDistinct({ to: dealEvents.toState })
        .from(dealEvents)
        .where(and(eq(dealEvents.entityKind, "deal"), eq(dealEvents.entityId, deal.id)));
      return dealSteps(
        deal,
        seen.map((s) => s.to).filter((s): s is DealState => !!s),
      );
    },
  },
  {
    key: "compliance",
    appliesTo: () => true,
    async load({ db }, deal, viewer) {
      const c = await complianceOpen(db, deal);
      return {
        label: COMPLIANCE_LABEL,
        status: c.open ? "open" : "none",
        // Compliance roles are pointed to the case screen; everyone else has nothing to follow.
        ...(isComplianceRole(rolesOf(viewer)) ? { cases: c.cases, detailPath: `/api/deals/${deal.id}/aml` } : {}),
      };
    },
  },
  {
    key: "approvals",
    appliesTo: () => true,
    async load({ db }, deal, viewer) {
      const rows = await db
        .select()
        .from(spaApprovals)
        .where(and(eq(spaApprovals.entityKind, "deal"), eq(spaApprovals.entityId, deal.id)))
        .orderBy(asc(spaApprovals.createdAt), asc(spaApprovals.id))
        .limit(100);
      const names = await userNames(db, [...rows.map((r) => r.proposedBy), ...rows.map((r) => r.decidedBy)]);
      return rows.map((r) => viewApproval(r, viewer, names));
    },
  },
  {
    key: "tasks",
    appliesTo: () => true,
    async load({ db }, deal, viewer) {
      const rows = await db
        .select()
        .from(spaTasks)
        .where(eq(spaTasks.dealId, deal.id))
        .orderBy(desc(spaTasks.createdAt), desc(spaTasks.id))
        .limit(100);
      return rows.filter((t) => taskVisibleTo(t.role, rolesOf(viewer))).map(viewTask);
    },
  },
  {
    key: "helper_runs",
    appliesTo: () => true,
    async load({ db }, deal, viewer) {
      const rows = await db
        .select()
        .from(helperRuns)
        .where(
          and(
            eq(helperRuns.dealId, deal.id),
            ...(isComplianceRole(rolesOf(viewer)) ? [] : [eq(helperRuns.visibility, "staff" as const)]),
          ),
        )
        .orderBy(desc(helperRuns.createdAt), desc(helperRuns.id))
        .limit(10);
      return rows.map((r) => viewHelperRun(r, rolesOf(viewer))).filter((v) => v !== null);
    },
  },
  {
    key: "agreement_review",
    // From legal's step on, while the deal is live: the latest agreement's review (S60). Advice only.
    appliesTo: (deal) => AGREEMENT_REVIEW_STATES.includes(deal.state),
    async load({ db }, deal, _viewer, ctx) {
      const [ag] = await db
        .select()
        .from(agreements)
        .where(eq(agreements.dealId, deal.id))
        .orderBy(desc(agreements.version))
        .limit(1);
      if (!ag) return null;
      return {
        agreement: { id: ag.id, kind: ag.kind, version: ag.version, status: ag.status },
        review: await agreementReviewView(ctx, ag.id),
      };
    },
  },
  {
    key: "chasing",
    // Every live deal: what each party still owes, what was sent and whether an agent paused it (S60).
    appliesTo: (deal) => !CHASING_CLOSED.includes(deal.state),
    async load(_r, deal, _viewer, ctx) {
      return chasingView(ctx, deal);
    },
  },
  {
    key: "payment_plan",
    // Primary deals and a resale that took the developer's plan over have instalments (specs §5).
    appliesTo: (deal) => deal.dealType === "primary_offplan" || deal.planTakenOver,
    async load({ db }, deal) {
      return db
        .select({
          seq: paymentPlanRows.seq,
          label: paymentPlanRows.label,
          dueOn: paymentPlanRows.dueOn,
          milestone: paymentPlanRows.milestone,
          amountFils: paymentPlanRows.amountFils,
        })
        .from(paymentPlanRows)
        .where(eq(paymentPlanRows.dealId, deal.id))
        .orderBy(asc(paymentPlanRows.seq));
    },
  },
  ...stepSections(),
];

// ---------------------------------------------------------------------------------------------
// C39 (S71): the evidence sections. Each reuses its route's read through a role-free view, and a role that may not read
// it never gets the key. Money is integer fils, dates are Asia/Dubai calendar days, text is masked again on the way out.

/** Has the deal reached one of these steps? (A step that is not in its list is never reached.) */
export function stepReached(steps: readonly DealStep[], keys: readonly StepKey[]): boolean {
  return steps.some((s) => keys.includes(s.key) && s.status !== "upcoming");
}

/** The price lines' difference from the price, in fils; the statement balances when it is zero and is the deal's price. */
export function settlementBalance(
  lines: readonly { code: string; amountFils: number }[],
  statementPriceFils: number,
  dealPriceFils: number,
): { differenceFils: number; balancesToZero: boolean } {
  const differenceFils =
    statementPriceFils - lines.filter((l) => l.code.startsWith("price:")).reduce((a, l) => a + l.amountFils, 0);
  return { differenceFils, balancesToZero: differenceFils === 0 && statementPriceFils === dealPriceFils };
}

function stepSections(): RecordSection[] {
  const section = (
    key: string,
    steps: readonly StepKey[] | undefined,
    readers: readonly SpaRole[] | null,
    load: RecordSection["load"],
  ): RecordSection => ({
    key,
    ...(steps ? { steps } : {}),
    appliesTo: (deal) => !steps || stepApplies(deal, steps),
    ...(readers ? { visibleTo: (role: RoleSet) => [role].flat().some((r) => readers.includes(r)) } : {}),
    load,
  });
  return [
    section("documents", undefined, null, (_r, deal, _v, ctx) => documentsView(ctx, deal.id)),
    section("aml", ["parties"], COMPLIANCE_READERS, (_r, deal, _v, ctx) => amlSummary(ctx, deal.id)),
    section("agreement", ["agreement"], STAFF_READERS, (_r, deal, _v, ctx) => agreementView(ctx, deal.id)),
    section("signing", ["signing"], STAFF_READERS, async (_r, deal, _v, ctx) => {
      const v = await signingView(ctx, deal.id);
      if (!v) return null;
      const now = ctx.clock.now();
      return {
        status: v.envelope.status,
        completedOn: v.envelope.completedAt ? (toDubaiDate(new Date(v.envelope.completedAt)) as string) : null,
        signers: v.signers.map((x) => ({
          seq: x.seq,
          role: x.role,
          name: maskPiiText(x.name),
          state: x.signed ? "signed" : new Date(x.linkExpiresAt) < now ? "link_expired" : "waiting",
          linkExpiresOn: toDubaiDate(new Date(x.linkExpiresAt)) as string,
        })),
      };
    }),
    section("noc", ["noc"], STAFF_READERS, async (_r, deal, _v, ctx) => (await nocStatusView(ctx, deal.id)).noc),
    section("finance", ["finance"], STAFF_READERS, async (_r, deal, viewer, ctx) => {
      const status = await nocStatusView(ctx, deal.id);
      // The payments route is not legal's: legal reads the bank letters (as `nocStatus` allows) and no receipt.
      const rows = hasAnyRole(viewer, PAYMENT_READERS) ? await paymentsView(ctx, deal.id, rolesOf(viewer)) : [];
      return {
        bankLetters: status.bankLetters,
        // An allow-list: the payer check is for compliance roles only, and a new field never reaches here by default.
        payments: rows.map((p) => ({
          seq: p.seq,
          status: p.status,
          method: p.method,
          amountReadFils: p.amountReadFils,
          amountFils: p.amountFils,
          paidOn: p.paidOn,
          account: p.account,
          intoEscrow: p.intoEscrow,
          note: p.note,
        })),
      };
    }),
    section("settlement", ["settlement"], SETTLEMENT_READERS, async (_r, deal, _v, ctx) => {
      const v = await settlementView(ctx, deal);
      const st = v.statement;
      return {
        statement: st
          ? {
              version: st.version,
              status: st.status,
              priceFils: st.priceFils,
              buyerPaysFils: st.buyerPaysFils,
              sellerReceivesFils: st.sellerReceivesFils,
              ...settlementBalance(st.lines, st.priceFils, deal.priceFils),
              lines: st.lines.map((l) => ({
                seq: l.seq,
                code: l.code,
                payer: l.payer,
                payee: l.payee,
                label: maskPiiText(l.label),
                amountFils: l.amountFils,
                source: maskPiiText(l.source),
              })),
            }
          : null,
        reasons: v.reasons.map((x) => maskPiiText(x)),
      };
    }),
    section("registration", ["registration", "transfer"], STAFF_READERS, async (_r, deal, _v, ctx) => ({
      attempts: (await registrationsView(ctx, deal.id)).attempts.map((a) => ({
        kind: a.kind,
        attempt: a.attempt,
        status: a.status,
        registryNo: a.registryNo,
        issuedOn: a.issuedOn,
        createdOn: toDubaiDate(a.createdAt) as string,
        reasons: a.reasons.map((x) => ({ code: x.code, field: x.field, message: maskPiiText(x.message) })),
      })),
    })),
  ];
}
