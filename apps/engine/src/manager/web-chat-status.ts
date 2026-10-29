import { createCipheriv, createDecipheriv, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import {
  type Actor,
  type CalendarDate,
  type ChannelButton,
  type ChannelUpdate,
  type ChatStatus,
  type EnquiryLanguage,
  formatAed,
  newId,
  STATUS_STAGES,
  type StatusItem,
} from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  applications,
  type conversations,
  contracts,
  contractSigners,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  tasks,
  type Tx,
  units,
  visitorVerifications,
  withTx,
} from "@leasing/db";
import { enquiryCopy } from "@leasing/helpers";
import { type AnyColumn, and, count, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { DomainError } from "../errors.ts";
import { OPEN_APPLICATION_STATES, resendApplicantLink } from "./applications.ts";
import { resendSignLink } from "./contracts.ts";
import type { Outcome } from "./enquiries.ts";
import { appendEvent } from "./events.ts";
import { resendEjariCertificate } from "./registration.ts";

/**
 * Status check in the public web chat (decision D34). The visitor asks for their applications;
 * a 6-digit code goes by email (purpose `chat_code`); once typed, the chat shows the open
 * applications and leases under that email and can email the existing portal links again.
 * Read-only and session-scoped: no accounts, no change of state. The session is bound to the
 * conversation and to the email it was verified for, for 24 hours; changing the email ends it.
 * Nothing before verification tells whether an email has records.
 */

type ConvRow = typeof conversations.$inferSelect;

export const CHAT_CODE_JOB = "chat.code";
const CODE_TTL_MS = 15 * 60_000;
const SESSION_MS = 24 * 3_600_000;
const MAX_ATTEMPTS = 5;
/** Codes sent per email address per hour, whoever asks (a DB count). The per-IP limit lives in the channel route. */
export const MAX_CODES_PER_EMAIL_PER_HOUR = 3;
const MAX_ITEMS = 5;
/** Lease states shown in the tracker: from contract to the Ejari certificate in the tenant's hands. */
const LEASE_STATES = ["CONTRACT", "REGISTRATION", "MOVE_IN"] as const;

// ---------------------------------------------------------------- codes

const hmac = (secret: string | Buffer, data: string) => createHmac("sha256", secret).update(data).digest("hex");
/** Domain-separated keys derived from SESSION_SECRET, so staff session HMACs and chat codes never share a key. */
const hashKey = (secret: string) => hmac(secret, "chat-code-hash-key");
const sealKey = (secret: string) => createHmac("sha256", secret).update("chat-code-seal-key").digest();

/** A random 6-digit code. */
export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");

/** Only this HMAC is stored. */
export const hashCode = (secret: string, verificationId: string, code: string) =>
  hmac(hashKey(secret), `chat-code:${verificationId}:${code}`);

/**
 * The code travels to the mail job inside the job payload, AES-256-GCM sealed with a key derived from
 * the server secret (pg-boss keeps completed job data until its archive window passes, so the job
 * never holds a readable code). The job also ignores it once the row is expired or used.
 */
export function sealCode(secret: string, code: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", sealKey(secret), iv);
  const ct = Buffer.concat([c.update(code, "utf8"), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString("base64url")).join(".");
}
function openCode(secret: string, sealed: string): string | null {
  try {
    const [iv, tag, ct] = sealed.split(".").map((x) => Buffer.from(x, "base64url"));
    const d = createDecipheriv("aes-256-gcm", sealKey(secret), iv!, { authTagLength: 16 });
    d.setAuthTag(tag!);
    const code = Buffer.concat([d.update(ct!), d.final()]).toString("utf8");
    return /^\d{6}$/.test(code) ? code : null;
  } catch {
    return null;
  }
}

function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && timingSafeEqual(x, y);
}

const langOf = (conv: ConvRow): EnquiryLanguage => (conv.language === "ar" ? "ar" : "en");

/** a***@example.com: enough for the visitor to recognise their own address. */
export function maskEmail(email: string): string {
  const [local = "", domain = ""] = email.split("@");
  return `${local.slice(0, 1)}***@${domain}`;
}

const emailIs = (col: AnyColumn, email: string) => sql`lower(${col}) = ${email}`;

// ---------------------------------------------------------------- the data (read-only)

async function openTaskKinds(tx: Tx, ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set();
  const rows = await tx.db
    .select({ kind: tasks.kind })
    .from(tasks)
    .where(and(inArray(tasks.entityId, ids), eq(tasks.status, "open")));
  return new Set(rows.map((r) => r.kind));
}

/** Whether any open application or pipeline lease sits under this email. */
export async function hasRecords(tx: Tx, email: string): Promise<boolean> {
  const [a] = await tx.db
    .select({ id: applications.id })
    .from(applications)
    .innerJoin(parties, eq(parties.id, applications.partyId))
    .where(and(emailIs(parties.email, email), inArray(applications.state, [...OPEN_APPLICATION_STATES])))
    .limit(1);
  if (a) return true;
  const [l] = await tx.db
    .select({ id: leases.id })
    .from(leases)
    .innerJoin(leaseParties, and(eq(leaseParties.leaseId, leases.id), eq(leaseParties.role, "tenant")))
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .where(and(emailIs(parties.email, email), inArray(leases.state, [...LEASE_STATES])))
    .limit(1);
  return !!l;
}

function tracker(current: number): StatusItem["stages"] {
  return STATUS_STAGES.map((name, i) => ({
    name,
    state: i < current ? ("done" as const) : i === current ? ("current" as const) : ("todo" as const),
  }));
}

/**
 * The open applications and leases under this email: visitor-facing stage, one-sentence next
 * step, the current offer's rent and cheques (formatted here, never by a model), and the buttons
 * that email a link again. No ID numbers, deposit, landlord details or earlier offer revisions.
 */
export async function statusFor(
  tx: Tx,
  email: string,
  today: CalendarDate,
  lang: EnquiryLanguage = "en",
): Promise<ChatStatus> {
  const t = enquiryCopy[lang];
  const items: StatusItem[] = [];

  const apps = await tx.db
    .select({ a: applications, unitCode: units.code })
    .from(applications)
    .innerJoin(parties, eq(parties.id, applications.partyId))
    .innerJoin(units, eq(units.id, applications.unitId))
    .where(and(emailIs(parties.email, email), inArray(applications.state, [...OPEN_APPLICATION_STATES])))
    .orderBy(desc(applications.createdAt));
  for (const { a, unitCode } of apps) {
    const held = (await openTaskKinds(tx, [a.id])).has("send_offer");
    const offerOut = !!a.offer && !held && (a.state === "OFFER" || a.state === "RESERVED");
    const actions: ChannelButton[] = [];
    let current: number;
    let next: string;
    switch (a.state) {
      case "ENQUIRY":
        current = 0;
        next = t.nextStep("enquiry");
        break;
      case "VIEWING":
        current = 0;
        next = t.nextStep("viewing");
        break;
      case "SCREENING":
        current = 1;
        next = t.nextStep("documents");
        actions.push({ label: t.actUpload, data: `status:up:${a.id}` });
        break;
      case "OFFER":
        current = 2;
        next = offerOut ? t.nextStep("offer") : t.nextStep("offerPrep");
        if (offerOut && a.offer!.expiresOn >= today) actions.push({ label: t.actOffer, data: `status:of:${a.id}` });
        break;
      default:
        current = 3; // RESERVED: the offer is accepted, the contract comes next
        next = t.nextStep("reserved");
    }
    items.push({
      kind: "application",
      ref: a.ref ?? a.id.slice(0, 8),
      unitCode,
      stage: STATUS_STAGES[current]!,
      stages: tracker(current),
      nextStep: next,
      ...(offerOut
        ? {
            offer: {
              annualRentFils: a.offer!.annualRentFils,
              annualRent: formatAed(a.offer!.annualRentFils),
              cheques: a.offer!.cheques,
            },
          }
        : {}),
      actions,
    });
  }

  const lss = await tx.db
    .select({ l: leases, unitCode: units.code })
    .from(leases)
    .innerJoin(leaseParties, and(eq(leaseParties.leaseId, leases.id), eq(leaseParties.role, "tenant")))
    .innerJoin(parties, eq(parties.id, leaseParties.partyId))
    .innerJoin(units, eq(units.id, leases.unitId))
    .where(and(emailIs(parties.email, email), inArray(leases.state, [...LEASE_STATES])))
    .orderBy(desc(leases.createdAt));
  for (const { l, unitCode } of lss) {
    const actions: ChannelButton[] = [];
    let current: number;
    let next: string;
    if (l.state === "CONTRACT") {
      current = 3;
      const sent = await signableFor(tx, l.id, email);
      next = sent ? t.nextStep("contractSigning") : t.nextStep("contract");
      if (sent) actions.push({ label: t.actSign, data: `status:sg:${l.id}` });
    } else if (l.state === "REGISTRATION") {
      current = 4;
      next = t.nextStep("ejari");
    } else {
      current = STATUS_STAGES.length; // registered: every stage done
      next = t.nextStep("registered");
      if (l.ejariNo) actions.push({ label: t.actEjari, data: `status:ej:${l.id}` });
    }
    items.push({
      kind: "lease",
      ref: l.ref,
      unitCode,
      stage: STATUS_STAGES[Math.min(current, STATUS_STAGES.length - 1)]!,
      stages: tracker(current),
      nextStep: next,
      offer: { annualRentFils: l.annualRentFils, annualRent: formatAed(l.annualRentFils), cheques: l.cheques },
      actions,
    });
  }

  const apps5 = items.slice(0, MAX_ITEMS);
  // With several records, say which one a button is for.
  if (apps5.length > 1)
    for (const it of apps5)
      it.actions = it.actions.map((b) => ({ ...b, label: `${b.label} (${it.ref})`.slice(0, 64) }));
  return { apps: apps5 };
}

/** The contract is out for signature and this email is the tenant signer who hasn't signed. */
async function signableFor(tx: Tx, leaseId: string, email: string) {
  const [row] = await tx.db
    .select({ signerId: contractSigners.id })
    .from(contractSigners)
    .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
    .where(
      and(
        eq(contracts.leaseId, leaseId),
        eq(contracts.status, "sent"),
        eq(contractSigners.role, "tenant"),
        isNull(contractSigners.signedAt),
        emailIs(contractSigners.email, email),
      ),
    )
    .limit(1);
  return row ?? null;
}

/** The status as chat text, the fallback for clients that don't draw the tracker. */
export function statusText(status: ChatStatus, lang: EnquiryLanguage): string {
  const t = enquiryCopy[lang];
  if (!status.apps.length) return t.statusNone;
  const lines = [t.statusIntro(status.apps.length)];
  for (const a of status.apps) {
    lines.push("", t.statusRef(a.ref, a.unitCode), t.statusStage(t.stageName(a.stage), a.nextStep));
    if (a.offer) lines.push(t.statusOffer(a.offer.annualRent, a.offer.cheques));
  }
  return lines.join("\n");
}

// ---------------------------------------------------------------- sessions

/** A verified session for this conversation: the latest verification, for the email the chat holds now, under 24 h old. */
async function activeSession(ctx: EngineContext, tx: Tx, conv: ConvRow) {
  if (!conv.contactEmail) return null;
  const [v] = await tx.db
    .select()
    .from(visitorVerifications)
    .where(
      and(
        eq(visitorVerifications.conversationId, conv.id),
        eq(visitorVerifications.email, conv.contactEmail),
        gt(visitorVerifications.verifiedAt, new Date(ctx.clock.now().getTime() - SESSION_MS)),
      ),
    )
    .orderBy(desc(visitorVerifications.verifiedAt))
    .limit(1);
  return v ?? null;
}

/** Whether this conversation holds a verified status session now (for the web agent's `my_status`). */
export async function hasStatusSession(ctx: EngineContext, tx: Tx, conv: ConvRow): Promise<boolean> {
  return !!(await activeSession(ctx, tx, conv));
}

/** "Change email" ends the session. The rows stay as the record of codes issued; none can be used again. */
export async function endStatusSession(tx: Tx, conversationId: string): Promise<void> {
  await tx.db
    .update(visitorVerifications)
    .set({ verifiedAt: null, attempts: MAX_ATTEMPTS })
    .where(eq(visitorVerifications.conversationId, conversationId));
}

// ---------------------------------------------------------------- the chat steps

const tail = (conv: ConvRow): ChannelButton[] => {
  const t = enquiryCopy[langOf(conv)];
  return [
    { label: t.checkStatus, data: "status:start" },
    { label: t.changeEmail, data: "contact:change" },
  ];
};

/**
 * Handles the status buttons and the typed code. Null: not a status update. Runs in the
 * conversation's transaction, so the code check and the attempts count commit together.
 */
export async function webStatusStep(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  u: ChannelUpdate,
): Promise<Outcome | null> {
  const t = enquiryCopy[langOf(conv)];
  if (u.kind === "callback" && u.data === "status:start") {
    if (!conv.contactEmail) return null;
    if (await activeSession(ctx, tx, conv)) return showStatus(ctx, tx, conv);
    return startCode(ctx, tx, conv);
  }
  if (u.kind === "callback") {
    const act = /^status:(up|of|sg|ej):([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/.exec(u.data);
    if (act) return resend(ctx, tx, conv, act[1] as "up" | "of" | "sg" | "ej", act[2]!);
    return null;
  }
  if (u.kind === "text" && conv.flow.step === "asking_status_code") {
    const code = u.text.replace(/\s+/g, "");
    if (!/^\d{6}$/.test(code))
      return { reply: { text: t.statusCodeAsk, buttons: tail(conv), input: "code" }, kind: "status_code_ask" };
    return verify(ctx, tx, conv, code);
  }
  return null;
}

export async function startCode(ctx: EngineContext, tx: Tx, conv: ConvRow): Promise<Outcome> {
  const t = enquiryCopy[langOf(conv)];
  const email = conv.contactEmail!;
  const now = ctx.clock.now();
  // One request per email at a time, so parallel chats can't pass the count together.
  await tx.db.execute(sql`select pg_advisory_xact_lock(hashtext(${email}))`);
  const [recent] = await tx.db
    .select({ n: count() })
    .from(visitorVerifications)
    .where(
      and(
        eq(visitorVerifications.email, email),
        gt(visitorVerifications.createdAt, new Date(now.getTime() - 3_600_000)),
      ),
    );
  // The same reply whether we sent a code, hit a limit or found no records. The job is always queued
  // when under the limit; it checks for records itself and sends nothing if there are none.
  if ((recent?.n ?? 0) < MAX_CODES_PER_EMAIL_PER_HOUR) {
    const id = newId();
    const code = newCode();
    await tx.db.insert(visitorVerifications).values({
      id,
      conversationId: conv.id,
      email,
      codeHash: hashCode(ctx.serverSecret, id, code),
      expiresAt: new Date(now.getTime() + CODE_TTL_MS),
      createdAt: now,
    });
    await ctx.scheduler.send(tx, {
      name: CHAT_CODE_JOB,
      data: { verificationId: id, sealed: sealCode(ctx.serverSecret, code) },
      singletonKey: `${id}:chat_code`,
    });
  }
  return {
    reply: { text: t.statusCodeSent(maskEmail(email)), buttons: tail(conv), input: "code" },
    kind: "status_code_sent",
    flow: { step: "asking_status_code" },
  };
}

async function verify(ctx: EngineContext, tx: Tx, conv: ConvRow, code: string): Promise<Outcome> {
  const t = enquiryCopy[langOf(conv)];
  const now = ctx.clock.now();
  const bad: Outcome = { reply: { text: t.statusCodeBad, buttons: tail(conv) }, kind: "status_code_bad" };
  if (!conv.contactEmail) return bad;
  // Only the latest unused code for the email the chat holds now.
  const [v] = await tx.db
    .select()
    .from(visitorVerifications)
    .where(
      and(
        eq(visitorVerifications.conversationId, conv.id),
        eq(visitorVerifications.email, conv.contactEmail),
        isNull(visitorVerifications.verifiedAt),
      ),
    )
    .orderBy(desc(visitorVerifications.createdAt), desc(visitorVerifications.id))
    .limit(1)
    .for("update");
  if (!v || v.expiresAt.getTime() <= now.getTime() || v.attempts >= MAX_ATTEMPTS) return bad;
  const ok = sameHash(v.codeHash, hashCode(ctx.serverSecret, v.id, code));
  if (!ok) {
    await tx.db
      .update(visitorVerifications)
      .set({ attempts: v.attempts + 1 })
      .where(eq(visitorVerifications.id, v.id));
    return bad;
  }
  await tx.db.update(visitorVerifications).set({ verifiedAt: now }).where(eq(visitorVerifications.id, v.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "conversation", id: conv.id },
    rulesVersion: ctx.rulesVersion,
    type: "STATUS_CHECK_VERIFIED",
    actor: `enquirer:${conv.id}`,
    payload: { verificationId: v.id },
  });
  return { ...(await showStatus(ctx, tx, conv)), flow: { step: "idle" } };
}

async function showStatus(ctx: EngineContext, tx: Tx, conv: ConvRow): Promise<Outcome> {
  const lang = langOf(conv);
  const status = await statusFor(tx, conv.contactEmail!, ctx.clock.today(), lang);
  const actions = status.apps.flatMap((a) => a.actions).slice(0, 8);
  const text = statusText(status, lang);
  return {
    reply: { text, status, buttons: [...actions, ...tail(conv).slice(1)] },
    // History keeps no personal details: a visitor whose session ended sees only this line.
    stored: { text: enquiryCopy[lang].statusShownStored },
    kind: "status_shown",
  };
}

/** Re-sends one link through the existing mail path, for a record that belongs to the verified email. */
async function resend(
  ctx: EngineContext,
  tx: Tx,
  conv: ConvRow,
  act: "up" | "of" | "sg" | "ej",
  id: string,
): Promise<Outcome> {
  const t = enquiryCopy[langOf(conv)];
  const say = (text: string, kind: string): Outcome => ({ reply: { text, buttons: tail(conv) }, kind });
  const session = await activeSession(ctx, tx, conv);
  if (!session) return say(t.statusNeedsVerify, "status_needs_verify");
  const email = session.email;
  const actor: Actor = `enquirer:${conv.id}`;
  const result = async (): Promise<"queued" | "already_today" | "not_now" | "being_prepared"> => {
    if (act === "up" || act === "of") {
      const [mine] = await tx.db
        .select({ id: applications.id })
        .from(applications)
        .innerJoin(parties, eq(parties.id, applications.partyId))
        .where(and(eq(applications.id, id), emailIs(parties.email, email)));
      if (!mine) return "not_now";
      return resendApplicantLink(ctx, id, act === "up" ? "docs" : "offer", actor, tx);
    }
    const [mine] = await tx.db
      .select({ id: leases.id })
      .from(leases)
      .innerJoin(leaseParties, and(eq(leaseParties.leaseId, leases.id), eq(leaseParties.role, "tenant")))
      .innerJoin(parties, eq(parties.id, leaseParties.partyId))
      .where(and(eq(leases.id, id), emailIs(parties.email, email)));
    if (!mine) return "not_now";
    if (act === "ej") return resendEjariCertificate(ctx, id, actor, tx);
    const signer = await signableFor(tx, id, email);
    if (!signer) return "not_now";
    const r = await resendSignLink(ctx, id, signer.signerId, actor, { oncePerDay: true }, tx);
    return r.duplicate ? "already_today" : "queued";
  };
  let outcome: "queued" | "already_today" | "not_now" | "being_prepared";
  try {
    outcome = await result();
  } catch (e) {
    if (!(e instanceof DomainError)) throw e;
    outcome = "not_now";
  }
  return say(
    outcome === "queued"
      ? t.actQueued
      : outcome === "already_today"
        ? t.actAlready
        : outcome === "being_prepared"
          ? t.actPreparing
          : t.actNotNow,
    `status_resend_${outcome}`,
  );
}

// ---------------------------------------------------------------- the code email (job)

/**
 * Sends the code email for one verification row (job, idempotent): stored in `outbound_messages`
 * like every outbound mail, with the SMTP response and a hash of the body (never the code itself).
 * A sent code is not sent twice; an expired or used one is dropped.
 */
export async function sendChatCode(ctx: EngineContext, verificationId: string, sealed: string) {
  const prepared = await withTx(ctx.database, async (tx) => {
    const [v] = await tx.db
      .select()
      .from(visitorVerifications)
      .where(eq(visitorVerifications.id, verificationId))
      .for("update");
    if (!v || v.verifiedAt || v.expiresAt.getTime() <= ctx.clock.now().getTime()) return null;
    // No records under this email: nothing is sent and nothing is recorded.
    if (!(await hasRecords(tx, v.email))) return null;
    const code = openCode(ctx.serverSecret, sealed);
    if (!code) return null;
    const milestone = `code:${v.id}`;
    const [existing] = await tx.db
      .select()
      .from(outboundMessages)
      .where(
        and(
          eq(outboundMessages.entityId, v.conversationId),
          eq(outboundMessages.purpose, "chat_code"),
          eq(outboundMessages.milestone, milestone),
        ),
      )
      .for("update");
    if (existing && existing.status !== "failed") return null;
    const subject = "Your verification code";
    const text = `Your code is ${code}.\nIt works for 15 minutes. Type it into the chat to see your applications.\nIf you did not ask for it, ignore this email: nothing has changed.`;
    const html = `<p>Your code is <strong>${code}</strong>.</p><p>It works for 15 minutes. Type it into the chat to see your applications.</p><p>If you did not ask for it, ignore this email: nothing has changed.</p>`;
    const id = existing?.id ?? newId();
    if (existing) {
      await tx.db.update(outboundMessages).set({ status: "sending", error: null }).where(eq(outboundMessages.id, id));
    } else {
      await tx.db.insert(outboundMessages).values({
        id,
        entityKind: "conversation",
        entityId: v.conversationId,
        purpose: "chat_code",
        milestone,
        to: v.email,
        intendedTo: v.email,
        template: "chat_code",
        subject,
        status: "sending",
        createdAt: ctx.clock.now(),
      });
    }
    return { id, to: v.email, conversationId: v.conversationId, mail: { subject, text, html } };
  });
  if (!prepared) return { sent: false };

  let receipt: Awaited<ReturnType<EngineContext["mailer"]["send"]>>;
  try {
    receipt = await ctx.mailer.send({ to: prepared.to, ...prepared.mail });
  } catch (e) {
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error: String(e instanceof Error ? e.message : e).replace(/\d{6}/g, "******") })
      .where(eq(outboundMessages.id, prepared.id));
    throw new Error("chat code email failed", { cause: e });
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
        sentAt: ok ? ctx.clock.now() : null,
        error: ok ? null : "recipient not accepted by the mail server",
      })
      .where(eq(outboundMessages.id, prepared.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "conversation", id: prepared.conversationId },
      type: ok ? "EMAIL_SENT" : "EMAIL_FAILED",
      actor: "system",
      payload: { outboundMessageId: prepared.id, kind: "chat_code", messageId: receipt.messageId },
      rulesVersion: ctx.rulesVersion,
    });
  });
  return { sent: ok, outboundMessageId: prepared.id };
}
