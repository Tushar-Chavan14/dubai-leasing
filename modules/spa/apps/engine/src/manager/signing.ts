import { createHash, randomBytes } from "node:crypto";
import type { PgBoss } from "pg-boss";
import { appendSignatureRecord, type SignatureAnchor, stampSignatures } from "@platform/adapters";
import { newId } from "@platform/kernel/ids";
import { compareNames } from "@platform/kernel/names";
import { maskPii } from "@platform/kernel/pii";
import type { SpaActor, SpaRole } from "@spa/core";
import {
  agreements,
  deals,
  helperRuns,
  listings,
  outboundMessages,
  signatures,
  signingEnvelopes,
  spaTemplateVersions,
  type SpaTx,
  parties,
  withSpaTx,
} from "@spa/db";
import { renderSpaAgreement, signedCopyMail, signLinkMail, signReminderMail } from "@spa/helpers";
import { and, asc, desc, eq, inArray, isNull, lt, ne } from "drizzle-orm";
import { z } from "zod";
import { advance } from "./advance.ts";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, notFound, SpaDomainError, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { sendSpaMail } from "./mail.ts";
import { policyAt } from "./policy.ts";
import { agreementRenderInput } from "./prepare.ts";
import { gatherSheetInputs, rulebookFor, sheetFromInputs, sheetInputHash } from "./sheet.ts";
import { SIGNING_FINISH_JOB, SIGNING_INVITE_JOB, SIGNING_REMIND_JOB } from "../jobs.ts";

const SYSTEM: SpaActor = "system:signing";
/** Who may resend a link or read the signing status (S54): the people who run the deal, and legal and finance read. */
const RESEND_ROLES: readonly SpaRole[] = ["sales_officer", "sales_manager", "sales_admin", "admin"];
const READ_ROLES: readonly SpaRole[] = [...RESEND_ROLES, "legal", "finance"];
/** A reminder every 48 hours (S54). pg-boss delay, in seconds: scheduling, not a legal date. */
export const REMIND_EVERY_SECONDS = 48 * 3600;

const gone = (code: string, message: string) => new SpaDomainError(410, code, message);
export const hashLinkToken = (token: string): string => createHash("sha256").update(token).digest("hex");
const sha256 = (b: Uint8Array): string => createHash("sha256").update(b).digest("hex");

/** Where the approved and the signed PDF are read and stored. */
export interface SigningStore {
  put(bytes: Uint8Array, ext: string): Promise<{ sha256: string; path: string; bytes: number }>;
  read(key: string): Promise<Uint8Array>;
}
export interface SigningDeps {
  store: SigningStore;
}
type Queue = Pick<PgBoss, "send">;

const DOCUMENT_LABEL = {
  spa: "SPA",
  mou: "MOU",
  assignment: "Assignment",
  listing_agreement: "Listing agreement",
} as const;

export async function propertyLabel(tx: Pick<SpaTx, "db">, d: DealRow): Promise<string> {
  if (d.unitNo) return `Unit ${d.unitNo}`;
  if (d.listingId) {
    const [l] = await tx.db.select({ title: listings.title }).from(listings).where(eq(listings.id, d.listingId));
    if (l?.title) return l.title;
  }
  return d.ref;
}

// ---- opening ------------------------------------------------------------------------------------------------------

interface Signer {
  role: "purchaser" | "broker" | "seller";
  partyId: string;
  name: string;
  email: string;
  slot: number | null;
}

/**
 * Entering `SIGNING` (S54): builds the one envelope of the approved agreement, inside the step's transaction. The
 * agreement is printed again with its own `preparedAt`; unless the bytes hash to `agreements.doc_hash` and the deal's
 * values still hash as they did, nothing is opened (`agreement_changed`; a person is told). The rows follow the
 * policy's signing order: the first group (buyers by default), the broker, then the second group (the seller or the
 * company's signatory). Links are issued later (`inviteSigners`), when the mail can go.
 */
export async function openSigning(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
): Promise<{ ok: true; envelopeId: string } | { ok: false; reason: string }> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId));
  if (!d) throw notFound("deal");
  const stop = async (reason: string, message: string) => {
    await tx.db.insert(helperRuns).values({
      id: newId(),
      helper: "spa_signing",
      dealId,
      entityKind: "deal",
      entityId: dealId,
      status: "needs_human",
      result: { reason },
      reasons: [message],
      modelTag: null,
      promptVersion: null,
      rulesVersion: d.rulesVersion,
      visibility: "staff",
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "SIGNING_STOPPED",
      actor: SYSTEM,
      rulesVersion: d.rulesVersion,
      payload: { reason },
    });
    return { ok: false as const, reason };
  };
  const [ag] = await tx.db
    .select()
    .from(agreements)
    .where(and(eq(agreements.dealId, dealId), eq(agreements.status, "approved")))
    .orderBy(desc(agreements.version))
    .limit(1);
  if (!ag) return stop("no_approved_agreement", "There is no approved agreement to sign.");
  const [open] = await tx.db
    .select({ id: signingEnvelopes.id })
    .from(signingEnvelopes)
    .where(and(eq(signingEnvelopes.agreementId, ag.id), eq(signingEnvelopes.status, "open")));
  if (open) return { ok: true, envelopeId: open.id };

  const inputs = await gatherSheetInputs(tx, d);
  if (sheetInputHash(inputs) !== ag.valuesHash)
    return stop("agreement_changed", "The deal changed after the agreement was approved.");
  const [tv] = await tx.db.select().from(spaTemplateVersions).where(eq(spaTemplateVersions.id, ag.templateVersionId));
  const policy = await policyAt(tx.db, d.policyVersion);
  const sheet = sheetFromInputs(inputs, rulebookFor(ctx, d.rulesVersion), policy);
  const rendered = tv ? await renderSpaAgreement(agreementRenderInput(tv, d, sheet, ag.preparedAt)) : null;
  if (!rendered?.ok || sha256(rendered.bytes) !== ag.docHash)
    return stop("agreement_changed", "The approved agreement can't be reproduced exactly.");

  const emailOf = async (partyId: string): Promise<string> =>
    (await tx.db.select({ e: parties.email }).from(parties).where(eq(parties.id, partyId)))[0]!.e;
  const signersOf = async (list: typeof inputs.buyers, role: "purchaser" | "seller"): Promise<Signer[] | null> => {
    const out: Signer[] = [];
    for (const [i, p] of list.entries()) {
      if (p.kind === "company") {
        if (!p.signatory) return null;
        out.push({
          role,
          partyId: p.signatory.partyId,
          name: p.signatory.name,
          email: await emailOf(p.signatory.partyId),
          slot: i + 1,
        });
      } else out.push({ role, partyId: p.partyId, name: p.name, email: p.email, slot: i + 1 });
    }
    return out;
  };
  const buyers = await signersOf(inputs.buyers, "purchaser");
  const sellers = await signersOf(inputs.sellers, "seller");
  if (!buyers || !sellers) return stop("no_signatory", "A company on the deal has no signatory.");
  const roles = new Set(Object.values(tv!.signatureRoles));
  const brokerSigners: Signer[] = [];
  if (roles.has("broker")) {
    if (inputs.brokers.length > 1) return stop("broker_ambiguous", "The deal has two brokers and one broker line.");
    const b = inputs.brokers[0];
    if (b)
      brokerSigners.push({
        role: "broker",
        partyId: b.agencyPartyId,
        name: b.agentName,
        email: await emailOf(b.agencyPartyId),
        slot: null,
      });
  }
  const order = policy.signingOrder[d.dealType];
  const first = order[0] === "buyer" ? buyers : sellers;
  const second = order[0] === "buyer" ? sellers : buyers;
  const ordered = [...first, ...brokerSigners, ...second];
  if (!ordered.length) return stop("no_signers", "There is nobody to sign.");

  const envelopeId = newId();
  await tx.db.insert(signingEnvelopes).values({
    id: envelopeId,
    dealId,
    agreementId: ag.id,
    docHash: ag.docHash,
    status: "open",
    createdAt: ctx.clock.now(),
  });
  const expires = addDaysTs(ctx.clock.now(), policy.signingLinkDays);
  await tx.db.insert(signatures).values(
    ordered.map((s, i) => ({
      id: newId(),
      envelopeId,
      seq: i + 1,
      role: s.role,
      partyId: s.partyId,
      nameOnAgreement: s.name,
      email: s.email,
      // A placeholder nobody holds: the real link is issued when the mail goes out.
      linkTokenHash: hashLinkToken(randomBytes(32).toString("base64url")),
      linkExpiresAt: expires,
      anchor: {
        slot: s.slot,
        lines: rendered.anchors.filter((a) => a.role === s.role && (a.slot === null || a.slot === s.slot)),
      },
    })),
  );
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: dealId },
    type: "SIGNING_OPENED",
    actor: SYSTEM,
    rulesVersion: d.rulesVersion,
    payload: { agreementId: ag.id, envelopeId, docHash: ag.docHash, signers: ordered.length },
  });
  return { ok: true, envelopeId };
}

const addDaysTs = (at: Date, days: number): Date => new Date(at.getTime() + days * 86_400_000);

/** After the step commits: queue the invite job (the envelope exists only once the transaction commits). */
export async function enqueueSigningOnEntered(
  ctx: SpaContext,
  boss: Queue,
  e: { dealId: string; to: string },
  tx: SpaTx,
): Promise<void> {
  if (e.to !== "SIGNING") return;
  const r = await openSigning(ctx, tx, e.dealId);
  if (!r.ok) return;
  await boss
    .send(
      SIGNING_INVITE_JOB,
      { envelopeId: r.envelopeId },
      { singletonKey: `${r.envelopeId}:invite`, startAfter: 3, retryLimit: 5 },
    )
    .catch((err: unknown) => console.warn(`could not queue the signing invitations: ${(err as Error).message}`));
}

// ---- links and mail -----------------------------------------------------------------------------------------------

const linkNumber = (milestone: string): number => Number(milestone.slice("link:".length));

/**
 * Issues a fresh single-use link for one signer and emails it (S54). The old link stops working at once (only the new
 * token's hash is stored). `mode` is `invite` (only a signer with no link mail, or whose last one failed) or `resend`.
 */
async function issueAndSend(
  ctx: SpaContext,
  signatureId: string,
  mode: "invite" | "resend",
): Promise<"sent" | "failed" | "skipped"> {
  if (!ctx.mail) throw new SpaDomainError(503, "mail_unavailable", "email isn't configured, so nothing can be sent");
  const prepared = await withSpaTx(ctx.database, async (tx) => {
    const [s] = await tx.db.select().from(signatures).where(eq(signatures.id, signatureId)).for("update");
    if (!s) throw notFound("signature");
    const [env] = await tx.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, s.envelopeId));
    if (!env || env.status !== "open" || s.signedAt) return null;
    const mails = await tx.db
      .select({ milestone: outboundMessages.milestone, status: outboundMessages.status })
      .from(outboundMessages)
      .where(and(eq(outboundMessages.entityId, s.id), eq(outboundMessages.purpose, "link")));
    const nums = mails.map((m) => linkNumber(m.milestone)).filter((n) => Number.isFinite(n));
    const last = nums.length ? Math.max(...nums) : 0;
    let n: number;
    if (mode === "resend") n = last + 1;
    else if (!last) n = 1;
    else if (mails.find((m) => linkNumber(m.milestone) === last)?.status === "failed") n = last;
    else return null;
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, env.dealId));
    const [ag] = await tx.db.select().from(agreements).where(eq(agreements.id, env.agreementId));
    const policy = await policyAt(tx.db, d!.policyVersion);
    const token = randomBytes(32).toString("base64url");
    const expires = addDaysTs(ctx.clock.now(), policy.signingLinkDays);
    await tx.db
      .update(signatures)
      .set({ linkTokenHash: hashLinkToken(token), linkExpiresAt: expires })
      .where(eq(signatures.id, s.id));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: env.dealId },
      type: mode === "resend" ? "SIGNING_LINK_RESENT" : "SIGNING_LINK_ISSUED",
      actor: SYSTEM,
      rulesVersion: d!.rulesVersion,
      payload: { signatureId: s.id, seq: s.seq, role: s.role, link: n },
    });
    return {
      s,
      n,
      token,
      expires,
      document: DOCUMENT_LABEL[ag!.kind],
      property: await propertyLabel(tx, d!),
    };
  });
  if (!prepared) return "skipped";
  const { s, n, token, expires } = prepared;
  const r = await sendSpaMail(ctx, {
    entityKind: "signature",
    entityId: s.id,
    purpose: "link",
    milestone: `link:${n}`,
    to: s.email,
    parts: signLinkMail({
      name: s.nameOnAgreement,
      document: prepared.document,
      property: prepared.property,
      link: `${ctx.mail.webBaseUrl}/b/${token}/sign`,
      expiresOn: dubaiDate(expires),
    }),
  });
  return r.status === "sent" ? "sent" : r.status === "failed" ? "failed" : "skipped";
}

const dubaiDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/**
 * The invite job: every signer of an envelope gets their link by email (those not yet mailed, or whose mail failed).
 * Everyone is invited at once; the order is enforced when they sign. Safe to run twice. With a queue, the first
 * reminder of each signer is scheduled in 48 hours.
 */
export async function inviteSigners(
  ctx: SpaContext,
  envelopeId: string,
  boss?: Queue,
): Promise<{ sent: number; failed: number }> {
  const rows = await ctx.database.db
    .select()
    .from(signatures)
    .where(eq(signatures.envelopeId, envelopeId))
    .orderBy(asc(signatures.seq));
  let sent = 0;
  let failed = 0;
  for (const s of rows) {
    if (s.signedAt) continue;
    const r = await issueAndSend(ctx, s.id, "invite");
    if (r === "sent") sent++;
    if (r === "failed") failed++;
    if (r !== "skipped" && boss)
      await boss
        .send(
          SIGNING_REMIND_JOB,
          { signatureId: s.id, n: 1 },
          { singletonKey: `${s.id}:remind:1`, startAfter: REMIND_EVERY_SECONDS },
        )
        .catch((err: unknown) => console.warn(`could not queue a signing reminder: ${(err as Error).message}`));
  }
  return { sent, failed };
}

/** Staff send one signer a new link (S54); the old one stops working. Sales roles only. */
export async function resendSigningLink(
  ctx: SpaContext,
  dealId: string,
  signatureId: string,
  user: { id: string; role: SpaRole },
): Promise<{ status: "sent" | "failed" }> {
  if (!RESEND_ROLES.includes(user.role)) throw forbidden("you can't resend a signing link");
  const [row] = await ctx.database.db
    .select({ s: signatures, e: signingEnvelopes })
    .from(signatures)
    .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signatures.envelopeId))
    .where(and(eq(signatures.id, signatureId), eq(signingEnvelopes.dealId, dealId)));
  if (!row) throw notFound("signature");
  if (row.s.signedAt) throw conflict("already_signed", "this person has already signed");
  if (row.e.status !== "open") throw conflict("signing_closed", `the signing is ${row.e.status}`);
  const r = await issueAndSend(ctx, row.s.id, "resend");
  if (r === "skipped") throw conflict("signing_closed", "the signing is no longer open");
  return { status: r };
}

// ---- reminders ----------------------------------------------------------------------------------------------------

export type RemindResult =
  | { status: "sent" | "failed" | "skipped" | "not_their_turn" }
  | { status: "stopped"; reason: string };

/**
 * The reminder job (S54), every 48 hours: stops once the signer has signed, the signing is closed or their link has
 * expired. A signer whose turn has not come gets no mail, but the chain goes on. The mail carries no link (the token
 * exists only in the first email). Safe to run twice: one mail per signer and number.
 */
export async function remindSigner(
  ctx: SpaContext,
  boss: Queue,
  data: { signatureId: string; n: number },
): Promise<RemindResult> {
  const [row] = await ctx.database.db
    .select({ s: signatures, e: signingEnvelopes })
    .from(signatures)
    .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signatures.envelopeId))
    .where(eq(signatures.id, data.signatureId));
  if (!row) return { status: "stopped", reason: "unknown signer" };
  if (row.s.signedAt) return { status: "stopped", reason: "signed" };
  if (row.e.status !== "open") return { status: "stopped", reason: row.e.status };
  if (row.s.linkExpiresAt.getTime() < ctx.clock.now().getTime()) return { status: "stopped", reason: "link expired" };
  const next = () =>
    boss
      .send(
        SIGNING_REMIND_JOB,
        { signatureId: data.signatureId, n: data.n + 1 },
        { singletonKey: `${data.signatureId}:remind:${data.n + 1}`, startAfter: REMIND_EVERY_SECONDS },
      )
      .catch((err: unknown) => console.warn(`could not queue the next signing reminder: ${(err as Error).message}`));
  const [earlier] = await ctx.database.db
    .select({ id: signatures.id })
    .from(signatures)
    .where(and(eq(signatures.envelopeId, row.s.envelopeId), lt(signatures.seq, row.s.seq), isNull(signatures.signedAt)))
    .limit(1);
  if (earlier) {
    await next();
    return { status: "not_their_turn" };
  }
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, row.e.dealId));
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, row.e.agreementId));
  const [first] = await ctx.database.db
    .select({ at: outboundMessages.sentAt })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.entityId, row.s.id),
        eq(outboundMessages.purpose, "link"),
        eq(outboundMessages.status, "sent"),
      ),
    )
    .orderBy(desc(outboundMessages.sentAt))
    .limit(1);
  const r = await sendSpaMail(ctx, {
    entityKind: "signature",
    entityId: row.s.id,
    purpose: "reminder",
    milestone: `remind:${data.n}`,
    to: row.s.email,
    parts: signReminderMail({
      name: row.s.nameOnAgreement,
      document: DOCUMENT_LABEL[ag!.kind],
      property: await propertyLabel({ db: ctx.database.db }, d!),
      sentOn: dubaiDate(first?.at ?? row.e.createdAt),
    }),
  });
  if (r.status !== "skipped") await next();
  return { status: r.status };
}

// ---- the signer's link --------------------------------------------------------------------------------------------

async function loadLink(ctx: SpaContext, token: string) {
  const [row] = await ctx.database.db
    .select({ s: signatures, e: signingEnvelopes })
    .from(signatures)
    .innerJoin(signingEnvelopes, eq(signingEnvelopes.id, signatures.envelopeId))
    .where(eq(signatures.linkTokenHash, hashLinkToken(token)));
  return row ?? null;
}
function checkUsable(ctx: SpaContext, row: NonNullable<Awaited<ReturnType<typeof loadLink>>>) {
  if (row.e.status === "superseded") throw gone("link_superseded", "this agreement is no longer the one to sign");
  if (row.s.linkUsedAt || row.s.signedAt) throw gone("link_used", "this link has already been used");
  if (row.s.linkExpiresAt.getTime() < ctx.clock.now().getTime()) throw gone("link_expired", "this link has expired");
}

/** What a signing page shows: the signer's own line, whose turn it is, and nothing about anyone else. Null: no such link. */
export async function signingLinkSummary(ctx: SpaContext, token: string) {
  const row = await loadLink(ctx, token);
  if (!row) return null;
  checkUsable(ctx, row);
  const all = await ctx.database.db.select().from(signatures).where(eq(signatures.envelopeId, row.s.envelopeId));
  const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, row.e.dealId));
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, row.e.agreementId));
  return {
    role: row.s.role,
    name: row.s.nameOnAgreement,
    document: DOCUMENT_LABEL[ag!.kind],
    property: await propertyLabel({ db: ctx.database.db }, d!),
    yourTurn: all.every((x) => x.seq >= row.s.seq || x.signedAt),
    position: row.s.seq,
    of: all.length,
    expiresAt: row.s.linkExpiresAt.toISOString(),
  };
}

/** The approved PDF the signer is shown. Its hash must still be the envelope's. */
export async function signingLinkDocument(ctx: SpaContext, deps: SigningDeps, token: string): Promise<Uint8Array> {
  const row = await loadLink(ctx, token);
  if (!row) throw notFound("signing link");
  checkUsable(ctx, row);
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, row.e.agreementId));
  const bytes = await deps.store.read(ag!.storageKey);
  if (sha256(bytes) !== row.e.docHash) throw conflict("document_changed", "the stored agreement no longer matches");
  return bytes;
}

const SignInput = z.object({ typedName: z.string().trim().min(1).max(200), consent: z.literal(true) });

/**
 * A signer signs through their link (S54): their turn, their name as written on the agreement (exact or a typo-class
 * match), consent given. A used link is 410, a signer out of turn 409, a wrong name 422. The last signature queues the
 * finish job (the signed PDF, `ALL_SIGNED`); nothing else changes here.
 */
export async function signWithLink(
  ctx: SpaContext,
  boss: Queue,
  token: string,
  input: unknown,
  meta: { ip: string | null; userAgent: string | null },
): Promise<{ signed: true }> {
  const parsed = SignInput.safeParse(input);
  if (!parsed.success) throw unprocessable("consent_required", "type your full name and confirm your consent");
  const typed = parsed.data.typedName;
  const finish = await withSpaTx(ctx.database, async (tx) => {
    const [found] = await tx.db
      .select()
      .from(signatures)
      .where(eq(signatures.linkTokenHash, hashLinkToken(token)))
      .for("update");
    if (!found) throw notFound("signing link");
    const [env] = await tx.db
      .select()
      .from(signingEnvelopes)
      .where(eq(signingEnvelopes.id, found.envelopeId))
      .for("share");
    const row = { s: found, e: env! };
    checkUsable(ctx, row);
    const others = await tx.db.select().from(signatures).where(eq(signatures.envelopeId, found.envelopeId));
    if (others.some((o) => o.seq < found.seq && !o.signedAt))
      throw conflict("not_your_turn", "an earlier signer has not signed yet");
    const match = compareNames(typed, found.nameOnAgreement);
    const extraDigits = /\d/.test(typed) && !/\d/.test(found.nameOnAgreement);
    if (extraDigits || (match !== "exact" && match !== "typo_class"))
      throw unprocessable(
        "name_mismatch",
        `type your full name as it is written on the agreement: ${found.nameOnAgreement}`,
      );
    const now = ctx.clock.now();
    await tx.db
      .update(signatures)
      .set({ linkUsedAt: now, signedAt: now, typedName: typed, consent: true, ip: meta.ip, userAgent: meta.userAgent })
      .where(eq(signatures.id, found.id));
    const [d] = await tx.db.select({ v: deals.rulesVersion }).from(deals).where(eq(deals.id, env!.dealId));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: env!.dealId },
      type: "AGREEMENT_SIGNED",
      actor: `party:${found.partyId}`,
      rulesVersion: d?.v ?? null,
      payload: { envelopeId: env!.id, signatureId: found.id, seq: found.seq, role: found.role },
    });
    return others.every((o) => o.id === found.id || o.signedAt) ? env!.id : null;
  });
  if (finish)
    await boss
      .send(SIGNING_FINISH_JOB, { envelopeId: finish }, { singletonKey: `${finish}:finish`, retryLimit: 5 })
      .catch((err: unknown) => console.warn(`could not queue the signing finish: ${(err as Error).message}`));
  return { signed: true };
}

// ---- finishing ----------------------------------------------------------------------------------------------------

export type FinishResult = { finished: true; advanced: boolean } | { finished: false; reason: string };

/**
 * The finish job (S54), safe to run twice (singletonKey `<envelopeId>:finish`). When everyone has signed it stamps each
 * typed name on its signature line, appends the signature record page, stores the signed PDF with its hash, marks the
 * envelope complete and calls `ALL_SIGNED` as `system:signing` (routed by deal type; the guards, including a resale's
 * deposit, still apply: a blocked advance is recorded and the job can run again). Then every signer is emailed the copy.
 */
export async function finishSigning(ctx: SpaContext, deps: SigningDeps, envelopeId: string): Promise<FinishResult> {
  const [env] = await ctx.database.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelopeId));
  if (!env) throw notFound("envelope");
  if (env.status === "superseded") return { finished: false, reason: "superseded" };
  const rows = await ctx.database.db
    .select()
    .from(signatures)
    .where(eq(signatures.envelopeId, envelopeId))
    .orderBy(asc(signatures.seq));
  if (!rows.length || rows.some((s) => !s.signedAt)) return { finished: false, reason: "not_everyone_signed" };
  const [ag] = await ctx.database.db.select().from(agreements).where(eq(agreements.id, env.agreementId));

  let signedHash = env.signedDocHash;
  let storageKey = env.storageKey;
  if (env.status === "open") {
    const original = await deps.store.read(ag!.storageKey);
    if (sha256(original) !== env.docHash) throw conflict("document_changed", "the stored agreement no longer matches");
    const anchors: SignatureAnchor[] = [];
    const stampers: { role: string; slot: number | null; text: string }[] = [];
    for (const s of rows) {
      const a = s.anchor as { slot: number | null; lines: SignatureAnchor[] };
      for (const line of a.lines ?? []) {
        anchors.push(line);
        stampers.push({ role: s.role, slot: a.slot ?? null, text: s.typedName! });
      }
    }
    const stamped = await stampSignatures(original, anchors, stampers);
    const [d0] = await ctx.database.db.select().from(deals).where(eq(deals.id, env.dealId));
    const withRecord = await appendSignatureRecord(
      stamped.bytes,
      {
        reference: `${d0!.ref} ${DOCUMENT_LABEL[ag!.kind]} v${ag!.version}`,
        documentSha256: env.docHash,
        signers: rows.map((s) => ({
          role: s.role,
          name: s.nameOnAgreement,
          typedName: s.typedName!,
          signedAt: s.signedAt!.toISOString(),
          email: null,
        })),
        demo: false,
      },
      { roleLabels: { purchaser: "Purchaser", broker: "Broker", seller: "Seller" } },
    );
    const stored = await deps.store.put(withRecord, "pdf");
    signedHash = stored.sha256;
    storageKey = stored.path;
  }

  const advanced = await withSpaTx(ctx.database, async (tx) => {
    const [d] = await tx.db.select().from(deals).where(eq(deals.id, env.dealId)).for("update");
    const [e] = await tx.db.select().from(signingEnvelopes).where(eq(signingEnvelopes.id, envelopeId)).for("update");
    if (e!.status === "superseded") return null;
    if (e!.status === "open") {
      await tx.db
        .update(signingEnvelopes)
        .set({ status: "complete", signedDocHash: signedHash, storageKey, completedAt: ctx.clock.now() })
        .where(eq(signingEnvelopes.id, envelopeId));
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: env.dealId },
        type: "SIGNING_COMPLETE",
        actor: SYSTEM,
        rulesVersion: d!.rulesVersion,
        payload: { envelopeId, signedDocHash: signedHash },
      });
    }
    if (d!.state !== "SIGNING") return false;
    try {
      await advance(ctx, { kind: "deal", id: env.dealId }, "ALL_SIGNED", {
        actor: SYSTEM,
        payload: { envelopeId, signedDocHash: signedHash },
        tx,
      });
      return true;
    } catch (e2) {
      if (!(e2 instanceof SpaDomainError)) throw e2;
      await appendDealEvent(tx, ctx, {
        entity: { kind: "deal", id: env.dealId },
        type: "SIGNING_ADVANCE_BLOCKED",
        actor: SYSTEM,
        rulesVersion: d!.rulesVersion,
        payload: { envelopeId, code: e2.code, reasons: e2.reasons },
      });
      return false;
    }
  });
  if (advanced === null) return { finished: false, reason: "superseded" };

  // The signed copy to every signer (one mail each, never twice).
  if (ctx.mail) {
    const [d] = await ctx.database.db.select().from(deals).where(eq(deals.id, env.dealId));
    const property = await propertyLabel({ db: ctx.database.db }, d!);
    const bytes = await deps.store.read(storageKey!);
    for (const s of rows)
      await sendSpaMail(ctx, {
        entityKind: "signature",
        entityId: s.id,
        purpose: "receipt",
        milestone: "copy",
        to: s.email,
        parts: signedCopyMail({ name: s.nameOnAgreement, document: DOCUMENT_LABEL[ag!.kind], property }),
        attachments: [
          { filename: `${DOCUMENT_LABEL[ag!.kind]}-signed.pdf`, content: bytes, contentType: "application/pdf" },
        ],
      });
  }
  // Already complete before this run and nothing left to do: not a new finish.
  if (env.status === "complete" && !advanced) return { finished: false, reason: "already_complete" };
  return { finished: true, advanced };
}

// ---- staff view ---------------------------------------------------------------------------------------------------

/** Signing status for staff: who has signed, whose link was mailed. No links, addresses or hashes. */
export async function listSigning(ctx: SpaContext, dealId: string, user: { id: string; role: SpaRole }) {
  if (!READ_ROLES.includes(user.role)) throw forbidden("you can't read the signing status");
  return signingView(ctx, dealId);
}

/** The signing status with no role check: the caller (a route or a record section) has made it. */
export async function signingView(ctx: SpaContext, dealId: string) {
  const [env] = await ctx.database.db
    .select()
    .from(signingEnvelopes)
    .where(and(eq(signingEnvelopes.dealId, dealId), ne(signingEnvelopes.status, "superseded")))
    .orderBy(desc(signingEnvelopes.createdAt))
    .limit(1);
  if (!env) return null;
  const rows = await ctx.database.db
    .select()
    .from(signatures)
    .where(eq(signatures.envelopeId, env.id))
    .orderBy(asc(signatures.seq));
  const mails = rows.length
    ? await ctx.database.db
        .select()
        .from(outboundMessages)
        .where(
          and(
            inArray(
              outboundMessages.entityId,
              rows.map((r) => r.id),
            ),
            eq(outboundMessages.purpose, "link"),
          ),
        )
        .orderBy(asc(outboundMessages.createdAt))
    : [];
  return {
    envelope: { id: env.id, status: env.status, completedAt: env.completedAt?.toISOString() ?? null },
    signers: rows.map((s) => ({
      id: s.id,
      seq: s.seq,
      role: s.role,
      name: s.nameOnAgreement,
      signed: s.signedAt !== null,
      signedAt: s.signedAt?.toISOString() ?? null,
      linkExpiresAt: s.linkExpiresAt.toISOString(),
      mail: mails.filter((m) => m.entityId === s.id).at(-1)?.status ?? null,
    })),
  };
}

/** Marks a cancelled or superseded agreement's open envelopes superseded (links stop working). Same transaction. */
export async function supersedeEnvelopes(
  ctx: SpaContext,
  tx: SpaTx,
  dealId: string,
  agreementIds: string[],
  actor: SpaActor,
  rulesVersion: string | null,
): Promise<void> {
  if (!agreementIds.length) return;
  const open = await tx.db
    .select()
    .from(signingEnvelopes)
    .where(and(inArray(signingEnvelopes.agreementId, agreementIds), eq(signingEnvelopes.status, "open")));
  for (const e of open) {
    await tx.db.update(signingEnvelopes).set({ status: "superseded" }).where(eq(signingEnvelopes.id, e.id));
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: dealId },
      type: "SIGNING_SUPERSEDED",
      actor,
      rulesVersion,
      payload: maskPii({ envelopeId: e.id }),
    });
  }
}
