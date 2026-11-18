import { z } from "zod";
import type { CalendarDate } from "../dates.ts";
import { allow, defineMachine, deny, type GuardResult } from "./machine.ts";

export const LeaseState = z.enum([
  "CONTRACT",
  "REGISTRATION",
  "MOVE_IN",
  "ACTIVE",
  "RENEWAL",
  "MOVE_OUT",
  "DISPUTE",
  "CLOSED",
]);
export type LeaseState = z.infer<typeof LeaseState>;

export const LeaseEvent = z.enum([
  "CONTRACT_SIGNED",
  "EJARI_ISSUED",
  "MOVE_IN_COMPLETED",
  "RENEWAL_WINDOW_OPENED",
  "RENEWED",
  "TENANT_VACATE_NOTICE",
  "TERMINATED",
  "SETTLED",
  "DISPUTE_OPENED",
  "DISPUTE_RESOLVED_ACTIVE",
  "DISPUTE_RESOLVED_MOVE_OUT",
  "DISPUTE_RESOLVED_CLOSED",
]);
export type LeaseEvent = z.infer<typeof LeaseEvent>;

/** States in which the lease's Ejari registration (if any) counts as active. */
export const LEASE_STATES_WITH_LIVE_EJARI: readonly LeaseState[] = [
  "MOVE_IN",
  "ACTIVE",
  "RENEWAL",
  "MOVE_OUT",
  "DISPUTE",
];

export interface LeaseSnapshot {
  ejariNo: string | null;
  ejariCancelledOn: CalendarDate | null;
  depositSettledOn: CalendarDate | null;
  startOn: CalendarDate;
  endOn: CalendarDate;
}

export interface LeaseGuardContext {
  lease: LeaseSnapshot;
  today: CalendarDate;
  /** For RENEWED: the new term the payload proposes. */
  newTerm?: { startOn: CalendarDate; endOn: CalendarDate } | undefined;
  /** For MOVE_IN_COMPLETED: what is still missing from the move-in checklist (empty = complete). */
  moveInMissing?: string[] | undefined;
}

/** Move-in (step 7): the Ejari number, every checklist item ticked and a photo of every room. */
function moveInGuard({ lease, moveInMissing }: LeaseGuardContext): GuardResult {
  const reasons: string[] = [];
  if (!lease.ejariNo) reasons.push("Ejari number missing");
  if (!moveInMissing) reasons.push("move-in checklist not started");
  else reasons.push(...moveInMissing);
  return reasons.length ? deny(...reasons) : allow;
}

const needsEjariNo = ({ lease }: LeaseGuardContext): GuardResult =>
  lease.ejariNo ? allow : deny("Ejari number missing");

function settledGuard({ lease }: LeaseGuardContext): GuardResult {
  const reasons: string[] = [];
  if (!lease.depositSettledOn) reasons.push("deposit not settled");
  if (lease.ejariNo && !lease.ejariCancelledOn) reasons.push("Ejari not cancelled");
  return reasons.length ? deny(...reasons) : allow;
}

/** A landlord's repossession takes effect at the end of the term, never mid-lease. */
const atOrAfterLeaseEnd = ({ lease, today }: LeaseGuardContext): GuardResult =>
  today >= lease.endOn ? allow : deny(`termination takes effect at lease end (${lease.endOn}), not before`);

function renewedGuard({ lease, newTerm }: LeaseGuardContext): GuardResult {
  if (!newTerm) return deny("new term missing");
  if (newTerm.startOn <= lease.endOn) return deny("new term must start after the current end date");
  if (newTerm.endOn <= newTerm.startOn) return deny("new term end must be after its start");
  return allow;
}

export const leaseMachine = defineMachine<LeaseState, LeaseEvent, LeaseGuardContext>({
  entity: "lease",
  states: LeaseState.options,
  events: LeaseEvent.options,
  initial: "CONTRACT",
  terminal: ["CLOSED"],
  transitions: [
    {
      from: "CONTRACT",
      event: "CONTRACT_SIGNED",
      to: "REGISTRATION",
      gate: "final_contract",
      description: "signed by both parties (contract approved first)",
    },
    {
      from: "REGISTRATION",
      event: "EJARI_ISSUED",
      to: "MOVE_IN",
      gate: "ejari_submission",
      guard: needsEjariNo,
      description: "Ejari issued (submission approved)",
    },
    {
      from: "MOVE_IN",
      event: "MOVE_IN_COMPLETED",
      to: "ACTIVE",
      guard: moveInGuard,
      description: "move-in checklist complete",
    },
    { from: "ACTIVE", event: "RENEWAL_WINDOW_OPENED", to: "RENEWAL", description: "T−5 months milestone" },
    {
      from: "RENEWAL",
      event: "RENEWED",
      to: "ACTIVE",
      gate: "renewal_notice",
      guard: renewedGuard,
      description: "renewed on the approved term and rent",
    },
    { from: "ACTIVE", event: "TENANT_VACATE_NOTICE", to: "MOVE_OUT", description: "tenant gave notice" },
    { from: "RENEWAL", event: "TENANT_VACATE_NOTICE", to: "MOVE_OUT", description: "tenant gave notice" },
    // Landlord-side ending (sale, own use, major works, demolition). Not renewing for any other
    // reason is the tenant's choice (TENANT_VACATE_NOTICE).
    ...(["ACTIVE", "RENEWAL"] as const).map((from) => ({
      from,
      event: "TERMINATED" as const,
      to: "MOVE_OUT" as const,
      gate: "vacate_notice" as const,
      guard: atOrAfterLeaseEnd,
      description: "landlord repossession at lease end (12-month notice approved)",
    })),
    {
      from: "MOVE_OUT",
      event: "SETTLED",
      to: "CLOSED",
      guard: settledGuard,
      description: "deposit settled + Ejari cancelled",
    },
    { from: "ACTIVE", event: "DISPUTE_OPENED", to: "DISPUTE", description: "dispute opened" },
    { from: "RENEWAL", event: "DISPUTE_OPENED", to: "DISPUTE", description: "dispute opened" },
    { from: "MOVE_OUT", event: "DISPUTE_OPENED", to: "DISPUTE", description: "dispute opened" },
    { from: "DISPUTE", event: "DISPUTE_RESOLVED_ACTIVE", to: "ACTIVE", description: "resolved, tenancy continues" },
    { from: "DISPUTE", event: "DISPUTE_RESOLVED_MOVE_OUT", to: "MOVE_OUT", description: "resolved, tenant leaves" },
    {
      from: "DISPUTE",
      event: "DISPUTE_RESOLVED_CLOSED",
      to: "CLOSED",
      guard: settledGuard,
      description: "resolved and settled",
    },
  ],
});
