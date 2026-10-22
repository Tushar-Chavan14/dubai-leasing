import {
  contractSignedEmail,
  contractSignEmail,
  ejariIssuedEmail,
  type MailAttachment,
  type MailReceipt,
} from "@leasing/adapters";
import { maskPiiText, newId } from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  actionLinks,
  contracts,
  contractSigners,
  documents,
  ejariSubmissions,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { and, eq, isNull } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { appendEvent, getCompanyPolicy } from "./events.ts";
import { createLink } from "./links.ts";
import { createTask } from "./milestones.ts";

/**
 * Lease emails for steps 5–6, sent by a job: the signing link (with the approved PDF), the
 * signed copy, and the Ejari certificate. Each is recorded in `outbound_messages` with its SMTP
 * evidence and attachment hashes; a sent email is never sent twice. Links are created at send
 * time, so their tokens exist only in the email.
 */
export const LEASE_MAIL_JOB = "lease.mail";
export type LeaseMailKind = "sign" | "signed" | "ejari_issued";
export interface LeaseMailJob {
  leaseId: string;
  kind: LeaseMailKind;
  /** Signer id (sign, signed) or Ejari submission id (ejari_issued). */
  key: string;
  seq: number;
}

export async function queueLeaseMail(ctx: EngineContext, tx: Tx, j: LeaseMailJob) {
  await ctx.scheduler.send(tx, {
    name: LEASE_MAIL_JOB,
    data: { ...j },
    singletonKey: `${j.leaseId}:${j.kind}:${j.key}#${j.seq}`,
  });
}

const PURPOSE: Record<LeaseMailKind, "link" | "receipt"> = { sign: "link", signed: "receipt", ejari_issued: "receipt" };

interface Prepared {
  id: string;
  to: string;
  mail: { subject: string; text: string; html: string };
  attachments: MailAttachment[];
}

async function readDoc(ctx: EngineContext, tx: Tx, documentId: string | null) {
  if (!documentId) return null;
  const [doc] = await tx.db.select().from(documents).where(eq(documents.id, documentId));
  return doc ? { bytes: new Uint8Array(await ctx.documents.read(doc.path)), sha256: doc.sha256 } : null;
}

export async function sendLeaseMail(ctx: EngineContext, j: LeaseMailJob) {
  const milestone = `${j.kind}:${j.key}#${j.seq}`;
  const prepared = await withTx(ctx.database, async (tx): Promise<Prepared | null> => {
    const [lease] = await tx.db.select().from(leases).where(eq(leases.id, j.leaseId));
    if (!lease) return null;
    const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
    const unitLabel = unit ? `${unit.unitNo ?? unit.code}, ${unit.building}` : lease.ref;
    const [existing] = await tx.db
      .select()
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.entityId, lease.id),
          eq(outboundMessages.purpose, PURPOSE[j.kind]),
          eq(outboundMessages.milestone, milestone),
        ),
      )
      .for("update");
    if (existing?.status === "sending") {
      await createTask(ctx, tx, lease.id, {
        kind: "email_unclear",
        title: `Email "${existing.subject}" for ${lease.ref} may or may not have been sent: check the sent mail`,
        details: { outboundMessageId: existing.id },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${lease.id}:email_unclear:${existing.id}`,
      });
      return null;
    }
    if (existing && existing.status !== "failed") return null;

    let to: string | null = null;
    let mail: Prepared["mail"];
    const attachments: MailAttachment[] = [];
    const missingEmail = async (who: string) => {
      await createTask(ctx, tx, lease.id, {
        kind: "no_email",
        title: `${who} on ${lease.ref} has no email address: send the ${j.kind === "sign" ? "signing link" : "document"} another way`,
        details: { mail: j.kind, key: j.key },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${lease.id}:no_email:${j.kind}:${j.key}`,
      });
      return null;
    };

    if (j.kind === "sign" || j.kind === "signed") {
      const [s] = await tx.db
        .select({ signer: contractSigners, contract: contracts })
        .from(contractSigners)
        .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
        .where(eq(contractSigners.id, j.key))
        .for("update");
      if (!s) return null;
      const still =
        j.kind === "sign"
          ? s.contract.status === "sent" && !s.signer.signedAt && lease.state === "CONTRACT"
          : s.contract.status === "signed";
      if (!still) return null;
      if (!s.signer.email) return missingEmail(s.signer.role === "tenant" ? "The tenant" : "The landlord");
      to = s.signer.email;
      const doc = await readDoc(ctx, tx, j.kind === "sign" ? s.contract.documentId : s.contract.signedDocumentId);
      if (!doc) return null;
      attachments.push({
        filename: `tenancy-contract-${lease.ref.replace(/[^A-Za-z0-9-]/g, "-")}-v${s.contract.version}${j.kind === "signed" ? "-signed" : ""}.pdf`,
        content: doc.bytes,
        contentType: "application/pdf",
      });
      if (j.kind === "sign") {
        const ttl = (await getCompanyPolicy(tx, ctx.clock.today())).signLinkValidDays;
        // A new link replaces the signer's previous one.
        if (s.signer.linkId) {
          await tx.db
            .update(actionLinks)
            .set({ expiresAt: ctx.clock.now() })
            .where(and(eq(actionLinks.id, s.signer.linkId), isNull(actionLinks.usedAt)));
        }
        const link = await createLink(ctx, tx, {
          purpose: "sign",
          entity: { kind: "lease", id: lease.id },
          partyId: s.signer.partyId,
          ttlDays: ttl,
        });
        await tx.db.update(contractSigners).set({ linkId: link.id }).where(eq(contractSigners.id, s.signer.id));
        mail = contractSignEmail({
          signerName: s.signer.nameEn,
          role: s.signer.role,
          unitLabel,
          leaseRef: lease.ref,
          version: s.contract.version,
          signUrl: link.url,
          validDays: ttl,
          demo: ctx.demoMode,
        });
      } else {
        mail = contractSignedEmail({ name: s.signer.nameEn, unitLabel, leaseRef: lease.ref, demo: ctx.demoMode });
      }
    } else {
      const [sub] = await tx.db.select().from(ejariSubmissions).where(eq(ejariSubmissions.id, j.key));
      if (sub?.status !== "issued" || !sub.ejariNo) return null;
      const [tenant] = await tx.db
        .select({ party: parties })
        .from(leaseParties)
        .innerJoin(parties, eq(parties.id, leaseParties.partyId))
        .where(and(eq(leaseParties.leaseId, lease.id), eq(leaseParties.role, "tenant")));
      if (!tenant?.party.email) return missingEmail("The tenant");
      to = tenant.party.email;
      const doc = await readDoc(ctx, tx, sub.certificateDocumentId);
      if (doc) {
        attachments.push({
          filename: `ejari-${ctx.demoMode ? "simulated-" : ""}${sub.ejariNo}.pdf`,
          content: doc.bytes,
          contentType: "application/pdf",
        });
      }
      mail = ejariIssuedEmail({ name: tenant.party.fullNameEn, unitLabel, ejariNo: sub.ejariNo, demo: ctx.demoMode });
    }

    const id = existing?.id ?? newId();
    if (existing) {
      await tx.db.update(outboundMessages).set({ status: "sending", error: null }).where(eq(outboundMessages.id, id));
    } else {
      await tx.db.insert(outboundMessages).values({
        id,
        entityKind: "lease",
        entityId: lease.id,
        purpose: PURPOSE[j.kind],
        milestone,
        to,
        intendedTo: to,
        template: j.kind === "sign" ? "contract_sign" : j.kind === "signed" ? "contract_signed" : "ejari_issued",
        subject: mail.subject,
        status: "sending",
        createdAt: ctx.clock.now(),
      });
    }
    if (j.kind === "sign") {
      await tx.db.update(contractSigners).set({ outboundMessageId: id }).where(eq(contractSigners.id, j.key));
    }
    return { id, to, mail, attachments };
  });
  if (!prepared) return { sent: false };

  let receipt: MailReceipt;
  try {
    receipt = await ctx.mailer.send({ to: prepared.to, ...prepared.mail, attachments: prepared.attachments });
  } catch (e) {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error })
      .where(eq(outboundMessages.id, prepared.id));
    throw new Error(`lease email failed: ${error}`, { cause: e });
  }
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
        attachmentSha256s: prepared.attachments.map((a) => sha256Hex(a.content)),
        sentAt: ok ? ctx.clock.now() : null,
        error: ok ? null : maskPiiText(`recipient not accepted: ${receipt.response}`),
      })
      .where(eq(outboundMessages.id, prepared.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: j.leaseId },
      type: ok ? "EMAIL_SENT" : "EMAIL_FAILED",
      actor: "system",
      payload: { outboundMessageId: prepared.id, kind: j.kind, key: j.key, seq: j.seq, messageId: receipt.messageId },
    });
  });
  return { sent: ok, outboundMessageId: prepared.id };
}
