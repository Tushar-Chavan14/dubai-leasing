import { dealSteps, type DealState, type DealType } from "@spa/core";
import type { DealHeader, DealRowView, EventItem, PartyView, TaskItem } from "../lib/contracts";

/** Fictional response fixtures in the shape the engine's C29 routes return (every name is made up). */
export const SINCE = "2026-11-15T06:00:00.000Z";

export function dealRow(over: Partial<DealRowView> = {}): DealRowView {
  return {
    id: "0198a1b2-0000-7000-8000-000000000001",
    ref: "D-0001",
    type: "primary_offplan",
    typeLabel: "Primary off-plan",
    stage: "SIGNING",
    stageLabel: "Signing",
    property: { kind: "unit", label: "U-101" },
    sellers: ["Fictional Developments LLC"],
    buyers: ["Sample Buyer One"],
    priceFils: 150_000_000,
    onHold: false,
    inDefault: false,
    waitingFor: { role: null, label: "Waiting for signers", since: SINCE, waitedDays: 4 },
    owner: { label: "Rania Officer" },
    createdAt: "2026-11-01T06:00:00.000Z",
    ageDays: 18,
    ...over,
  };
}

export function header(type: DealType, state: DealState, over: Partial<DealHeader> = {}): DealHeader {
  const base = dealRow({
    type,
    typeLabel: { primary_offplan: "Primary off-plan", resale_ready: "Ready resale", resale_offplan: "Off-plan resale" }[
      type
    ],
  });
  return {
    ...base,
    rulesVersion: "dubai-sales-2026-01",
    policyVersion: 1,
    sellerMortgage: false,
    buyerMortgage: false,
    planTakenOver: type === "resale_offplan",
    targetTransferOn: null,
    unitNo: null,
    projectCode: null,
    inDefaultSince: null,
    inDefaultReason: null,
    ...over,
  };
}

export const stepsOf = (
  type: DealType,
  state: DealState,
  flags: { buyerMortgage?: boolean; planTakenOver?: boolean } = {},
) =>
  dealSteps(
    {
      dealType: type,
      state,
      sellerMortgage: false,
      buyerMortgage: flags.buyerMortgage ?? false,
      planTakenOver: flags.planTakenOver ?? type === "resale_offplan",
    },
    [],
  );

export const partyView = (over: Partial<PartyView> = {}): PartyView => ({
  partyId: "p1",
  role: "buyer",
  order: 1,
  shareBps: 10_000,
  kind: "person",
  name: "Sample Buyer One",
  kyc: { status: "passed" },
  compliance: { label: "Compliance review", status: "none" },
  ...over,
});

export const event = (over: Partial<EventItem> = {}): EventItem => ({
  id: "e1",
  type: "DEAL_CREATED",
  label: "Deal created",
  at: "2026-11-01T06:00:00.000Z",
  actor: { kind: "user", label: "Rania Officer" },
  fromState: null,
  toState: "OFFER_AGREED",
  ...over,
});

export const task = (over: Partial<TaskItem> = {}): TaskItem => ({
  id: "t1",
  dealId: "0198a1b2-0000-7000-8000-000000000001",
  kind: "confirm_amount",
  role: "sales_officer",
  title: "Confirm the bank amount",
  status: "open",
  createdAt: "2026-11-15T06:00:00.000Z",
  doneAt: null,
  ...over,
});

/** Words no page may show a role that has no part in compliance. */
export const COMPLIANCE_WORDS = /\baml\b|screening|sanction|\bpep\b|\bedd\b|\brisk\b|not_screened|no hits/i;
/** Personal numbers: none may reach a page. */
export const PERSONAL = /N1234567|784-1990-1234567-1|\+971 ?50 ?123 ?4567/;

/** An inbox item in the shape the engine's `GET /api/approvals?scope=inbox` returns (S57, S63). */
export function inboxItem(over: Record<string, unknown> = {}) {
  return {
    id: "0198a1b2-0000-7000-8000-0000000000a1",
    gate: "kyc_review",
    gateLabel: "Document unreadable, expired or names don't match",
    title: "Passport is unreadable",
    status: "pending",
    outcome: null,
    entity: { kind: "deal", id: "0198a1b2-0000-7000-8000-000000000001" },
    entityRef: "D-0001",
    approverRole: "sales_manager",
    proposedBy: { kind: "system", label: "Document check" },
    proposal: {},
    reasons: ["The name on the passport differs from the form"],
    createdAt: "2026-11-15T06:00:00.000Z",
    decidedAt: null,
    decidedBy: null,
    decisionNote: null,
    mayDecide: { ok: true },
    ...over,
  };
}
