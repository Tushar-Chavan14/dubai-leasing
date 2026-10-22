import { formatAed, toDubaiDate } from "@leasing/core";
import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { EngineClient } from "../types.ts";
import { untrustedDeep } from "../untrusted.ts";

/** Money for the model: integer fils plus the display string it should quote. */
export const aed = (fils: number) => ({ fils, text: formatAed(fils) });
export const Money = z.object({ fils: z.number().int(), text: z.string() });

/** A timestamp as the Asia/Dubai calendar date (what legal checks use). */
export const dubaiDay = (iso: string | null | undefined) => (iso ? toDubaiDate(new Date(iso)) : null);

export const LeaseArg = z
  .string()
  .min(2)
  .max(80)
  .describe("Lease id, lease reference (MRN-1204/2026-03), unit code (MRN-1204) or tenant name");

/** The engine's `GET /api/leases/:id` response, the parts tools use. */
export interface LeaseDetail {
  id: string;
  ref: string;
  state: string;
  startOn: string;
  endOn: string;
  annualRentFils: number;
  cheques: number;
  depositFils: number;
  rulesVersion: string;
  ejariNo: string | null;
  unit: { id: string; code: string; building: string; community: string; bedrooms: number | null };
  parties: { role: string; fullNameEn: string }[];
  deadlines: { id: string; milestone: string; dueOn: string; status: string; note: string | null }[];
  approvals: {
    id: string;
    gate: string;
    approverRole: string;
    title: string;
    status: string;
    createdAt: string;
    proposal: Record<string, unknown>;
    editedProposal: Record<string, unknown> | null;
  }[];
  tasks: {
    id: string;
    kind: string;
    title: string;
    status: string;
    dueOn: string | null;
    assigneeRole: string;
    details: Record<string, unknown>;
  }[];
  events: {
    id: string;
    type: string;
    actor: string;
    at: string;
    fromState: string | null;
    toState: string | null;
    payload: Record<string, unknown>;
  }[];
  outbound: {
    id: string;
    purpose: string;
    subject: string;
    status: string;
    template: string;
    messageId: string | null;
    smtpResponse: string | null;
    sentAt: string | null;
    acknowledgedAt: string | null;
    error: string | null;
    approvalId: string | null;
  }[];
  inbound: {
    id: string;
    ref: string;
    type: string;
    channel: string;
    status: string;
    payload: { choice?: string; comment?: string };
    result: { action?: string; reason?: string; classification?: { intent?: string; needsPerson?: boolean } } | null;
    receivedAt: string;
  }[];
  helperRuns: { id: string; helper: string; status: string; at: string }[];
}

export async function fetchLease(engine: EngineClient, ref: string): Promise<LeaseDetail> {
  const id = await resolveLeaseId(engine, ref);
  return engine.get<LeaseDetail>(`/api/leases/${id}`);
}

/** Milestone keys look like "notice_send@2027-03-29"; the model gets the readable part. */
export const milestoneName = (m: string) => m.split("@")[0]!.replaceAll("_", " ");

/**
 * Task details written by the engine can carry tenant text. When the task is marked
 * `untrusted`, every string in it is wrapped (nested too); a `comment` is always wrapped.
 */
export function taskDetails(details: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (k === "untrusted") continue;
    out[k] = details.untrusted || k === "comment" ? untrustedDeep(v) : v;
  }
  return out;
}

/** Actors without ids: the model doesn't need staff or tenant ids to explain a timeline. */
export const actorKind = (a: string) =>
  a.startsWith("user:")
    ? "staff"
    : a.startsWith("tenant:")
      ? "tenant"
      : a.startsWith("copilot:")
        ? "copilot"
        : a.startsWith("helper:")
          ? `helper ${a.slice(7)}`
          : a;
