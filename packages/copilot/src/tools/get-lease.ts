import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";
import { aed, dubaiDay, fetchLease, LeaseArg, milestoneName, Money, taskDetails } from "./shared.ts";

const Input = z.object({ lease: LeaseArg });
const Output = z.object({
  leaseId: z.string(),
  leaseRef: z.string(),
  state: z.string(),
  unit: z.object({ code: z.string(), building: z.string(), community: z.string(), bedrooms: z.number().nullable() }),
  tenant: z.string().nullable(),
  landlord: z.string().nullable(),
  term: z.object({ startOn: z.string(), endOn: z.string() }),
  annualRent: Money,
  cheques: z.number(),
  deposit: Money,
  ejariNo: z.string().nullable(),
  rulesVersion: z.string(),
  pendingDeadlines: z.array(z.object({ milestone: z.string(), dueOn: z.string() })),
  approvals: z.array(
    z.object({
      approvalId: z.string(),
      title: z.string(),
      gate: z.string(),
      status: z.string(),
      decidedBy: z.string().describe("Role that decides it, in the Approvals inbox"),
      proposedRent: Money.nullable(),
    }),
  ),
  openTasks: z.array(
    z.object({
      title: z.string(),
      kind: z.string(),
      assigneeRole: z.string(),
      dueOn: z.string().nullable(),
      details: z.record(z.string(), z.unknown()),
    }),
  ),
  renewalNotice: z
    .object({ status: z.string(), sentOn: z.string().nullable(), acknowledgedOn: z.string().nullable() })
    .nullable(),
  tenantReplies: z.array(
    z.object({
      ref: z.string(),
      type: z.string(),
      choice: z.string().nullable(),
      comment: z.string().nullable(),
      status: z.string(),
      receivedOn: z.string().nullable(),
    }),
  ),
});

export const getLease: CopilotTool<typeof Input, typeof Output> = {
  name: "get_lease",
  kind: "read",
  description:
    "Current state of one lease: term, rent, parties, pending deadlines, approvals, open tasks, renewal notice status and tenant replies. Use it to explain why a lease is waiting or what is next.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ lease }, { engine }) {
    const l = await fetchLease(engine, lease);
    const notice = l.outbound.find((o) => o.purpose === "notice");
    return {
      leaseId: l.id,
      leaseRef: l.ref,
      state: l.state,
      unit: { code: l.unit.code, building: l.unit.building, community: l.unit.community, bedrooms: l.unit.bedrooms },
      tenant: l.parties.find((p) => p.role === "tenant")?.fullNameEn ?? null,
      landlord: l.parties.find((p) => p.role === "landlord")?.fullNameEn ?? null,
      term: { startOn: l.startOn, endOn: l.endOn },
      annualRent: aed(l.annualRentFils),
      cheques: l.cheques,
      deposit: aed(l.depositFils),
      ejariNo: l.ejariNo,
      rulesVersion: l.rulesVersion,
      pendingDeadlines: l.deadlines
        .filter((d) => d.status === "pending")
        .slice(0, 6)
        .map((d) => ({ milestone: milestoneName(d.milestone), dueOn: d.dueOn })),
      approvals: l.approvals.slice(0, 6).map((a) => {
        const p = a.editedProposal ?? a.proposal;
        return {
          approvalId: a.id,
          title: a.title,
          gate: a.gate,
          status: a.status,
          decidedBy: a.approverRole,
          proposedRent: typeof p.proposedRentFils === "number" ? aed(p.proposedRentFils) : null,
        };
      }),
      openTasks: l.tasks
        .filter((t) => t.status === "open")
        .slice(0, 8)
        .map((t) => ({
          title: t.title,
          kind: t.kind,
          assigneeRole: t.assigneeRole,
          dueOn: t.dueOn,
          details: taskDetails(t.details),
        })),
      renewalNotice: notice
        ? { status: notice.status, sentOn: dubaiDay(notice.sentAt), acknowledgedOn: dubaiDay(notice.acknowledgedAt) }
        : null,
      tenantReplies: l.inbound.slice(0, 4).map((e) => ({
        ref: e.ref,
        type: e.type,
        choice: e.payload.choice ?? null,
        comment: e.payload.comment ? untrusted(e.payload.comment) : null,
        status: e.status,
        receivedOn: dubaiDay(e.receivedAt),
      })),
    };
  },
};
