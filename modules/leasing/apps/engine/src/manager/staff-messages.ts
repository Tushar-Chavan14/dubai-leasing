import { applicantMessageEmail, staffMessageEmail } from "@leasing/adapters";
import { CASE_PACK_ROLES } from "./case-pack.ts";
import { maskPiiText, newId, type StaffRole, type StaffUser } from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  approvalNotes,
  applications,
  approvals,
  copilotDrafts,
  copilotThreads,
  leases,
  outboundMessages,
  parties,
  units,
  withTx,
} from "@leasing/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, forbidden, notFound, unprocessable } from "../errors.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { createLink } from "./links.ts";
import { tenantOf } from "./tenancy-mail.ts";

/**
 * Text people write (phase 3, D26): an email to the tenant, sent by a member of staff through the
 * mail adapter with the usual evidence, and notes on an approval for its approver. A copilot draft
 * can prefill either; only the person's own click sends or posts it.
 */
export const EMAIL_ROLES: StaffRole[] = ["leasing_officer", "leasing_manager", "finance"];

/** Applications still in progress; a closed, rejected or withdrawn one gets no staff email. */
const OPEN_APPLICATION_STATES: string[] = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"];

export const StaffEmail = z.object({
  subject: z.string().trim().min(3).max(160),
  body: z.string().trim().min(10).max(5000),
  /** The copilot draft this came from, if any (marked used). */
  draftId: z.uuid().optional(),
});

export async function sendStaffEmail(ctx: EngineContext, user: StaffUser, leaseId: string, raw: unknown) {
  if (!EMAIL_ROLES.includes(user.role)) throw forbidden(`${user.role} can't email tenants`);
  const input = StaffEmail.parse(raw);
  const prepared = await withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select({ lease: leases, unit: units })
      .from(leases)
      .innerJoin(units, eq(units.id, leases.unitId))
      .where(eq(leases.id, leaseId));
    if (!row) throw notFound("lease");
    const tenant = await tenantOf(tx, leaseId);
    if (!tenant?.email) throw unprocessable("the tenant has no email address on file", [], "no_email");
    if (input.draftId) await claimDraft(tx, input.draftId, user, { leaseId });
    const ttlDays = (await getCompanyPolicy(tx, ctx.clock.today())).tenancyLinkDays;
    const link = await createLink(ctx, tx, {
      purpose: "tenancy",
      entity: { kind: "lease", id: leaseId },
      partyId: tenant.id,
      ttlDays,
    });
    const mail = staffMessageEmail({
      name: tenant.fullNameEn,
      subject: input.subject,
      body: input.body,
      tenancyUrl: link.url,
      demo: ctx.demoMode,
    });
    const id = newId();
    await tx.db.insert(outboundMessages).values({
      id,
      entityKind: "lease",
      entityId: leaseId,
      purpose: "link",
      milestone: `staff:${id}`,
      to: tenant.email,
      intendedTo: tenant.email,
      template: "staff_message",
      subject: mail.subject,
      status: "sending",
      createdAt: ctx.clock.now(),
    });
    return { id, to: tenant.email, mail };
  });
  const receipt = await ctx.mailer.send({ to: prepared.to, ...prepared.mail }).catch(async (e: unknown) => {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error })
      .where(eq(outboundMessages.id, prepared.id));
    await settleDraft(ctx, input.draftId, "draft");
    throw new Error(`the email could not be sent: ${error}`);
  });
  const ok = receipt.accepted.some((a) => a.trim().toLowerCase() === receipt.deliveredTo.trim().toLowerCase());
  await withTx(ctx.database, async (tx) => {
    await tx.db
      .update(outboundMessages)
      .set({
        status: ok ? "sent" : "failed",
        to: receipt.deliveredTo,
        messageId: receipt.messageId,
        smtpResponse: receipt.response,
        previewUrl: receipt.previewUrl ?? null,
        bodySha256: sha256Hex(`${prepared.mail.text}\n${prepared.mail.html}`),
        attachmentSha256s: [],
        sentAt: ok ? ctx.clock.now() : null,
        error: ok ? null : maskPiiText(`recipient not accepted: ${receipt.response}`),
      })
      .where(eq(outboundMessages.id, prepared.id));
    // The draft counts as used only once the email is accepted; a failed send leaves it to retry.
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: ok ? "STAFF_EMAIL_SENT" : "EMAIL_FAILED",
      actor: `user:${user.id}`,
      payload: { outboundMessageId: prepared.id, subject: input.subject, fromDraft: input.draftId ?? null },
    });
  });
  await settleDraft(ctx, input.draftId, ok ? "used" : "draft");
  if (!ok) throw unprocessable("the mail server didn't accept the recipient", [receipt.response], "not_accepted");
  return { outboundMessageId: prepared.id, sent: true };
}

/**
 * An email from staff to an applicant (D42), the way `sendStaffEmail` writes to a tenant: through the
 * mail adapter with the usual evidence. A copilot draft can prefill it; only this person's click sends.
 */
export async function sendApplicantEmail(ctx: EngineContext, user: StaffUser, applicationId: string, raw: unknown) {
  if (!EMAIL_ROLES.includes(user.role)) throw forbidden(`${user.role} can't email applicants`);
  const input = StaffEmail.parse(raw);
  const prepared = await withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .select({ app: applications, party: parties })
      .from(applications)
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(eq(applications.id, applicationId));
    if (!row) throw notFound("application");
    if (!OPEN_APPLICATION_STATES.includes(row.app.state))
      throw conflict(
        `application ${row.app.ref} is ${row.app.state}: emails to closed applications are not sent from here`,
        "application_closed",
      );
    if (!row.party.email) throw unprocessable("the applicant has no email address on file", [], "no_email");
    if (input.draftId) await claimDraft(tx, input.draftId, user, { applicationId });
    const mail = applicantMessageEmail({
      name: row.party.fullNameEn,
      subject: input.subject,
      body: input.body,
      demo: ctx.demoMode,
    });
    const id = newId();
    await tx.db.insert(outboundMessages).values({
      id,
      entityKind: "application",
      entityId: applicationId,
      purpose: "link",
      milestone: `staff:${id}`,
      to: row.party.email,
      intendedTo: row.party.email,
      template: "staff_message_applicant",
      subject: mail.subject,
      status: "sending",
      createdAt: ctx.clock.now(),
    });
    return { id, to: row.party.email, mail };
  });
  const receipt = await ctx.mailer.send({ to: prepared.to, ...prepared.mail }).catch(async (e: unknown) => {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error })
      .where(eq(outboundMessages.id, prepared.id));
    await settleDraft(ctx, input.draftId, "draft");
    throw new Error(`the email could not be sent: ${error}`);
  });
  const ok = receipt.accepted.some((a) => a.trim().toLowerCase() === receipt.deliveredTo.trim().toLowerCase());
  await withTx(ctx.database, async (tx) => {
    await tx.db
      .update(outboundMessages)
      .set({
        status: ok ? "sent" : "failed",
        to: receipt.deliveredTo,
        messageId: receipt.messageId,
        smtpResponse: receipt.response,
        previewUrl: receipt.previewUrl ?? null,
        bodySha256: sha256Hex(`${prepared.mail.text}\n${prepared.mail.html}`),
        attachmentSha256s: [],
        sentAt: ok ? ctx.clock.now() : null,
        error: ok ? null : maskPiiText(`recipient not accepted: ${receipt.response}`),
      })
      .where(eq(outboundMessages.id, prepared.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: applicationId },
      type: ok ? "STAFF_EMAIL_SENT" : "EMAIL_FAILED",
      actor: `user:${user.id}`,
      payload: { outboundMessageId: prepared.id, subject: input.subject, fromDraft: input.draftId ?? null },
    });
  });
  await settleDraft(ctx, input.draftId, ok ? "used" : "draft");
  if (!ok) throw unprocessable("the mail server didn't accept the recipient", [receipt.response], "not_accepted");
  return { outboundMessageId: prepared.id, sent: true };
}

type DraftTarget = { leaseId: string } | { approvalId: string } | { applicationId: string };

/** A draft can be used once, by the person whose copilot wrote it, for the lease or approval it was written for. */
async function checkDraft(
  tx: Parameters<Parameters<typeof withTx>[1]>[0],
  draftId: string,
  user: StaffUser,
  kind: "email" | "approval_note",
  target: DraftTarget,
) {
  const [d] = await tx.db.select().from(copilotDrafts).where(eq(copilotDrafts.id, draftId)).for("update");
  if (!d || d.userId !== user.id || d.kind !== kind) throw notFound("draft");
  const matches =
    "leaseId" in target
      ? d.leaseId === target.leaseId
      : "applicationId" in target
        ? d.applicationId === target.applicationId
        : d.approvalId === target.approvalId;
  if (!matches) throw unprocessable("this draft was written for a different record", [], "draft_mismatch");
  if (d.status !== "draft") throw conflict(`the draft was already ${d.status}`, "draft_used");
  return d;
}

async function useDraft(
  tx: Parameters<Parameters<typeof withTx>[1]>[0],
  draftId: string,
  user: StaffUser,
  kind: "email" | "approval_note",
  target: DraftTarget,
) {
  const d = await checkDraft(tx, draftId, user, kind, target);
  await tx.db.update(copilotDrafts).set({ status: "used" }).where(eq(copilotDrafts.id, d.id));
}

/** Takes a draft for sending (status `sending`), so a second click or tab can't send it too. */
async function claimDraft(
  tx: Parameters<Parameters<typeof withTx>[1]>[0],
  draftId: string,
  user: StaffUser,
  target: DraftTarget,
) {
  const d = await checkDraft(tx, draftId, user, "email", target);
  await tx.db.update(copilotDrafts).set({ status: "sending" }).where(eq(copilotDrafts.id, d.id));
}

async function settleDraft(ctx: EngineContext, draftId: string | undefined, status: "used" | "draft") {
  if (!draftId) return;
  await ctx.database.db
    .update(copilotDrafts)
    .set({ status })
    .where(and(eq(copilotDrafts.id, draftId), eq(copilotDrafts.status, "sending")));
}

export const ApprovalNote = z.object({ body: z.string().trim().min(2).max(2000), draftId: z.uuid().optional() });

/** Any staff member who can see the approval adds a note for its approver. */
export async function addApprovalNote(ctx: EngineContext, user: StaffUser, approvalId: string, raw: unknown) {
  const input = ApprovalNote.parse(raw);
  return withTx(ctx.database, async (tx) => {
    const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, approvalId));
    if (!a) throw notFound("approval");
    if (input.draftId) await useDraft(tx, input.draftId, user, "approval_note", { approvalId });
    const id = newId();
    await tx.db
      .insert(approvalNotes)
      .values({ id, approvalId, author: `user:${user.id}`, body: input.body, createdAt: ctx.clock.now() });
    await appendEvent(tx, ctx, {
      entity: { kind: a.entityKind, id: a.entityId },
      type: "APPROVAL_NOTE_ADDED",
      actor: `user:${user.id}`,
      payload: { approvalId, noteId: id, fromDraft: input.draftId ?? null },
    });
    return { id };
  });
}

export async function approvalNotesFor(ctx: EngineContext, approvalId: string) {
  return ctx.database.db
    .select()
    .from(approvalNotes)
    .where(eq(approvalNotes.approvalId, approvalId))
    .orderBy(asc(approvalNotes.createdAt));
}

/** The user's own draft, to prefill a form. */
export async function getOwnDraft(ctx: EngineContext, user: StaffUser, draftId: string) {
  const [d] = await ctx.database.db
    .select()
    .from(copilotDrafts)
    .where(and(eq(copilotDrafts.id, draftId), eq(copilotDrafts.userId, user.id)));
  return d ?? null;
}

// ---------------------------------------------------------------- copilot drafts (D26)

export const DraftInput = z.discriminatedUnion("kind", [
  // To a tenant (`leaseId`) or to an applicant (`applicationId`): exactly one.
  z.object({
    kind: z.literal("email"),
    leaseId: z.uuid().optional(),
    applicationId: z.uuid().optional(),
    subject: z.string().trim().min(3).max(160),
    body: z.string().trim().min(10).max(5000),
  }),
  z.object({ kind: z.literal("approval_note"), approvalId: z.uuid(), body: z.string().trim().min(2).max(2000) }),
  // An RDC case summary (step 11): saved for the user to review; nothing is filed or sent.
  z.object({
    kind: z.literal("case_summary"),
    leaseId: z.uuid(),
    subject: z.string().trim().min(3).max(160),
    body: z.string().trim().min(100).max(8000),
  }),
]);

export function draftView(
  d: typeof copilotDrafts.$inferSelect,
  leaseRef: string | null,
  applicationRef: string | null = null,
) {
  return {
    id: d.id,
    kind: d.kind,
    leaseId: d.leaseId,
    leaseRef,
    applicationId: d.applicationId,
    applicationRef,
    approvalId: d.approvalId,
    subject: d.subject,
    body: d.body,
    status: d.status,
    createdAt: d.createdAt.toISOString(),
  };
}

/**
 * Saves text the copilot drafted, in the user's own thread. Nothing is sent or posted: the user
 * opens it in the normal form, edits it and sends it themselves (D26).
 */
export async function createDraft(ctx: EngineContext, user: StaffUser, threadId: string, raw: unknown) {
  const input = DraftInput.parse(raw);
  if (input.kind === "email" && Boolean(input.leaseId) === Boolean(input.applicationId))
    throw unprocessable("give a leaseId or an applicationId, not both", [], "bad_target");
  if (input.kind === "case_summary" && !input.leaseId)
    throw unprocessable("a case summary needs a lease", [], "bad_target");
  if (input.kind === "email" && !EMAIL_ROLES.includes(user.role)) throw forbidden(`${user.role} can't email tenants`);
  if (input.kind === "case_summary" && !CASE_PACK_ROLES.includes(user.role))
    throw forbidden(`${user.role} can't prepare a case summary`);
  return withTx(ctx.database, async (tx) => {
    const [thread] = await tx.db
      .select({ id: copilotThreads.id })
      .from(copilotThreads)
      .where(and(eq(copilotThreads.id, threadId), eq(copilotThreads.userId, user.id)));
    if (!thread) throw notFound("conversation");
    let leaseRef: string | null = null;
    let applicationRef: string | null = null;
    if (input.kind === "email" && input.applicationId) {
      const [app] = await tx.db
        .select({ ref: applications.ref })
        .from(applications)
        .where(eq(applications.id, input.applicationId));
      if (!app) throw notFound("application");
      applicationRef = app.ref;
    } else if (input.kind === "email" || input.kind === "case_summary") {
      const [lease] = await tx.db.select({ ref: leases.ref }).from(leases).where(eq(leases.id, input.leaseId!));
      if (!lease) throw notFound("lease");
      leaseRef = lease.ref;
    } else {
      const [a] = await tx.db.select({ id: approvals.id }).from(approvals).where(eq(approvals.id, input.approvalId));
      if (!a) throw notFound("approval");
    }
    const [row] = await tx.db
      .insert(copilotDrafts)
      .values({
        id: newId(),
        threadId,
        userId: user.id,
        kind: input.kind,
        leaseId: input.kind === "approval_note" ? null : (input.leaseId ?? null),
        applicationId: input.kind === "email" ? (input.applicationId ?? null) : null,
        approvalId: input.kind === "approval_note" ? input.approvalId : null,
        subject: input.kind === "approval_note" ? null : input.subject,
        body: input.body,
        createdAt: ctx.clock.now(),
      })
      .returning();
    return draftView(row!, leaseRef, applicationRef);
  });
}

export async function threadDrafts(ctx: EngineContext, threadId: string) {
  const rows = await ctx.database.db
    .select({ d: copilotDrafts, leaseRef: leases.ref, applicationRef: applications.ref })
    .from(copilotDrafts)
    .leftJoin(leases, eq(leases.id, copilotDrafts.leaseId))
    .leftJoin(applications, eq(applications.id, copilotDrafts.applicationId))
    .where(eq(copilotDrafts.threadId, threadId))
    .orderBy(asc(copilotDrafts.createdAt));
  return rows.map((r) => draftView(r.d, r.leaseRef, r.applicationRef));
}
