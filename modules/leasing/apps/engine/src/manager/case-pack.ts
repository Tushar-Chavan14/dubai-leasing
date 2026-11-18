import { renderPdf, type PdfBlock } from "@leasing/adapters";
import { formatAed, maskPii, maskPiiText, type StaffRole, type StaffUser } from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  approvals,
  complaints,
  depositStatements,
  documents,
  inboundEvents,
  leaseEvents,
  leaseParties,
  leases,
  maintenanceTickets,
  outboundMessages,
  parties,
  payments,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import { zipSync } from "fflate";
import { and, asc, eq, inArray, or } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { forbidden, notFound } from "../errors.ts";
import { appendEvent } from "./events.ts";

/**
 * Dispute case pack (step 11, person-led). Everything recorded about a lease, in order, for the
 * RDC: every event with its rules version, the generated documents, condition photos, emails with
 * their delivery evidence, the tenant's submissions, payments, complaints and deposit statements.
 * ID document images stay out (only their hashes); tenant text is masked and marked untrusted.
 * Each export is recorded on the lease with the pack's hash.
 */
export const CASE_PACK_ROLES: StaffRole[] = ["leasing_officer", "leasing_manager"];

const GENERATED = [
  "renewal_notice",
  "contract",
  "contract_signed",
  "ejari_certificate",
  "formal_reminder",
  "deposit_statement",
];
const PHOTOS = ["condition_photo", "tenant_condition_photo", "move_out_photo", "issue_photo"];
/** Bank slips and transfer screens can show account numbers: listed by hash, never put in the zip. */
const PROOFS = ["payment_proof"];

/** Emails as `a***@domain`; plus Emirates ID, passport, phone and IBAN masking for free text. */
const maskEmail = (e: string) => e.replace(/([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@/g, "$1***@");
const maskText = (t: string | null) => (t === null ? null : maskEmail(maskPiiText(t)));
const maskDeep = <T>(v: T): T => JSON.parse(maskEmail(JSON.stringify(maskPii(v)))) as T;

/** Dubai date and time, as the dispute is argued in calendar days in Asia/Dubai. */
const dubaiTime = (iso: string) =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
const ID_DOCS = ["emirates_id", "passport", "visa", "trade_licence"];

const iso = (d: Date | null | undefined) => d?.toISOString() ?? null;

export function assertCasePackRole(user: StaffUser) {
  if (!CASE_PACK_ROLES.includes(user.role)) throw forbidden("only leasing staff export a case pack");
}

/** The structured index: what the zip's index.json holds and what the copilot reads. */
export async function caseIndex(ctx: EngineContext, tx: Tx, leaseId: string) {
  const [lease] = await tx.db.select().from(leases).where(eq(leases.id, leaseId));
  if (!lease) throw notFound("lease");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  const people = await tx.db
    .select({ role: leaseParties.role, name: parties.fullNameEn, email: parties.email })
    .from(leaseParties)
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(eq(leaseParties.leaseId, leaseId));
  // The lease's own events and its application's (viewing, checks, offer), oldest first, uncapped.
  const subjects = [leaseId, ...(lease.applicationId ? [lease.applicationId] : [])];
  const events = await tx.db
    .select()
    .from(leaseEvents)
    .where(inArray(leaseEvents.entityId, subjects))
    .orderBy(asc(leaseEvents.at), asc(leaseEvents.id));
  const docs = await tx.db
    .select()
    .from(documents)
    .where(
      or(
        eq(documents.leaseId, leaseId),
        lease.applicationId ? eq(documents.applicationId, lease.applicationId) : undefined,
      ),
    )
    .orderBy(asc(documents.createdAt));
  const mail = await tx.db
    .select()
    .from(outboundMessages)
    .where(eq(outboundMessages.entityId, leaseId))
    .orderBy(asc(outboundMessages.createdAt));
  const inbound = await tx.db
    .select()
    .from(inboundEvents)
    .where(eq(inboundEvents.entityId, leaseId))
    .orderBy(asc(inboundEvents.receivedAt));
  const pays = await tx.db.select().from(payments).where(eq(payments.leaseId, leaseId)).orderBy(asc(payments.seq));
  const comps = await tx.db
    .select({ c: complaints, t: maintenanceTickets })
    .from(complaints)
    .leftJoin(maintenanceTickets, eq(maintenanceTickets.complaintId, complaints.id))
    .where(eq(complaints.leaseId, leaseId))
    .orderBy(asc(complaints.createdAt));
  const statements = await tx.db
    .select({ s: depositStatements, a: approvals })
    .from(depositStatements)
    .leftJoin(approvals, eq(approvals.id, depositStatements.approvalId))
    .where(eq(depositStatements.leaseId, leaseId))
    .orderBy(asc(depositStatements.revision));

  return {
    generatedAt: ctx.clock.now().toISOString(),
    demo: ctx.demoMode,
    lease: {
      ref: lease.ref,
      state: lease.state,
      unit: unit ? `${unit.unitNo ?? unit.code}, ${unit.building}, ${unit.community}` : null,
      startOn: lease.startOn,
      endOn: lease.endOn,
      moveOutOn: lease.moveOutOn,
      annualRentFils: lease.annualRentFils,
      cheques: lease.cheques,
      depositFils: lease.depositFils,
      rulesVersion: lease.rulesVersion,
      ejariNo: lease.ejariNo,
      ejariIssuedOn: lease.ejariIssuedOn,
      ejariCancelledOn: lease.ejariCancelledOn,
      depositSettledOn: lease.depositSettledOn,
      parties: people.map((p) => ({ role: p.role, name: p.name, email: p.email ? maskEmail(p.email) : null })),
    },
    events: events.map((e) => ({
      at: e.at.toISOString(),
      entity: e.entityKind,
      type: e.type,
      actor: e.actor,
      from: e.fromState,
      to: e.toState,
      rulesVersion: e.rulesVersion,
      payload: maskDeep(e.payload),
    })),
    documents: docs
      .filter((d) => GENERATED.includes(d.kind))
      .map((d) => ({ id: d.id, kind: d.kind, createdAt: iso(d.createdAt), sha256: d.sha256 })),
    photos: docs
      .filter((d) => PHOTOS.includes(d.kind) && d.status !== "rejected")
      .map((d) => ({
        id: d.id,
        kind: d.kind,
        room: d.room,
        uploadedBy: d.uploadedBy,
        createdAt: iso(d.createdAt),
        sha256: d.sha256,
      })),
    paymentProofs: docs
      .filter((d) => PROOFS.includes(d.kind) && d.status !== "rejected")
      .map((d) => ({ createdAt: iso(d.createdAt), sha256: d.sha256 })),
    // ID images stay out of the pack: hashes and check status only.
    idDocuments: docs
      .filter((d) => ID_DOCS.includes(d.kind))
      .map((d) => ({ kind: d.kind, side: d.side, status: d.status, verifiedAt: iso(d.verifiedAt), sha256: d.sha256 })),
    emails: mail.map((m) => ({
      purpose: m.purpose,
      template: m.template,
      subject: maskText(m.subject),
      to: maskEmail(m.intendedTo),
      status: m.status,
      sentAt: iso(m.sentAt),
      messageId: m.messageId,
      smtpResponse: maskText(m.smtpResponse),
      bodySha256: m.bodySha256,
      attachmentSha256s: m.attachmentSha256s,
      acknowledgedAt: iso(m.acknowledgedAt),
    })),
    // Tenant-written text is evidence, not instructions; identifiers in it are masked.
    tenantSubmissions: inbound.map((i) => ({
      ref: i.ref,
      type: i.type,
      channel: i.channel,
      receivedAt: i.receivedAt.toISOString(),
      status: i.status,
      untrusted: true,
      payload: maskDeep(i.payload),
    })),
    payments: pays.map((p) => ({
      seq: p.seq,
      dueOn: p.dueOn,
      amountFils: p.amountFils,
      method: p.method,
      status: p.status,
      paidOn: p.paidOn,
      bouncedOn: p.bouncedOn,
      formalReminderSentOn: p.formalReminderSentOn,
      evictionEligibleOn: p.evictionEligibleOn,
    })),
    complaints: comps.map(({ c, t }) => ({
      ref: c.ref,
      createdAt: c.createdAt.toISOString(),
      category: c.category,
      status: c.status,
      untrusted: true,
      text: maskText(c.text),
      ticket: t ? { ref: t.ref, status: t.status, dueBy: t.dueBy.toISOString(), closedAt: iso(t.closedAt) } : null,
    })),
    depositStatements: statements.map(({ s, a }) => ({
      revision: s.revision,
      status: s.status,
      depositFils: s.depositFils,
      deductionsFils: s.deductionsFils,
      refundFils: s.refundFils,
      owedFils: s.owedFils,
      items: maskDeep(s.items),
      paidOn: s.paidOn,
      refundApproval: a ? { status: a.status, decidedAt: iso(a.decidedAt) } : null,
    })),
  };
}

export type CaseIndex = Awaited<ReturnType<typeof caseIndex>>;

/** The index as read on screen or by the copilot; each read is recorded like a document view. */
export async function viewCaseIndex(ctx: EngineContext, leaseId: string, user: StaffUser) {
  assertCasePackRole(user);
  return withTx(ctx.database, async (tx) => {
    const ix = await caseIndex(ctx, tx, leaseId);
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "CASE_PACK_VIEWED",
      actor: `user:${user.id}`,
      payload: { events: ix.events.length },
      rulesVersion: ix.lease.rulesVersion,
    });
    return ix;
  });
}

function timelineBlocks(ix: CaseIndex): PdfBlock[] {
  const l = ix.lease;
  return [
    { kind: "title", text: `Case pack: lease ${l.ref}` },
    {
      kind: "meta",
      rows: [
        ["Property", l.unit ?? "—"],
        ["Term", `${l.startOn} to ${l.endOn}`],
        ["Annual rent", formatAed(l.annualRentFils)],
        ["Deposit", formatAed(l.depositFils)],
        ["Ejari", l.ejariNo ?? "—"],
        ["Rules version", l.rulesVersion],
        ["Generated", ix.generatedAt],
      ],
    },
    { kind: "heading", text: `Timeline (${ix.events.length} events)` },
    {
      kind: "list",
      items: ix.events.map(
        (e) =>
          `${dubaiTime(e.at)} (Dubai) · ${e.type}${e.from || e.to ? ` (${e.from ?? "—"} → ${e.to ?? "—"})` : ""} · ${e.actor}${e.rulesVersion ? ` · ${e.rulesVersion}` : ""}`,
      ),
    },
    { kind: "heading", text: "Emails sent" },
    {
      kind: "list",
      items: ix.emails.length
        ? ix.emails.map(
            (m) =>
              `${m.sentAt ? dubaiTime(m.sentAt) : "not sent"} · ${m.subject} · ${m.status}${m.acknowledgedAt ? ` · acknowledged ${dubaiTime(m.acknowledgedAt)}` : ""}`,
          )
        : ["None"],
    },
    {
      kind: "small",
      text: "Tenant-written text appears in index.json, masked and marked untrusted. ID document images are not included; their hashes are listed in index.json. File hashes are in manifest.json.",
    },
    ...(ix.demo ? [{ kind: "small" as const, text: "DEMO: fictional data." }] : []),
  ];
}

const extOf = (mime: string | null, path: string) =>
  mime === "application/pdf"
    ? "pdf"
    : mime === "image/png"
      ? "png"
      : mime === "image/webp"
        ? "webp"
        : (path.split(".").pop() ?? "bin");

/** Builds the zip and records the export. Files are read from the content-addressed stores. */
export async function buildCasePack(ctx: EngineContext, leaseId: string, user: StaffUser) {
  assertCasePackRole(user);
  const { ix, files } = await withTx(ctx.database, async (tx) => {
    const ix = await caseIndex(ctx, tx, leaseId);
    const rows = await tx.db
      .select({
        id: documents.id,
        kind: documents.kind,
        path: documents.path,
        mime: documents.mime,
        room: documents.room,
      })
      .from(documents)
      .where(and(eq(documents.leaseId, leaseId), inArray(documents.kind, [...GENERATED, ...PHOTOS])));
    return { ix, files: rows };
  });
  const out: Record<string, Uint8Array> = {};
  const keep = new Set([...ix.documents.map((d) => d.id), ...ix.photos.map((p) => p.id)]);
  for (const f of files) {
    if (!keep.has(f.id)) continue;
    const generated = GENERATED.includes(f.kind);
    const store = generated ? ctx.documents : ctx.uploads;
    const bytes = await store.read(f.path).catch(() => null);
    if (!bytes) continue;
    const room = f.room ? `-${f.room.replace(/[^A-Za-z0-9]+/g, "-")}` : "";
    out[`${generated ? "documents" : "photos"}/${f.kind}${room}-${f.id.slice(-8)}.${extOf(f.mime, f.path)}`] =
      new Uint8Array(bytes);
  }
  const enc = new TextEncoder();
  out["timeline.pdf"] = await renderPdf(
    { title: `Case pack ${ix.lease.ref}`, subject: ix.lease.ref },
    timelineBlocks(ix),
  );
  out["index.json"] = enc.encode(JSON.stringify(ix, null, 2));
  out["manifest.json"] = enc.encode(
    JSON.stringify(Object.fromEntries(Object.entries(out).map(([name, bytes]) => [name, sha256Hex(bytes)])), null, 2),
  );
  const zip = zipSync(out, { level: 6, mtime: new Date(ix.generatedAt) });
  const sha256 = sha256Hex(zip);
  await withTx(ctx.database, (tx) =>
    appendEvent(tx, ctx, {
      entity: { kind: "lease", id: leaseId },
      type: "CASE_PACK_EXPORTED",
      actor: `user:${user.id}`,
      payload: { sha256, files: Object.keys(out).length, events: ix.events.length },
      rulesVersion: ix.lease.rulesVersion,
    }),
  );
  return { zip, sha256, filename: `case-pack-${ix.lease.ref.replaceAll("/", "-")}.zip` };
}
