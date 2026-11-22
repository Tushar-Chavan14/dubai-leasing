import { randomBytes } from "node:crypto";
import { newId } from "@platform/kernel/ids";
import { maskPiiText } from "@platform/kernel/pii";
import { formatAed } from "@platform/kernel/money";
import { PARTY_STATE_WORDS, partyBanned, stepsFor, type SpaActor } from "@spa/core";
import {
  amlCases,
  beneficialOwners,
  dealParties,
  deals,
  DOCUMENT_KINDS,
  outboundMessages,
  type OutboundPurpose,
  parties,
  PORTAL_PURPOSES,
  portalLinks,
  type PortalPurpose,
  signatures,
  signingEnvelopes,
  type SpaDb,
  type SpaTx,
  withSpaTx,
} from "@spa/db";
import { documentsRequestMail, type SpaMailParts } from "@spa/helpers";
import { and, desc, eq, inArray, isNull, ne } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { hourBucket, takeRateLimit } from "./assistants.ts";
import { openChaseItems } from "./chase.ts";
import { enqueueCompanyCheck } from "./company-check.ts";
import { currentCompanyDocuments } from "./company-facts.ts";
import type { SpaContext } from "./context.ts";
import { conflict, gone, notFound, SpaDomainError, tooMany, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { effectiveKycConfig } from "./kyc-config.ts";
import { type DealKycParty, currentPartyDocuments, dealKycParties, PERSON_KYC_ROLES } from "./kyc-facts.ts";
import { enqueueKycRun } from "./kyc.ts";
import { sendSpaMail } from "./mail.ts";
import { type DocumentStore, PARTY_KINDS, storeDealDocument } from "./noc.ts";
import { planCoverage } from "./payment-facts.ts";
import { policyAt } from "./policy.ts";
import { enqueueDocumentRead, PROFILE_OF_KIND } from "./readers.ts";
import { hashLinkToken, propertyLabel } from "./signing.ts";

/**
 * The buyer and seller portal (C35, S67). A token is one deal, one person and one purpose: `documents` acts (upload, "Send
 * my documents") and is used up on send; `view` only reads and lives as long as the deal. The party id always comes from
 * the token, never from a request. Nothing here opens a gate: the existing KYC and company-check runs do.
 */
export const PORTAL_UPLOADS_PER_HOUR = 30;
const SAY_AGENT = "Your agent can help with that.";
/** A deal in one of these states has no portal any more. */
const VIEW_CLOSED = new Set(["CANCELLED", "COMPLETED"]);
const PAGE = { documents: "documents", view: "status" } as const;
const addDaysTs = (at: Date, days: number): Date => new Date(at.getTime() + days * 86_400_000);

export const hashPortalToken = hashLinkToken;
export { PORTAL_PURPOSES };

// ---- issuing ------------------------------------------------------------------------------------------------------

/**
 * Issues a link for one person, deal and purpose and kills the one before it (S67): a resend never leaves two live
 * links. Runs inside the caller's transaction. Returns the raw token, which exists only here and in the email.
 */
export async function issuePortalLink(
  tx: SpaTx,
  ctx: SpaContext,
  input: { deal: DealRow; partyId: string; purpose: PortalPurpose; by: SpaActor },
): Promise<{ token: string; linkId: string; expiresAt: Date | null }> {
  const now = ctx.clock.now();
  const { deal, partyId, purpose } = input;
  await tx.db
    .update(portalLinks)
    .set({ supersededAt: now })
    .where(
      and(
        eq(portalLinks.dealId, deal.id),
        eq(portalLinks.partyId, partyId),
        eq(portalLinks.purpose, purpose),
        isNull(portalLinks.supersededAt),
        isNull(portalLinks.usedAt),
      ),
    );
  const token = randomBytes(32).toString("base64url");
  const expiresAt =
    purpose === "documents" ? addDaysTs(now, (await policyAt(tx.db, deal.policyVersion)).documentLinkDays) : null;
  const linkId = newId();
  await tx.db.insert(portalLinks).values({
    id: linkId,
    dealId: deal.id,
    partyId,
    purpose,
    tokenHash: hashPortalToken(token),
    expiresAt,
    createdBy: input.by,
    createdAt: now,
  });
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: deal.id },
    type: "PORTAL_LINK_ISSUED",
    actor: input.by,
    rulesVersion: deal.rulesVersion,
    payload: { linkId, purpose, partyId },
  });
  return { token, linkId, expiresAt };
}

const dubaiDate = (d: Date): string =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dubai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);

/** The side a person is on: a buyer or seller on the deal, or a beneficial owner on their company's side. */
async function sideOf(db: SpaDb, dealId: string, partyId: string): Promise<"buyer" | "seller"> {
  const [own] = await db
    .select({ role: dealParties.role })
    .from(dealParties)
    .where(
      and(
        eq(dealParties.dealId, dealId),
        eq(dealParties.partyId, partyId),
        inArray(dealParties.role, ["buyer", "seller"]),
      ),
    );
  if (own) return own.role as "buyer" | "seller";
  const [viaCompany] = await db
    .select({ role: dealParties.role })
    .from(beneficialOwners)
    .innerJoin(dealParties, eq(dealParties.partyId, beneficialOwners.companyPartyId))
    .where(and(eq(beneficialOwners.personPartyId, partyId), eq(dealParties.dealId, dealId)));
  return viaCompany?.role === "seller" ? "seller" : "buyer";
}

/** The person's or company's own current documents, the ones their check reads. */
const currentDocuments = (db: SpaDb, dealId: string, me: DealKycParty) =>
  me.role === "company_party"
    ? currentCompanyDocuments(db, dealId, me.partyId)
    : currentPartyDocuments(db, dealId, me.partyId);

/** The document fields a person is asked for, from the KYC config in force for their role and the deal type. */
async function documentFields(db: SpaDb, deal: DealRow, me: DealKycParty) {
  const cfg = await effectiveKycConfig(db, me.role, deal.dealType);
  return cfg.config.form
    .filter(
      (f) =>
        f.type === "document" &&
        f.documentKind &&
        (DOCUMENT_KINDS as readonly string[]).includes(f.documentKind) &&
        PARTY_KINDS.includes(f.documentKind),
    )
    .map((f) => ({ kind: f.documentKind as string, label: f.label, help: f.help ?? "", required: f.required }));
}

/**
 * Issues a fresh documents link for one person and emails it (the `documents_request` template, one row per party and
 * milestone `documents:<party>:<n>`). The result says whether the mail went; a failed mail is shown to staff and not
 * retried by itself: a staff resend issues the next link.
 */
export async function mailDocumentsLink(
  ctx: SpaContext,
  dealId: string,
  partyId: string,
  by: SpaActor,
): Promise<{ status: "sent" | "failed" | "skipped"; outboundId: string | null }> {
  if (!ctx.mail) return { status: "skipped", outboundId: null };
  const db = ctx.database.db;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) throw notFound("deal");
  const me = (await dealKycParties(db, dealId)).find((p) => p.partyId === partyId);
  if (!me) throw unprocessable("party_not_on_deal", "that party isn't on this deal");
  const [p] = await db
    .select({ email: parties.email, name: parties.fullNameEn })
    .from(parties)
    .where(eq(parties.id, partyId));
  const fields = await documentFields(db, deal, me);
  const prior = await db
    .select({ milestone: outboundMessages.milestone })
    .from(outboundMessages)
    .where(and(eq(outboundMessages.entityId, dealId), eq(outboundMessages.purpose, "link")));
  const n = prior.filter((m) => m.milestone.startsWith(`documents:${partyId}:`)).length + 1;
  const issued = await withSpaTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
    if (!locked) throw notFound("deal");
    if (locked.state === "CANCELLED" || locked.state === "COMPLETED" || locked.state === "HANDED_OVER")
      throw conflict("deal_closed", `a deal in ${locked.state} needs no more documents`);
    return issuePortalLink(tx, ctx, { deal: locked, partyId, purpose: "documents", by });
  });
  const r = await sendSpaMail(ctx, {
    entityKind: "deal",
    entityId: dealId,
    purpose: "link",
    milestone: `documents:${partyId}:${n}`,
    to: p!.email,
    parts: documentsRequestMail({
      name: p!.name,
      property: await propertyLabel({ db }, deal),
      items: fields.map((f) => f.label),
      link: `${ctx.mail.webBaseUrl}/b/${issued.token}/${PAGE.documents}`,
      expiresOn: dubaiDate(issued.expiresAt!),
    }),
  });
  return { status: r.status, outboundId: r.outboundId };
}

/**
 * Sends a mail that carries a read-only status link. The link is issued only when the mail will really be sent (a mail
 * already sent or being sent for the same key is left alone, so it never kills a link a person is holding).
 */
export async function sendWithViewLink(
  ctx: SpaContext,
  input: {
    dealId: string;
    partyId: string;
    purpose: OutboundPurpose;
    milestone: string;
    to: string;
    by: SpaActor;
    parts: (link: string) => SpaMailParts;
  },
): Promise<{ status: "sent" | "failed" | "skipped"; outboundId: string | null }> {
  if (!ctx.mail) return { status: "skipped", outboundId: null };
  const db = ctx.database.db;
  const [seen] = await db
    .select({ id: outboundMessages.id, status: outboundMessages.status })
    .from(outboundMessages)
    .where(
      and(
        eq(outboundMessages.entityId, input.dealId),
        eq(outboundMessages.purpose, input.purpose),
        eq(outboundMessages.milestone, input.milestone),
      ),
    );
  if (seen && seen.status !== "failed") return { status: "skipped", outboundId: seen.id };
  const issued = await withSpaTx(ctx.database, async (tx) => {
    const [deal] = await tx.db.select().from(deals).where(eq(deals.id, input.dealId)).for("update");
    if (!deal || VIEW_CLOSED.has(deal.state)) return null;
    return issuePortalLink(tx, ctx, { deal, partyId: input.partyId, purpose: "view", by: input.by });
  });
  if (!issued) return { status: "skipped", outboundId: null };
  const r = await sendSpaMail(ctx, {
    entityKind: "deal",
    entityId: input.dealId,
    purpose: input.purpose,
    milestone: input.milestone,
    to: input.to,
    parts: input.parts(`${ctx.mail.webBaseUrl}/b/${issued.token}/${PAGE.view}`),
  });
  return { status: r.status, outboundId: r.outboundId };
}

// ---- resolving ----------------------------------------------------------------------------------------------------

export interface PortalScope {
  linkId: string;
  dealId: string;
  partyId: string;
  purpose: PortalPurpose;
  role: "buyer" | "seller";
  /** The token's hash: what a thread and a rate limit are keyed by. */
  principal: string;
  deal: DealRow;
}

/**
 * The scope behind a portal token, or null. Unknown, other-purpose, used, superseded, expired and closed-deal links all
 * give null here (the party assistant says "no such link" for every one, S54); `loadPortal` tells a holder why.
 */
export async function resolvePortalToken(ctx: SpaContext, token: string): Promise<PortalScope | null> {
  try {
    return await loadPortal(ctx, token);
  } catch (e) {
    if (e instanceof SpaDomainError) return null;
    throw e;
  }
}

/**
 * Finds a live link of the wanted purpose (any when omitted). A token that is unknown or of another purpose is the one
 * 404 (nothing is said about which); a link that was used, replaced, expired or whose deal is closed is 410 with a plain
 * code, as signing links are (S54).
 */
export async function loadPortal(ctx: SpaContext, token: string, purpose?: PortalPurpose): Promise<PortalScope> {
  if (!token || token.length > 200) throw notFound("link");
  const db = ctx.database.db;
  const [row] = await db
    .select({ link: portalLinks, deal: deals })
    .from(portalLinks)
    .innerJoin(deals, eq(deals.id, portalLinks.dealId))
    .where(eq(portalLinks.tokenHash, hashPortalToken(token)));
  if (!row || (purpose && row.link.purpose !== purpose)) throw notFound("link");
  const { link, deal } = row;
  if (link.supersededAt) throw gone("link_superseded", "a newer link replaced this one");
  if (link.usedAt) throw gone("link_used", "this link has already been used");
  if (link.expiresAt && link.expiresAt.getTime() < ctx.clock.now().getTime())
    throw gone("link_expired", "this link has expired");
  if (VIEW_CLOSED.has(deal.state)) throw gone("link_closed", "this purchase is closed");
  return {
    linkId: link.id,
    dealId: deal.id,
    partyId: link.partyId,
    purpose: link.purpose,
    role: await sideOf(db, deal.id, link.partyId),
    principal: link.tokenHash,
    deal,
  };
}

// ---- the guard ----------------------------------------------------------------------------------------------------

/** One party-facing string: a banned word is replaced by a fixed line, and ID or phone numbers are masked. */
export const guardPortalText = (s: string): string => (partyBanned(s) ? SAY_AGENT : maskPiiText(s));
/** Every string of a response passes the guard, whatever put it there. */
export function guardPortal<T>(x: T): T {
  if (typeof x === "string") return guardPortalText(x) as T;
  if (Array.isArray(x)) return x.map(guardPortal) as T;
  if (x && typeof x === "object")
    return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, guardPortal(v)])) as T;
  return x;
}

// ---- reading ------------------------------------------------------------------------------------------------------

/** What a party reads about a failed document check: fixed words by reason code, never the check's own text. */
const REASON_WORDS: Record<string, (label: string) => string> = {
  document_missing: (l) => `${l} not received yet.`,
  passport_expired: () => "Passport expired. Please upload a valid one.",
  document_expired: (l) => `${l} expired. Please upload a valid one.`,
  photo_unreadable: (l) => `${l} could not be read. Please upload a clearer photo.`,
  name_differs_title_deed: (l) => `The name on your ${l} differs from the title deed. Please check with your agent.`,
  name_differs_deal: (l) => `The name on your ${l} differs from the name on the deal. Please check with your agent.`,
  wrong_document: () => "That is not the document we asked for. Please upload the right one.",
  additional_documents: () => "Additional documents needed.",
};

/**
 * Whether the deal has an open compliance matter. It is the same for every person on the deal, so nobody can tell from
 * the page whether they are the one it concerns (no tipping-off, S42).
 */
async function underReview(db: SpaDb, dealId: string): Promise<boolean> {
  const rows = await db
    .select({ id: amlCases.id })
    .from(amlCases)
    .where(and(eq(amlCases.dealId, dealId), inArray(amlCases.status, ["open", "info_requested"])))
    .limit(1);
  return rows.length > 0;
}

/** The documents a person is asked for, whether each is in, and what needs doing again, in party words. */
async function documentsView(ctx: SpaContext, s: PortalScope) {
  const db = ctx.database.db;
  const me = (await dealKycParties(db, s.dealId)).find((p) => p.partyId === s.partyId);
  if (!me) return { fields: [], attention: [] as string[], underReview: false };
  const mine = await currentDocuments(db, s.dealId, me);
  const fields = (await documentFields(db, s.deal, me)).map((f) => ({
    kind: f.kind,
    label: f.label,
    help: f.help,
    required: f.required,
    state: mine.some((d) => d.kind === f.kind) ? ("received" as const) : ("needed" as const),
  }));
  const open = (await openChaseItems(db, s.deal, ctx.clock.today())).find((p) => p.partyId === s.partyId);
  const attention = (open?.items ?? []).map((i) => (REASON_WORDS[i.reason] ?? (() => SAY_AGENT))(i.label));
  return { fields, attention, underReview: await underReview(db, s.dealId) };
}

/** What the upload page shows (a `documents` link): the person's own document list and nothing about the plan. */
export async function portalDocumentsPage(ctx: SpaContext, token: string) {
  const s = await loadPortal(ctx, token, "documents");
  const d = await documentsView(ctx, s);
  const [link] = await ctx.database.db
    .select({ e: portalLinks.expiresAt })
    .from(portalLinks)
    .where(eq(portalLinks.id, s.linkId));
  return guardPortal({
    ref: s.deal.ref,
    property: await propertyLabel({ db: ctx.database.db }, s.deal),
    role: s.role,
    ...d,
    expiresAt: link!.e!.toISOString(),
    accepted: "PDF or an image (JPEG, PNG or WebP), up to 10 MB each",
  });
}

/** "You sign 2 of 3": the person's place in the signing order, no names. */
async function signingView(db: SpaDb, dealId: string, partyId: string) {
  const [env] = await db
    .select()
    .from(signingEnvelopes)
    .where(and(eq(signingEnvelopes.dealId, dealId), ne(signingEnvelopes.status, "superseded")))
    .orderBy(desc(signingEnvelopes.createdAt))
    .limit(1);
  if (!env) return null;
  const all = await db.select().from(signatures).where(eq(signatures.envelopeId, env.id));
  const mine = all.find((x) => x.partyId === partyId);
  if (!mine) return null;
  return { position: mine.seq, of: all.length, signed: !!mine.signedAt };
}

const nextStep = (
  s: PortalScope,
  docs: Awaited<ReturnType<typeof documentsView>>,
  signing: Awaited<ReturnType<typeof signingView>>,
): { title: string; body: string } => {
  if (docs.underReview)
    return { title: "Under review", body: "There is nothing for you to do right now. Your agent will be in touch." };
  if (docs.attention.length || docs.fields.some((f) => f.required && f.state === "needed"))
    return {
      title: "Send your documents",
      body: "Use the upload link in the email your agent sent you. If you cannot find it, ask your agent for a new one.",
    };
  if (s.deal.state === "SIGNING" && signing && !signing.signed)
    return { title: "Sign your agreement", body: "Use the signing link in your email. Each person signs in turn." };
  return { title: "Nothing to do right now", body: PARTY_STATE_WORDS[s.deal.state] };
};

/** What the status page shows (a `view` link): this deal's words, this person's documents, plan, transfer day and signing place. */
export async function portalStatus(ctx: SpaContext, token: string) {
  const s = await loadPortal(ctx, token, "view");
  const db = ctx.database.db;
  const d = s.deal;
  const docs = await documentsView(ctx, s);
  const signing = await signingView(db, d.id, s.partyId);
  const flags = { sellerMortgage: d.sellerMortgage, buyerMortgage: d.buyerMortgage, planTakenOver: d.planTakenOver };
  const step = stepsFor(d.dealType, flags).find((x) => x.states.includes(d.state));
  const rows = s.role === "buyer" ? await planCoverage(db, d.id) : [];
  return guardPortal({
    role: s.role,
    ref: d.ref,
    property: await propertyLabel({ db }, d),
    step: step?.label ?? null,
    status: PARTY_STATE_WORDS[d.state],
    next: nextStep(s, docs, signing),
    documents: {
      fields: docs.fields.map((f) => ({ label: f.label, state: f.state })),
      attention: docs.attention,
      underReview: docs.underReview,
    },
    plan: rows.length
      ? {
          instalments: rows.map((r) => ({
            label: r.label,
            dueOn: r.dueOn,
            milestone: r.milestone,
            amountFils: r.amountFils,
            amount: formatAed(r.amountFils),
            paidFils: r.paidFils,
            paid: formatAed(r.paidFils),
            state:
              r.paidFils >= r.amountFils ? ("paid" as const) : r.paidFils > 0 ? ("part" as const) : ("due" as const),
          })),
        }
      : null,
    transferDay: d.targetTransferOn,
    signing: signing ? { position: signing.position, of: signing.of, signed: signing.signed } : null,
  });
}

// ---- acting -------------------------------------------------------------------------------------------------------

/**
 * A party uploads one document through a `documents` link. The person is the token's, the kind must be a document field
 * of that person's KYC config, and the file is checked like staff uploads (PDF or image by its first bytes, 10 MB). A
 * readable kind is queued for the reader as for staff. 30 uploads an hour per link.
 */
export async function portalUpload(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  store: DocumentStore,
  token: string,
  input: { kind: unknown; fileName: string; bytes: Uint8Array },
): Promise<{ received: true; label: string }> {
  const s = await loadPortal(ctx, token, "documents");
  if (
    !(await takeRateLimit(ctx, {
      key: s.principal,
      bucket: `portal-upload:${hourBucket(ctx)}`,
      limit: PORTAL_UPLOADS_PER_HOUR,
    }))
  )
    throw tooMany("too many uploads this hour, please try again later");
  const me = (await dealKycParties(ctx.database.db, s.dealId)).find((p) => p.partyId === s.partyId);
  if (!me) throw notFound("link");
  const field = (await documentFields(ctx.database.db, s.deal, me)).find((f) => f.kind === input.kind);
  if (!field) throw unprocessable("kind_not_asked", "That is not one of the documents we asked you for.");
  const r = await storeDealDocument(
    ctx,
    store,
    s.dealId,
    { kind: input.kind, fileName: input.fileName, bytes: input.bytes, partyId: s.partyId },
    `party:${s.partyId}`,
    { type: "PARTY_DOCUMENT_UPLOADED", payload: { linkId: s.linkId } },
  );
  if (PROFILE_OF_KIND[field.kind as keyof typeof PROFILE_OF_KIND])
    await enqueueDocumentRead(ctx, boss, r.id).catch((e) => {
      if (!(e instanceof SpaDomainError && e.code === "helper_off"))
        console.error("document read not queued:", e instanceof Error ? e.message : e);
    });
  return { received: true, label: field.label };
}

/**
 * "Send my documents": queues the person's check (one job per party and set of documents, so twice is once) and uses
 * the link up. The portal opens no gate; the KYC or company-check run does, as for staff. A link already used is 410.
 */
export async function sendPortalDocuments(
  ctx: SpaContext,
  boss: Pick<PgBoss, "send">,
  token: string,
): Promise<{ sent: true }> {
  const s = await loadPortal(ctx, token, "documents");
  const db = ctx.database.db;
  const me = (await dealKycParties(db, s.dealId)).find((p) => p.partyId === s.partyId);
  if (!me) throw notFound("link");
  if (!(await currentDocuments(db, s.dealId, me)).length)
    throw unprocessable("nothing_uploaded", "Upload at least one document first.");
  try {
    if (PERSON_KYC_ROLES.includes(me.role)) await enqueueKycRun(ctx, boss, { dealId: s.dealId, partyId: s.partyId });
    else if (me.role === "company_party")
      await enqueueCompanyCheck(ctx, boss, { dealId: s.dealId, partyId: s.partyId });
  } catch (e) {
    // The check is switched off for this deal (S59): the documents are in and staff read them by hand.
    if (!(e instanceof SpaDomainError && e.code === "helper_off")) throw e;
  }
  const used = await withSpaTx(ctx.database, async (tx) => {
    const done = await tx.db
      .update(portalLinks)
      .set({ usedAt: ctx.clock.now() })
      .where(and(eq(portalLinks.id, s.linkId), isNull(portalLinks.usedAt), isNull(portalLinks.supersededAt)))
      .returning({ id: portalLinks.id });
    if (!done.length) return false;
    await appendDealEvent(tx, ctx, {
      entity: { kind: "deal", id: s.dealId },
      type: "PORTAL_DOCUMENTS_SENT",
      actor: `party:${s.partyId}`,
      rulesVersion: s.deal.rulesVersion,
      payload: { linkId: s.linkId },
    });
    return true;
  });
  if (!used) throw gone("link_used", "this link has already been used");
  return { sent: true };
}

/**
 * Tells the buyers and sellers of a deal something by email with their own read-only status link (transfer booked,
 * registered). One mail per person and `key`; a mail already sent is not sent again. A failure is stored with the
 * message and never stops the step that caused it.
 */
export async function mailDealParties(
  ctx: SpaContext,
  dealId: string,
  key: string,
  parts: (i: { name: string; property: string; link: string }) => SpaMailParts,
): Promise<void> {
  if (!ctx.mail) return;
  const db = ctx.database.db;
  const [deal] = await db.select().from(deals).where(eq(deals.id, dealId));
  if (!deal) return;
  const property = await propertyLabel({ db }, deal);
  const people = (await dealKycParties(db, dealId)).filter((p) => p.role !== "beneficial_owner");
  for (const p of people) {
    const [row] = await db.select({ email: parties.email }).from(parties).where(eq(parties.id, p.partyId));
    if (!row) continue;
    await sendWithViewLink(ctx, {
      dealId,
      partyId: p.partyId,
      purpose: "notice",
      milestone: `${key}:${p.partyId}`,
      to: row.email,
      by: "system:portal",
      parts: (link) => parts({ name: p.name, property, link }),
    }).catch((e) => console.error("portal mail not sent:", e instanceof Error ? e.message : e));
  }
}
