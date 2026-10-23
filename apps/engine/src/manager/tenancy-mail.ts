import {
  complaintAckEmail,
  depositStatementEmail,
  formalReminderEmail,
  type MailAttachment,
  moveInEmail,
  moveOutEmail,
  renderPdf,
  rentFriendlyEmail,
  rentReminderEmail,
} from "@leasing/adapters";
import { formatAed, newId } from "@leasing/core";
import {
  approvals,
  complaints,
  depositStatements,
  documents,
  helperRuns,
  leaseParties,
  leases,
  parties,
  payments,
  type Tx,
} from "@leasing/db";
import { formalReminderNotice, templateAck } from "@leasing/helpers";
import { getRulebook } from "@leasing/rulebook";
import { and, eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { getCompanyPolicy } from "./events.ts";
import type { FormalReminderProposal } from "./gate-rules.ts";
import { createLink } from "./links.ts";
import { moveInStatus } from "./move-in.ts";

/**
 * Tenant emails during the tenancy (phase 3), composed for `sendLeaseMail`, which stores the
 * evidence and never sends one twice. Each carries a fresh `tenancy` portal link (reusable,
 * `tenancyLinkDays`); the move-in email also a single-use `move_in_ack` link. Text is fixed,
 * except the complaint acknowledgement, which the Complaint Triage helper wrote and checked.
 */
export type TenancyMailKind =
  | "move_in"
  | "rent_reminder"
  | "rent_friendly"
  | "formal_reminder"
  | "complaint_ack"
  | "move_out"
  | "deposit_statement";

export interface Composed {
  to: string;
  mail: { subject: string; text: string; html: string };
  attachments: MailAttachment[];
  template: string;
}

type LeaseRow = typeof leases.$inferSelect;

export async function tenantOf(tx: Tx, leaseId: string) {
  const [row] = await tx.db
    .select({ party: parties })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(and(eq(leaseParties.leaseId, leaseId), eq(leaseParties.role, "tenant")));
  return row?.party ?? null;
}

async function tenancyLink(ctx: EngineContext, tx: Tx, lease: LeaseRow, partyId: string) {
  const ttlDays = (await getCompanyPolicy(tx, ctx.clock.today())).tenancyLinkDays;
  return createLink(ctx, tx, { purpose: "tenancy", entity: { kind: "lease", id: lease.id }, partyId, ttlDays });
}

const fmtDate = (d: string) =>
  new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Dubai", day: "numeric", month: "long", year: "numeric" }).format(
    new Date(`${d}T08:00:00Z`),
  );

/**
 * Builds one tenancy email, or returns null when it no longer applies (paid meanwhile, approval
 * withdrawn) or can't be sent (`{ noEmail: true }`: the caller raises a task).
 */
export async function composeTenancyMail(
  ctx: EngineContext,
  tx: Tx,
  lease: LeaseRow,
  unitLabel: string,
  kind: TenancyMailKind,
  key: string,
): Promise<Composed | { noEmail: true } | null> {
  const tenant = await tenantOf(tx, lease.id);
  if (!tenant?.email) return { noEmail: true };
  const to = tenant.email;
  const demo = ctx.demoMode;

  if (kind === "move_in") {
    if (lease.state !== "ACTIVE") return null;
    const status = await moveInStatus(ctx, tx, lease.id);
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const ack = await createLink(ctx, tx, {
      purpose: "move_in_ack",
      entity: { kind: "lease", id: lease.id },
      partyId: tenant.id,
      ttlDays: policy.moveInAckDays,
    });
    const tenancy = await tenancyLink(ctx, tx, lease, tenant.id);
    const mail = moveInEmail({
      name: tenant.fullNameEn,
      unitLabel,
      checked: [
        ...(lease.ejariNo ? [`Ejari ${lease.ejariNo}`] : []),
        ...status.items.filter((i) => i.kind === "check" && i.done).map((i) => i.label),
      ],
      rooms: status.items.filter((i) => i.kind === "room").map((i) => i.label),
      ackUrl: ack.url,
      tenancyUrl: tenancy.url,
      ackDays: policy.moveInAckDays,
      demo,
    });
    return { to, mail, attachments: [], template: "move_in" };
  }

  if (kind === "rent_reminder" || kind === "rent_friendly") {
    const [p] = await tx.db.select().from(payments).where(eq(payments.id, key));
    if (!p) return null;
    const stillDue =
      kind === "rent_reminder" ? p.status === "scheduled" : p.status === "overdue" || p.status === "bounced";
    if (!stillDue) return null;
    const of = (await tx.db.select({ id: payments.id }).from(payments).where(eq(payments.leaseId, lease.id))).length;
    const tenancy = await tenancyLink(ctx, tx, lease, tenant.id);
    const common = {
      name: tenant.fullNameEn,
      unitLabel,
      n: p.seq,
      of,
      amount: formatAed(p.amountFils),
      dueOn: fmtDate(p.dueOn),
      demo,
    };
    const mail =
      kind === "rent_reminder"
        ? rentReminderEmail({ ...common, method: p.method, tenancyUrl: tenancy.url })
        : rentFriendlyEmail({ ...common, bounced: p.status === "bounced", replyUrl: `${tenancy.url}/payment/${p.id}` });
    return { to, mail, attachments: [], template: kind };
  }

  if (kind === "formal_reminder") {
    const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, key));
    if (!a || a.gate !== "formal_reminder" || a.status !== "approved") return null;
    if (a.consumedByEventId) return null;
    const proposal = a.proposal as FormalReminderProposal;
    const [p] = await tx.db.select().from(payments).where(eq(payments.id, proposal.paymentId));
    // Paid since approval, or already sent: nothing to send.
    if (!p || (p.status !== "overdue" && p.status !== "bounced") || p.formalReminderSentOn) return null;
    const [landlord] = await tx.db
      .select({ party: parties })
      .from(leaseParties)
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(and(eq(leaseParties.leaseId, lease.id), eq(leaseParties.role, "landlord")));
    const r = getRulebook(lease.rulesVersion);
    const reference = `FR-${lease.ref.replace(/[^A-Za-z0-9]/g, "")}-${p.seq}`;
    const doc = formalReminderNotice({
      reference,
      issuedOn: ctx.clock.today(),
      tenantName: tenant.fullNameEn,
      landlordName: landlord?.party.fullNameEn ?? "The landlord",
      unitLabel,
      leaseRef: lease.ref,
      ejariNo: lease.ejariNo,
      instalment: {
        n: p.seq,
        of: proposal.of,
        dueOn: p.dueOn,
        amountFils: p.amountFils,
        bounced: p.status === "bounced",
      },
      lateRentDays: r.lateRentDaysAfterFormalReminder,
      rulesVersion: lease.rulesVersion,
      demo,
    });
    const pdf = await renderPdf({ title: doc.title, subject: `${lease.ref} ${reference}` }, doc.blocks);
    const stored = await ctx.documents.put(pdf, "pdf");
    await tx.db.insert(documents).values({
      id: newId(),
      partyId: tenant.id,
      leaseId: lease.id,
      paymentId: p.id,
      kind: "formal_reminder",
      sha256: stored.sha256,
      path: stored.path,
      mime: "application/pdf",
      extracted: { reference, approvalId: a.id },
    });
    const tenancy = await tenancyLink(ctx, tx, lease, tenant.id);
    const mail = formalReminderEmail({
      name: tenant.fullNameEn,
      unitLabel,
      amount: formatAed(p.amountFils),
      dueOn: fmtDate(p.dueOn),
      reference,
      lateRentDays: r.lateRentDaysAfterFormalReminder,
      replyUrl: `${tenancy.url}/payment/${p.id}`,
      demo,
    });
    return {
      to,
      mail,
      attachments: [{ filename: `formal-reminder-${reference}.pdf`, content: pdf, contentType: "application/pdf" }],
      template: "formal_reminder",
    };
  }

  if (kind === "move_out") {
    if (lease.state !== "MOVE_OUT") return null;
    const tenancy = await tenancyLink(ctx, tx, lease, tenant.id);
    const mail = moveOutEmail({
      name: tenant.fullNameEn,
      unitLabel,
      moveOutOn: fmtDate(lease.moveOutOn ?? lease.endOn),
      bookUrl: `${tenancy.url}/inspection`,
      demo,
    });
    return { to, mail, attachments: [], template: "move_out" };
  }

  if (kind === "deposit_statement") {
    const [s] = await tx.db.select().from(depositStatements).where(eq(depositStatements.id, key));
    // A statement replaced or answered meanwhile isn't sent.
    if (!s || s.status !== "sent" || lease.state !== "MOVE_OUT" || !s.documentId) return null;
    const [doc] = await tx.db.select().from(documents).where(eq(documents.id, s.documentId));
    if (!doc) return null;
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    const link = await createLink(ctx, tx, {
      purpose: "deposit_response",
      entity: { kind: "lease", id: lease.id },
      partyId: tenant.id,
      ttlDays: policy.depositResponseDays,
    });
    const mail = depositStatementEmail({
      name: tenant.fullNameEn,
      unitLabel,
      revision: s.revision,
      deposit: formatAed(s.depositFils),
      deductions: formatAed(s.deductionsFils),
      refund: formatAed(s.refundFils),
      respondUrl: link.url,
      respondDays: policy.depositResponseDays,
      demo,
    });
    const pdf = new Uint8Array(await ctx.documents.read(doc.path));
    return {
      to,
      mail,
      attachments: [
        { filename: `deposit-statement-${lease.ref}-${s.revision}.pdf`, content: pdf, contentType: "application/pdf" },
      ],
      template: "deposit_statement",
    };
  }

  // complaint_ack: the acknowledgement the Complaint Triage helper wrote and checked (or its fixed fallback).
  const [c] = await tx.db.select().from(complaints).where(eq(complaints.id, key));
  if (!c) return null;
  const [run] = c.helperRunId
    ? await tx.db.select({ output: helperRuns.output }).from(helperRuns).where(eq(helperRuns.id, c.helperRunId))
    : [];
  const ack =
    (run?.output as { data?: { acknowledgement?: string } } | null)?.data?.acknowledgement ??
    templateAck({
      route: c.status === "escalated" ? "escalate" : c.status === "ticketed" ? "ticket" : "review",
      language: c.language === "ar" ? "ar" : "en",
    });
  const tenancy = await tenancyLink(ctx, tx, lease, tenant.id);
  const mail = complaintAckEmail({
    name: tenant.fullNameEn,
    unitLabel,
    reference: c.ref ?? c.id.slice(0, 8),
    body: ack,
    tenancyUrl: tenancy.url,
    demo,
  });
  return { to, mail, attachments: [], template: "complaint_ack" };
}
