import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { untrusted, untrustedDeep } from "../untrusted.ts";
import { actorKind, aed, dubaiDay, LeaseArg } from "./shared.ts";

const Input = z.object({
  lease: LeaseArg,
  limit: z
    .number()
    .int()
    .min(10)
    .max(120)
    .default(60)
    .describe("How many timeline events, oldest first (the pack itself has all)"),
});

const Output = z.object({
  leaseRef: z.string(),
  facts: z.record(z.string(), z.unknown()),
  timeline: z.array(
    z.object({
      on: z.string().nullable(),
      type: z.string(),
      by: z.string(),
      to: z.string().nullable(),
      rulesVersion: z.string().nullable(),
    }),
  ),
  eventsTotal: z.number().int(),
  notices: z.array(z.record(z.string(), z.unknown())),
  payments: z.array(z.record(z.string(), z.unknown())),
  depositStatements: z.array(z.record(z.string(), z.unknown())),
  complaints: z.array(z.record(z.string(), z.unknown())),
  tenantSubmissions: z.array(z.record(z.string(), z.unknown())),
});

interface CaseIndex {
  lease: Record<string, unknown> & { ref: string };
  events: { at: string; type: string; actor: string; to: string | null; rulesVersion: string | null }[];
  emails: { purpose: string; subject: string; status: string; sentAt: string | null; acknowledgedAt: string | null }[];
  payments: Record<string, unknown>[];
  depositStatements: (Record<string, unknown> & { items?: unknown })[];
  complaints: {
    ref: string | null;
    createdAt: string;
    category: string | null;
    status: string;
    text: string;
    ticket: unknown;
  }[];
  tenantSubmissions: {
    ref: string;
    type: string;
    receivedAt: string;
    status: string;
    payload: Record<string, unknown>;
  }[];
}

/** Bookkeeping events that add nothing to a case narrative (the pack itself keeps them all). */
const NOISE = new Set([
  "HELPER_RAN",
  "TASK_CREATED",
  "EMAIL_SENT",
  "PHOTO_UPLOADED",
  "PHOTO_REMOVED",
  "DOCUMENT_VIEWED",
  "CASE_PACK_VIEWED",
  "CASE_PACK_EXPORTED",
  "INBOUND_RECEIVED",
  "MILESTONE_FIRED",
]);

/** `xxxFils: n` becomes `xxx: { fils, text }`, so the model quotes the display amount, never raw fils. */
const money = (r: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(r).map(([k, v]) =>
      k.endsWith("Fils") && typeof v === "number" ? [k.slice(0, -4), aed(v)] : [k, v],
    ),
  );

/** Everything in a tenant submission is their input: every string is wrapped, at any depth. */
const submission = (p: Record<string, unknown>) => untrustedDeep(p) as Record<string, unknown>;

/**
 * The dispute case pack's index for a lease (step 11): facts, the timeline with rules versions,
 * notices with delivery evidence, payments, deposit statements, complaints and the tenant's own
 * submissions (their words wrapped as untrusted). Read only; the zip is exported in the app.
 */
export const getCasePack: CopilotTool<typeof Input, typeof Output> = {
  name: "get_case_pack",
  kind: "read",
  description:
    "Everything recorded about a lease for a dispute (RDC) case: timeline, notices and their delivery, payments, deposit statements, complaints, tenant submissions. Call it first whenever the user asks about a dispute or wants a case summary; quote amounts by their text.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager"],
  async run({ lease, limit }, { engine }) {
    const id = await resolveLeaseId(engine, lease);
    const ix = await engine.get<CaseIndex>(`/api/leases/${id}/case-pack`);
    return {
      leaseRef: ix.lease.ref,
      // Names and contact details stay out of the model's context.
      facts: money(Object.fromEntries(Object.entries(ix.lease).filter(([k]) => k !== "parties"))),
      timeline: ix.events
        .filter((e) => !NOISE.has(e.type))
        .slice(0, limit)
        .map((e) => ({
          on: dubaiDay(e.at),
          type: e.type,
          by: actorKind(e.actor),
          to: e.to,
          rulesVersion: e.rulesVersion,
        })),
      eventsTotal: ix.events.length,
      notices: ix.emails
        .filter((m) => m.purpose === "notice" || m.purpose === "formal_reminder")
        .map((m) => ({
          subject: m.subject,
          status: m.status,
          sentOn: dubaiDay(m.sentAt),
          acknowledgedOn: dubaiDay(m.acknowledgedAt),
        })),
      payments: ix.payments.map(money),
      depositStatements: ix.depositStatements.map(({ items: _items, ...s }) => money(s)),
      complaints: ix.complaints.map((c) => ({ ...c, text: untrusted(c.text), on: dubaiDay(c.createdAt) })),
      tenantSubmissions: ix.tenantSubmissions.map((s) => ({
        ref: s.ref,
        type: s.type,
        on: dubaiDay(s.receivedAt),
        status: s.status,
        details: submission(s.payload),
      })),
    };
  },
};
