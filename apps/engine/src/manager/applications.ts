import {
  documentsChaseEmail,
  documentsRequestEmail,
  formatDubaiDateTime,
  type MailReceipt,
  offerAcceptedEmail,
  noShowFollowupEmail,
  offerEmail,
  sniffImage,
  stripImageMetadata,
  viewingInvitationEmail,
  viewingReminderEmail,
} from "@leasing/adapters";
import {
  type Actor,
  addDays,
  type CalendarDate,
  type CompanyPolicy,
  diffDays,
  formatAed,
  type InboundType,
  maskPiiText,
  newId,
  type OfferResponded,
  type OfferTerms,
  startOfDubaiDay,
} from "@leasing/core";
import { sha256Hex, shortRef } from "@leasing/core/tokens";
import {
  actionLinks,
  applications,
  approvals,
  deadlines,
  documents,
  inboundEvents,
  leaseEvents,
  leaseParties,
  leases,
  outboundMessages,
  parties,
  tasks,
  type Tx,
  units,
  withTx,
} from "@leasing/db";
import {
  KYC_DEFAULT_TIMEOUT_MS,
  KycSchemas,
  kycHelper,
  OfferContext,
  OfferData,
  OfferReplyContext,
  OfferReplyData,
  offerHelper,
  offerProblems,
  offerReplyClassifier,
} from "@leasing/helpers";
import { rulesVersionForTerm } from "@leasing/rulebook";
import { and, asc, eq, gt, inArray, isNull, lt, ne } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, notFound, unprocessable } from "../errors.ts";
import { logKycStep } from "./kyc-check.ts";
import { advance, unitHasContractedLease } from "./advance.ts";
import { requestApproval } from "./approvals.ts";
import { companyLandlord } from "./company-legal.ts";
import { appendEvent, getCompanyPolicy, getCompanyPolicyVersion } from "./events.ts";
import { noteDefaultLimits, offerPolicyAndRuleFor } from "./pricing.ts";
import type { KycReviewProposal, OfferLimitsProposal } from "./gate-rules.ts";
import { recordRun, runAndRecord, runOnly } from "./helpers.ts";
import type { InboundRequest } from "./inbound.ts";
import { INBOUND_JOB } from "./inbound.ts";
import { CONTRACT_PREPARE_JOB } from "./contracts.ts";
import { createLink, type LinkRow } from "./links.ts";
import { createTask, DEADLINE_JOB } from "./milestones.ts";
import { type Autopilot, autopilotNow, hoursFrom, quietNow, scheduleTimed, sendTime } from "./agent-switches.ts";

/**
 * Steps 3–4 for a new tenant (architecture §3 Application, §8a): an application gets a one-time
 * upload link for ID documents; the KYC helper reads and checks them; the offer goes out within
 * company limits; the applicant answers in the portal; an officer records the reservation; the
 * engine creates the lease in CONTRACT. Every state change goes through `advance`.
 */
export const APPLICATION_MAIL_JOB = "application.mail";
export type ApplicationMailKind =
  | "viewing"
  | "docs"
  | "offer"
  | "accepted"
  // Switches (D37): sent by the same job, so every one is stored with its SMTP evidence.
  | "viewing_reminder"
  | "no_show"
  | "docs_chase";
/** Held offers released by `held_offer_auto_release`. */
export const HELD_OFFER_RELEASE_JOB = "offer.release";

type AppRow = typeof applications.$inferSelect;
type UnitRow = typeof units.$inferSelect;

const MAX_DOC_BYTES = 10 * 1024 * 1024;
const MAX_DOCS = 10;
const MAX_UPLOADS_PER_LINK = 25;
const appRef = (app: AppRow) => app.ref ?? app.id.slice(0, 8);
const unitLabel = (u: UnitRow) => `${u.unitNo ?? u.code}, ${u.building}`;
const unitAddress = (u: UnitRow) =>
  [u.unitNo ? `Unit ${u.unitNo}` : null, u.building, u.community, "Dubai"].filter(Boolean).join(", ");
const task = (ctx: EngineContext, tx: Tx, appId: string, t: Parameters<typeof createTask>[3]) =>
  createTask(ctx, tx, appId, t, "application");

// ---------------------------------------------------------------- create, screening

export interface NewApplication {
  unitId: string;
  nameEn: string;
  email: string;
  phone?: string | null;
  kind: "individual" | "company";
  requestedMoveInOn?: CalendarDate | null;
  /** Books the viewing in the same transaction; its invitation is the applicant's first email. */
  viewingAt?: Date | null;
  /** Staff by default; the Telegram bot (D24) and a confirmed copilot proposal (D25) book their own. */
  source?: "staff" | "telegram" | "copilot" | "web_chat" | "web_form";
}

/** Application states that count as open (one person, one open application per unit). */
export const OPEN_APPLICATION_STATES = ["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"] as const;
/** Open web-form plus web-chat applications one email address may hold at once (decision D31). */
export const MAX_OPEN_WEB_PER_EMAIL = 3;

/** The open applications under this email address, any source. */
export async function openApplicationsFor(tx: Tx, email: string) {
  return tx.db
    .select({
      unitId: applications.unitId,
      source: applications.source,
      state: applications.state,
      viewingAt: applications.viewingAt,
    })
    .from(applications)
    .innerJoin(parties, eq(parties.id, applications.partyId))
    .where(and(eq(parties.email, email), inArray(applications.state, [...OPEN_APPLICATION_STATES])));
}

/** How many open applications this email holds that came in through the public form or the web chat. */
export async function openWebApplicationsFor(tx: Tx, email: string): Promise<number> {
  return (await openApplicationsFor(tx, email)).filter((o) => o.source === "web_form" || o.source === "web_chat")
    .length;
}

/**
 * Staff (or the Telegram bot, for an enquirer) enter an applicant for a listed unit. IDs come
 * later, only from verified documents. `inTx` joins the caller's transaction.
 */
export async function createApplication(ctx: EngineContext, input: NewApplication, actor: Actor, inTx?: Tx) {
  if (input.viewingAt && input.viewingAt.getTime() <= ctx.clock.now().getTime()) {
    throw unprocessable("the viewing time must be in the future", [], "viewing_in_past");
  }
  const run = async (tx: Tx) => {
    const [unit] = await tx.db.select().from(units).where(eq(units.id, input.unitId)).for("update");
    if (!unit) throw notFound("unit");
    if (unit.state !== "LISTED") throw conflict(`unit ${unit.code} is ${unit.state}, not listed`, "unit_not_listed");
    if (!unit.askingRentFils) throw conflict(`unit ${unit.code} has no approved asking rent`, "no_price");
    if (await unitHasContractedLease(tx, unit.id)) {
      throw conflict(`unit ${unit.code} already has a lease being signed`, "unit_contracted");
    }
    const partyId = newId();
    await tx.db.insert(parties).values({
      id: partyId,
      kind: input.kind,
      fullNameEn: input.nameEn.trim(),
      email: input.email.trim().toLowerCase(),
      phone: input.phone?.trim() || null,
    });
    const id = newId();
    const ref = shortRef("A");
    await tx.db.insert(applications).values({
      id,
      unitId: unit.id,
      partyId,
      state: "ENQUIRY",
      source: input.source ?? "staff",
      ref,
      requestedMoveInOn: input.requestedMoveInOn ?? null,
    });
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id },
      type: "APPLICATION_CREATED",
      actor,
      payload: { unitId: unit.id, unitCode: unit.code, ref, kind: input.kind, source: input.source ?? "staff" },
      rulesVersion: ctx.rulesVersion,
    });
    if (input.viewingAt) await bookViewing(ctx, id, input.viewingAt, actor, tx);
    return { id, ref, partyId };
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

/**
 * ENQUIRY → VIEWING: books the viewing; entering VIEWING emails the invitation (time in Dubai,
 * property page, tour). The time must be in the future (by the Clock).
 */
export async function bookViewing(ctx: EngineContext, applicationId: string, viewingAt: Date, actor: Actor, inTx?: Tx) {
  if (viewingAt.getTime() <= ctx.clock.now().getTime()) {
    throw unprocessable("the viewing time must be in the future", [], "viewing_in_past");
  }
  const run = async (tx: Tx) => {
    const [found] = await tx.db
      .select({ unitId: applications.unitId })
      .from(applications)
      .where(eq(applications.id, applicationId));
    if (!found) throw notFound("application");
    // The unit row first (same order as createApplication), so two bookings on one unit are
    // served one after the other and the second sees the first.
    await tx.db.select({ id: units.id }).from(units).where(eq(units.id, found.unitId)).for("update");
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "ENQUIRY")
      throw conflict(`application is ${app.state}, not an enquiry`, "transition_not_allowed");
    const { viewingSlotMinutes } = await getCompanyPolicy(tx, ctx.clock.today());
    const clash = await clashingViewing(tx, app.unitId, app.id, viewingAt, viewingSlotMinutes);
    if (clash) {
      throw conflict(
        `another viewing of this unit is booked at ${formatDubaiDateTime(clash)}; viewings need ${viewingSlotMinutes} minutes between them`,
        "viewing_slot_taken",
      );
    }
    await tx.db.update(applications).set({ viewingAt }).where(eq(applications.id, app.id));
    const moved = await advance(ctx, { kind: "application", id: app.id }, "VIEWING_BOOKED", {
      actor,
      tx,
      payload: { viewingAt: viewingAt.toISOString() },
    });
    await queueViewingReminder(ctx, tx, app.id, viewingAt);
    return moved;
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

/**
 * A booked viewing on the unit (staff or Telegram) less than one slot length away from `at`, if
 * any. One unit, one viewing per slot, whoever books it.
 */
async function clashingViewing(
  tx: Tx,
  unitId: string,
  exceptApplicationId: string,
  at: Date,
  slotMinutes: number,
): Promise<Date | null> {
  const slotMs = slotMinutes * 60_000;
  const rows = await tx.db
    .select({ at: applications.viewingAt })
    .from(applications)
    .where(
      and(
        eq(applications.unitId, unitId),
        eq(applications.state, "VIEWING"),
        ne(applications.id, exceptApplicationId),
        gt(applications.viewingAt, new Date(at.getTime() - slotMs)),
        lt(applications.viewingAt, new Date(at.getTime() + slotMs)),
      ),
    )
    .limit(1);
  return rows[0]?.at ?? null;
}

/**
 * A leasing officer or manager records the viewing. Attended → SCREENING (the upload link goes
 * out); no-show → WITHDRAWN, allowed only once the booked time has passed. The applicant must
 * apply again after a no-show.
 */
export async function recordViewingOutcome(
  ctx: EngineContext,
  applicationId: string,
  outcome: "attended" | "no_show",
  note: string | null,
  actor: Actor,
) {
  return withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "VIEWING")
      throw conflict(`application is ${app.state}, not waiting for a viewing`, "not_viewing");
    const now = ctx.clock.now();
    if (outcome === "no_show" && app.viewingAt && now.getTime() < app.viewingAt.getTime()) {
      throw unprocessable("the viewing time hasn't passed yet", [], "viewing_not_due");
    }
    // Staff free text: mask any ID or phone number typed into it before it reaches the audit log.
    const masked = note ? maskPiiText(note) : null;
    await tx.db
      .update(applications)
      .set({ viewingOutcome: outcome, viewingOutcomeAt: now })
      .where(eq(applications.id, app.id));
    if (outcome === "attended")
      return advance(ctx, { kind: "application", id: app.id }, "APPLIED", {
        actor,
        tx,
        payload: { viewingOutcome: "attended", note: masked },
      });
    const moved = await advance(ctx, { kind: "application", id: app.id }, "VIEWING_NO_SHOW", {
      actor,
      tx,
      payload: { viewingOutcome: "no_show", note: masked },
    });
    await queueNoShowFollowup(ctx, tx, app.id);
    return moved;
  });
}

/** Staff apply for an enquiry that has no viewing; the engine refuses it unless `apply_without_viewing` is on. */
export async function applyWithoutViewing(ctx: EngineContext, applicationId: string, actor: Actor, inTx?: Tx) {
  const run = async (tx: Tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "ENQUIRY") throw conflict(`application is ${app.state}, not an enquiry`, "wrong_state");
    return advance(ctx, { kind: "application", id: applicationId }, "APPLIED", { actor, tx });
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

/** A fresh upload link (e.g. after a KYC review asked for new documents). */
export async function requestDocuments(ctx: EngineContext, applicationId: string, actor: Actor, inTx?: Tx) {
  const run = async (tx: Tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "SCREENING") throw conflict(`application is ${app.state}, not waiting for documents`);
    // Earlier upload links stop working; the new email carries the only valid one.
    await tx.db
      .update(actionLinks)
      .set({ usedAt: ctx.clock.now() })
      .where(and(eq(actionLinks.entityId, app.id), eq(actionLinks.purpose, "kyc_upload"), isNull(actionLinks.usedAt)));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "DOCUMENTS_REQUESTED",
      actor,
      payload: {},
      rulesVersion: ctx.rulesVersion,
    });
    const seq = await nextMailSeq(tx, app.id, "docs");
    await queueMail(ctx, tx, app.id, "docs", seq);
    await queueDocsChase(ctx, tx, app.id, seq);
    return { seq };
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

/** Work on entering a state (called by `advance` in the same transaction). */
export async function onEnterApplication(
  ctx: EngineContext,
  tx: Tx,
  app: AppRow,
  from: string,
  actor: Actor,
  // Internal, for the demo seed only: overrides the company's autopilot flags for this entry.
  // Never exposed through an HTTP route.
  opts?: OfferEntryOpts,
) {
  switch (app.state) {
    case "VIEWING":
      await queueMail(ctx, tx, app.id, "viewing", await nextMailSeq(tx, app.id, "viewing"));
      return;
    case "SCREENING": {
      const seq = await nextMailSeq(tx, app.id, "docs");
      await queueMail(ctx, tx, app.id, "docs", seq);
      await queueDocsChase(ctx, tx, app.id, seq);
      return;
    }
    case "OFFER": {
      if (from === "SCREENING") await proposeFirstOffer(ctx, tx, app, opts);
      else if (app.offer) {
        // An in-limits counter made by the helper can be held for an officer. A revision a
        // manager approved (out of limits) was already decided by a person: it goes out.
        const counter = actor === "helper:offer";
        if (counter && !(await autopilotFlag(ctx, tx, "auto_send_counter", opts))) {
          await holdOffer(ctx, tx, app, app.offer.revision, opts);
        } else {
          await scheduleOfferExpiry(ctx, tx, app, app.offer);
          await queueMail(ctx, tx, app.id, "offer", app.offer.revision);
        }
      }
      return;
    }
    case "RESERVED": {
      const leaseId = await createLeaseFromApplication(ctx, tx, app, actor);
      // Step 5 starts on its own (the contract is prepared by a job, it renders a PDF), unless
      // the company switched automatic preparation off: then an officer prepares it.
      const pol = await getCompanyPolicyVersion(tx, ctx.clock.today());
      if (pol.values.autopilot.auto_prepare_contract) {
        await ctx.scheduler.send(tx, {
          name: CONTRACT_PREPARE_JOB,
          data: { leaseId },
          singletonKey: `${leaseId}:contract-prepare`,
        });
      } else {
        await appendEvent(tx, ctx, {
          entity: { kind: "lease", id: leaseId },
          type: "CONTRACT_PREP_HELD",
          actor: "system",
          payload: { policyVersion: pol.version },
        });
        await createTask(ctx, tx, leaseId, {
          kind: "prepare_contract",
          title: "Prepare the contract",
          details: { policyVersion: pol.version },
          assigneeRole: "leasing_officer",
          dueOn: ctx.clock.today(),
          dedupeKey: `${leaseId}:prepare_contract`,
        });
      }
      await advance(ctx, { kind: "application", id: app.id }, "LEASE_CREATED", {
        actor: "system",
        tx,
        payload: { leaseId },
      });
      return;
    }
    case "CONVERTED": {
      // The unit is let: other applications for it close (their applicants are told by staff).
      const siblings = await tx.db
        .select({ id: applications.id })
        .from(applications)
        .where(
          and(
            eq(applications.unitId, app.unitId),
            ne(applications.id, app.id),
            inArray(applications.state, ["ENQUIRY", "VIEWING", "SCREENING", "OFFER"]),
          ),
        );
      for (const sib of siblings) {
        await advance(ctx, { kind: "application", id: sib.id }, "WITHDRAWN", {
          actor: "system",
          tx,
          payload: { reason: "the unit was let to another applicant", otherApplicationId: app.id },
        });
      }
      return;
    }
    case "REJECTED":
    case "WITHDRAWN":
      await closeOpenWork(ctx, tx, app.id);
      return;
  }
}

/** Cancels pending approvals of the given gates on an application (null = all), with an event each. */
async function cancelPending(
  ctx: EngineContext,
  tx: Tx,
  appId: string,
  gates: ("kyc_review" | "offer_out_of_limits")[] | null,
  reason: string,
) {
  const rows = await tx.db
    .select({ id: approvals.id, gate: approvals.gate })
    .from(approvals)
    .where(and(eq(approvals.entityId, appId), eq(approvals.status, "pending")));
  for (const r of rows.filter((x) => !gates || (gates as string[]).includes(x.gate))) {
    await tx.db
      .update(approvals)
      .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: reason })
      .where(eq(approvals.id, r.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: appId },
      type: "APPROVAL_CANCELLED",
      actor: "system",
      payload: { approvalId: r.id, gate: r.gate, reason },
      rulesVersion: ctx.rulesVersion,
    });
  }
}

async function closeOpenWork(ctx: EngineContext, tx: Tx, appId: string) {
  await cancelPending(ctx, tx, appId, null, "application closed");
  await tx.db
    .update(tasks)
    .set({ status: "cancelled" })
    .where(and(eq(tasks.entityId, appId), eq(tasks.status, "open")));
  await tx.db
    .update(deadlines)
    .set({ status: "cancelled", note: "application closed" })
    .where(and(eq(deadlines.entityId, appId), eq(deadlines.status, "pending")));
  await tx.db
    .update(actionLinks)
    .set({ usedAt: ctx.clock.now() })
    .where(and(eq(actionLinks.entityId, appId), eq(actionLinks.singleUse, true)));
}

// ---------------------------------------------------------------- documents (portal)

/** The application behind an upload link, if the link may still upload. */
async function uploadTarget(tx: Tx, link: LinkRow | null): Promise<AppRow> {
  if (!link || link.purpose !== "kyc_upload" || link.entityKind !== "application") throw notFound("upload link");
  if (link.usedAt) throw conflict("These documents were already sent for checking. Use the newest email from us.");
  const [app] = await tx.db.select().from(applications).where(eq(applications.id, link.entityId)).for("update");
  if (!app || app.state !== "SCREENING") throw conflict("This application isn't waiting for documents any more.");
  return app;
}

/**
 * Stores one uploaded ID image under UPLOADS_DIR: JPEG/PNG/WebP only (by content, not name),
 * 10 MB at most, metadata (EXIF/GPS) stripped, content-addressed. Not checked yet: the applicant
 * submits the set for checking when done.
 */
export async function addApplicationDocument(
  ctx: EngineContext,
  link: LinkRow | null,
  bytes: Uint8Array,
  kind: "emirates_id" | "passport" | "visa" | "trade_licence",
  side: "front" | "back" | "page",
) {
  if (bytes.byteLength > MAX_DOC_BYTES) throw unprocessable("the photo is larger than 10 MB", [], "too_large");
  const type = sniffImage(bytes);
  if (!type) throw unprocessable("only JPEG, PNG or WebP photos of the document", [], "unsupported_type");
  // Validate the link before writing anything to disk.
  await withTx(ctx.database, (tx) => uploadTarget(tx, link));
  const clean = stripImageMetadata(bytes, type);
  if (!clean) throw unprocessable("the photo file looks damaged; take it again and retry", [], "unsupported_type");
  const stored = await ctx.uploads.put(clean, type.ext);
  return withTx(ctx.database, async (tx) => {
    const app = await uploadTarget(tx, link);
    const existing = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.applicationId, app.id), eq(documents.status, "uploaded")));
    const dup = existing.find((d) => d.sha256 === stored.sha256);
    if (dup) return { id: dup.id, kind: dup.kind, side: dup.side, bytes: dup.bytes, duplicate: true };
    if (existing.length >= MAX_DOCS)
      throw unprocessable(`at most ${MAX_DOCS} documents per application`, [], "too_many");
    // Every upload through one link counts, removed ones too, so a link can't fill the disk.
    const viaLink = await tx.db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.uploadedViaLinkId, link!.id));
    if (viaLink.length >= MAX_UPLOADS_PER_LINK) {
      throw unprocessable("too many uploads on this link; ask the leasing team for a new one", [], "too_many");
    }
    const id = newId();
    await tx.db.insert(documents).values({
      id,
      partyId: app.partyId,
      applicationId: app.id,
      kind,
      side,
      sha256: stored.sha256,
      path: stored.path,
      mime: type.mime,
      bytes: stored.bytes,
      status: "uploaded",
      uploadedViaLinkId: link!.id,
    });
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "DOCUMENT_UPLOADED",
      actor: `tenant:${app.partyId}`,
      payload: { documentId: id, kind, side, sha256: stored.sha256, bytes: stored.bytes },
      rulesVersion: ctx.rulesVersion,
    });
    return { id, kind, side, bytes: stored.bytes, duplicate: false };
  });
}

/** Removes an upload that hasn't been sent for checking yet (the file stays content-addressed). */
export async function removeApplicationDocument(ctx: EngineContext, link: LinkRow | null, documentId: string) {
  return withTx(ctx.database, async (tx) => {
    const app = await uploadTarget(tx, link);
    const [doc] = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.id, documentId), eq(documents.applicationId, app.id), eq(documents.status, "uploaded")));
    if (!doc) throw notFound("document");
    await tx.db.update(documents).set({ status: "rejected" }).where(eq(documents.id, doc.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "DOCUMENT_REMOVED",
      actor: `tenant:${app.partyId}`,
      payload: { documentId: doc.id },
      rulesVersion: ctx.rulesVersion,
    });
  });
}

export async function uploadedDocuments(tx: Tx, applicationId: string) {
  return tx.db
    .select({ id: documents.id, kind: documents.kind, side: documents.side, bytes: documents.bytes })
    .from(documents)
    .where(and(eq(documents.applicationId, applicationId), eq(documents.status, "uploaded")))
    .orderBy(asc(documents.createdAt));
}

// ---------------------------------------------------------------- inbound (documents submitted, offer answered)

export async function receiveApplicationInbound(
  ctx: EngineContext,
  tx: Tx,
  req: InboundRequest,
  data: unknown,
): Promise<{ ref: string; duplicate: boolean; id: string }> {
  const [app] = await tx.db.select().from(applications).where(eq(applications.id, req.entity.id)).for("update");
  if (!app) throw notFound("application");
  let dedupeKey: string;
  let summary: Record<string, unknown> = {};
  if (req.type === "DOCS_UPLOADED") {
    if (app.state !== "SCREENING") throw conflict("This application isn't waiting for documents.");
    const ids = (data as { documentIds: string[] }).documentIds;
    const docs = await tx.db
      .select({ id: documents.id })
      .from(documents)
      .where(and(eq(documents.applicationId, app.id), eq(documents.status, "uploaded"), inArray(documents.id, ids)));
    if (docs.length !== new Set(ids).size) throw unprocessable("some documents are not part of this application");
    dedupeKey = `docs:${app.id}:${req.linkId ?? sha256Hex(ids.toSorted().join(","))}`;
    summary = { documents: ids.length };
    // Sent for checking: they no longer count as open uploads and can't be submitted again.
    await tx.db.update(documents).set({ status: "submitted" }).where(inArray(documents.id, ids));
  } else if (req.type === "OFFER_RESPONDED") {
    const r = data as OfferResponded;
    if (app.state !== "OFFER" || !app.offer) throw conflict("There's no open offer on this application.");
    if (r.revision !== app.offer.revision)
      throw conflict("This offer has been replaced by a newer one. Use the newest email.");
    if (app.offerAcceptedAt) throw conflict("You already accepted this offer.");
    if (ctx.clock.today() > app.offer.expiresOn) throw conflict("This offer has expired. Contact the leasing team.");
    dedupeKey = `offer:${app.id}#${r.revision}`;
    summary = { choice: r.choice, revision: r.revision };
  } else {
    throw unprocessable(`${req.type} is not an application form`);
  }
  const id = newId();
  const ref = shortRef("R");
  const [row] = await tx.db
    .insert(inboundEvents)
    .values({
      id,
      ref,
      type: req.type as InboundType,
      entityKind: "application",
      entityId: app.id,
      channel: req.channel,
      actor: req.actor,
      linkId: req.linkId ?? null,
      dedupeKey,
      payload: data as Record<string, unknown>,
      receivedAt: ctx.clock.now(),
    })
    .onConflictDoNothing({ target: inboundEvents.dedupeKey })
    .returning();
  if (!row) {
    const [prev] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.dedupeKey, dedupeKey));
    return { ref: prev?.ref ?? "", duplicate: true, id: prev?.id ?? "" };
  }
  if (req.linkId) {
    await tx.db
      .update(actionLinks)
      .set({ usedAt: ctx.clock.now() })
      .where(and(eq(actionLinks.id, req.linkId), eq(actionLinks.singleUse, true)));
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "application", id: app.id },
    type: "INBOUND_RECEIVED",
    actor: req.actor,
    payload: { inboundEventId: id, ref, type: req.type, channel: req.channel, ...summary },
    rulesVersion: ctx.rulesVersion,
  });
  await ctx.scheduler.send(tx, {
    name: INBOUND_JOB,
    data: { inboundEventId: id },
    singletonKey: `${app.id}:inbound:${id}`,
  });
  return { ref, duplicate: false, id };
}

type InboundRow = typeof inboundEvents.$inferSelect;

/** Runs the model work first (its own transaction), then applies the result under a lock. */
export async function processApplicationInbound(ctx: EngineContext, ev: InboundRow, attempt = 1) {
  let model: Awaited<ReturnType<typeof runKyc>> | Awaited<ReturnType<typeof classifyOfferComment>> = null;
  if (ev.type === "DOCS_UPLOADED") model = await runKyc(ctx, ev, attempt);
  if (ev.type === "OFFER_RESPONDED") model = await classifyOfferComment(ctx, ev);

  const outcome = await withTx(ctx.database, async (tx) => {
    const [locked] = await tx.db.select().from(inboundEvents).where(eq(inboundEvents.id, ev.id)).for("update");
    if (!locked || locked.status !== "received") return null;
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, locked.entityId)).for("update");
    if (!app) return null;
    const result =
      locked.type === "DOCS_UPLOADED"
        ? await applyKyc(ctx, tx, app, locked, model as Awaited<ReturnType<typeof runKyc>>, attempt)
        : await applyOfferResponse(ctx, tx, app, locked, model as Awaited<ReturnType<typeof classifyOfferComment>>);
    await tx.db
      .update(inboundEvents)
      .set({ status: result.applied ? "applied" : "stored_only", result: result.detail, processedAt: ctx.clock.now() })
      .where(eq(inboundEvents.id, locked.id));
    return result;
  });
  if (!outcome) return { done: false, reason: "already processed" };
  return { done: true, applied: outcome.applied };
}

interface Applied {
  applied: boolean;
  detail: Record<string, unknown>;
}

/**
 * Reads the records in a short transaction, runs the helper with no transaction open (a model
 * call can take minutes and must not hold a connection), logs each step as it happens, then
 * records the run. Every model call has its own time limit (`KYC_DOC_TIMEOUT_SECONDS`).
 */
async function runKyc(ctx: EngineContext, ev: InboundRow, attempt: number) {
  const prepared = await withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, ev.entityId));
    if (!app || app.state !== "SCREENING") return null;
    const [party] = await tx.db.select().from(parties).where(eq(parties.id, app.partyId));
    const ids = (ev.payload as { documentIds: string[] }).documentIds;
    const docs = await tx.db
      .select()
      .from(documents)
      .where(and(eq(documents.applicationId, app.id), inArray(documents.id, ids)));
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    return { app, party, docs, policy };
  });
  if (!prepared) return null;
  const { app, party, docs, policy } = prepared;
  const today = ctx.clock.today();
  const readImage = async (docId: string) => {
    const d = docs.find((x) => x.id === docId);
    if (!d) throw new Error("document not on this application");
    return new Uint8Array(await ctx.uploads.read(d.path));
  };
  const entity = { kind: "application" as const, id: app.id };
  const helperRunId = newId();
  const began = performance.now(); // diagnostic latency only, not domain time
  const helper = kycHelper(ctx.llm, readImage, {
    timeoutMs: ctx.kyc?.docTimeoutMs ?? KYC_DEFAULT_TIMEOUT_MS,
    onStep: (step) =>
      logKycStep(ctx, app.id, attempt, ev.ref, step, { latencyMs: Math.round(performance.now() - began) }),
  });
  const run = await runOnly(
    ctx,
    helper,
    KycSchemas,
    entity,
    "SCREENING",
    {
      applicant: { nameEn: party?.fullNameEn ?? "", kind: party?.kind ?? "individual" },
      leaseStartOn: app.requestedMoveInOn ?? addDays(today, 14),
      today,
      minValidityDays: policy.kycMinValidityDays,
      minConfidence: policy.kycMinConfidence,
      documents: docs.map((d) => ({
        docId: d.id,
        kind: d.kind as "emirates_id" | "passport" | "visa" | "trade_licence",
        side: (d.side ?? "page") as "front" | "back" | "page",
      })),
    },
    ctx.rulesVersion,
    helperRunId,
  );
  if (run.result.status !== "ok" && run.error) {
    // The runner gave up (invalid answers twice): the log says so too.
    await logKycStep(ctx, app.id, attempt, ev.ref, {
      kind: "result",
      status: "needs_human",
      reason: maskPiiText(run.error),
    });
  }
  await withTx(ctx.database, (tx) => recordRun(ctx, tx, helper.name, entity, ctx.rulesVersion, run, helperRunId));
  return { run, helperRunId };
}

/**
 * Clean KYC → KYC_VERIFIED (the identity is copied from the helper run). Anything flagged → a
 * `kyc_review` approval for a leasing officer; approving it applies KYC_VERIFIED.
 */
async function applyKyc(
  ctx: EngineContext,
  tx: Tx,
  app: AppRow,
  ev: InboundRow,
  kyc: Awaited<ReturnType<typeof runKyc>>,
  attempt = 1,
): Promise<Applied> {
  if (app.state !== "SCREENING" || !kyc) {
    await task(ctx, tx, app.id, {
      kind: "docs_out_of_step",
      title: `Documents for application ${appRef(app)} arrived while it is ${app.state}`,
      details: { inboundRef: ev.ref },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${app.id}:docs_out_of_step:${ev.id}`,
    });
    return { applied: false, detail: { reason: `application is ${app.state}` } };
  }
  const { run, helperRunId } = kyc;
  if (run.result.status !== "ok") {
    // Rule 6: no valid answer, so nothing advances. An officer gets a task; "Retry document check" runs it again.
    const reason = maskPiiText(run.result.reasons[0] ?? "the document check could not finish");
    await task(ctx, tx, app.id, {
      kind: "kyc_check_failed",
      title: `Document check for application ${appRef(app)} needs a person: ${reason}`,
      details: { inboundRef: ev.ref, helperRunId, attempt },
      assigneeRole: "leasing_officer",
      dueOn: ctx.clock.today(),
      dedupeKey: `${app.id}:kyc_check_failed:${ev.id}:${attempt}`,
    });
    return { applied: false, detail: { action: "kyc check failed", reason, helperRunId, attempt } };
  }
  // A check that finally worked closes the "needs a person" task an earlier failed run left open.
  await tx.db
    .update(tasks)
    .set({ status: "cancelled" })
    .where(and(eq(tasks.entityId, app.id), eq(tasks.kind, "kyc_check_failed"), eq(tasks.status, "open")));
  const data = run.result.data;
  const documentIds = (ev.payload as { documentIds: string[] }).documentIds;
  // A newer submission replaces any review still waiting on the earlier one.
  await cancelPending(ctx, tx, app.id, ["kyc_review"], "newer documents were submitted");
  const onFile = data ? await partyWithSameId(tx, app, data.identity) : null;
  const pol = await getCompanyPolicyVersion(tx, ctx.clock.today());
  const autoVerify = pol.values.autopilot.auto_kyc_verify;
  if (data?.verdict === "verified" && !onFile && autoVerify) {
    await advance(ctx, { kind: "application", id: app.id }, "KYC_VERIFIED", {
      actor: "helper:kyc",
      tx,
      payload: { helperRunId, documentIds, inboundRef: ev.ref, policyVersion: pol.version },
    });
    return { applied: true, detail: { action: "verified", helperRunId } };
  }
  const flags: KycReviewProposal["flags"] = data?.flags
    ? [...data.flags]
    : [
        {
          kind: "unreadable" as const,
          message: run.result.reasons.join(" ") || "The documents could not be checked automatically.",
          docId: null,
          blocking: false,
        },
      ];
  if (data?.verdict === "verified" && !onFile && !autoVerify) {
    flags.push({
      kind: "manual_review" as const,
      message: "Automatic KYC verification is switched off.",
      docId: null,
      blocking: false,
    });
  }
  if (onFile) {
    flags.push({
      kind: "id_on_file",
      message: `This Emirates ID is already on file for ${onFile.fullNameEn}. Approving links the application to that record; its name and contact details stay as they are.`,
      docId: null,
      blocking: false,
    });
  }
  const [party] = await tx.db.select().from(parties).where(eq(parties.id, app.partyId));
  const [unit] = await tx.db.select().from(units).where(eq(units.id, app.unitId));
  const proposal: KycReviewProposal = {
    applicationId: app.id,
    helperRunId,
    identity: data?.identity ?? null,
    flags,
    documentIds,
    applicantKind: party?.kind ?? "individual",
    policyVersion: pol.version,
  };
  await requestApproval(ctx, tx, {
    gate: "kyc_review",
    entity: { kind: "application", id: app.id },
    dedupeKey: `${app.id}:kyc_review:${helperRunId}`,
    title: `KYC review: ${party?.fullNameEn ?? "applicant"} for ${unit?.code ?? "unit"}`,
    // Unmasked here: approving copies these values onto the applicant. Views mask them.
    proposal,
    reasons: flags.map((f) => f.message),
    sources: [
      { kind: "helper_run", helperRunId, label: "KYC helper (vision reading + checks)" },
      ...documentIds.map((id) => ({ kind: "document" as const, documentId: id, label: "uploaded document" })),
    ],
    rulesVersion: ctx.rulesVersion,
    proposedBy: "helper:kyc",
    onApproveEvent: "KYC_VERIFIED",
  });
  return { applied: true, detail: { action: "kyc review requested", helperRunId, flags: flags.map((f) => f.kind) } };
}

/** Another party already holding this Emirates ID (individuals only; a company's signatory ID never links). */
export async function partyWithSameId(tx: Tx, app: AppRow, identity: { emiratesIdNo: string | null }) {
  if (!identity.emiratesIdNo) return null;
  const [party] = await tx.db.select({ kind: parties.kind }).from(parties).where(eq(parties.id, app.partyId));
  if (party?.kind !== "individual") return null;
  const [other] = await tx.db
    .select()
    .from(parties)
    .where(and(eq(parties.emiratesIdNo, identity.emiratesIdNo), ne(parties.id, app.partyId)));
  return other ?? null;
}

/**
 * Copies the verified identity onto the applicant's party (never retyped; the name exactly as on
 * the ID). If another party already holds this Emirates ID, the application is linked to that
 * party only when a leasing officer approved it (`allowLink`): the existing record keeps its name
 * and contact details, and only its document numbers and expiry dates are refreshed. Contact
 * details are never overwritten by KYC.
 */
export async function applyVerifiedIdentity(
  ctx: EngineContext,
  tx: Tx,
  app: AppRow,
  identity: NonNullable<KycReviewProposal["identity"]>,
  documentIds: string[],
  opts: { allowLink: boolean; actor: Actor },
): Promise<{ partyId: string; linked: boolean }> {
  const [party] = await tx.db.select().from(parties).where(eq(parties.id, app.partyId)).for("update");
  if (!party) throw notFound("party");
  const company = party.kind === "company";
  const other = await partyWithSameId(tx, app, identity);
  let partyId = party.id;
  if (other) {
    if (!opts.allowLink) {
      throw conflict(
        "this Emirates ID is already on file for another person; a leasing officer must confirm",
        "gate_required",
      );
    }
    partyId = other.id;
    await tx.db.update(applications).set({ partyId }).where(eq(applications.id, app.id));
    await tx.db.update(documents).set({ partyId }).where(eq(documents.applicationId, app.id));
    await tx.db
      .update(parties)
      .set({
        idExpiresOn: identity.idExpiresOn ?? other.idExpiresOn,
        passportNo: identity.passportNo ?? other.passportNo,
        passportExpiresOn: identity.passportExpiresOn ?? other.passportExpiresOn,
        visaNo: identity.visaNo ?? other.visaNo,
        visaExpiresOn: identity.visaExpiresOn ?? other.visaExpiresOn,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(parties.id, other.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "PARTY_LINKED",
      actor: opts.actor,
      payload: {
        fromPartyId: party.id,
        toPartyId: other.id,
        reason: "same Emirates ID, confirmed by a leasing officer",
      },
      rulesVersion: ctx.rulesVersion,
    });
  } else if (company) {
    // The company is the party; the signatory's ID stays with the KYC run and the documents.
    await tx.db
      .update(parties)
      .set({
        fullNameEn: identity.companyName ?? party.fullNameEn,
        tradeLicenceNo: identity.tradeLicenceNo ?? party.tradeLicenceNo,
        tradeLicenceExpiresOn: identity.tradeLicenceExpiresOn ?? party.tradeLicenceExpiresOn,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(parties.id, party.id));
  } else {
    await tx.db
      .update(parties)
      .set({
        fullNameEn: identity.fullNameEn ?? party.fullNameEn,
        nationality: identity.nationality ?? party.nationality,
        birthDate: identity.birthDate ?? party.birthDate,
        emiratesIdNo: identity.emiratesIdNo ?? party.emiratesIdNo,
        idExpiresOn: identity.idExpiresOn ?? party.idExpiresOn,
        passportNo: identity.passportNo ?? party.passportNo,
        passportExpiresOn: identity.passportExpiresOn ?? party.passportExpiresOn,
        visaNo: identity.visaNo ?? party.visaNo,
        visaExpiresOn: identity.visaExpiresOn ?? party.visaExpiresOn,
        updatedAt: ctx.clock.now(),
      })
      .where(eq(parties.id, party.id));
  }
  const verifiedAt = ctx.clock.now();
  const expiryOf = (kind: string) =>
    kind === "emirates_id"
      ? identity.idExpiresOn
      : kind === "passport"
        ? identity.passportExpiresOn
        : kind === "visa"
          ? identity.visaExpiresOn
          : identity.tradeLicenceExpiresOn;
  const docs = await tx.db
    .select()
    .from(documents)
    .where(
      and(eq(documents.applicationId, app.id), inArray(documents.id, documentIds.length ? documentIds : [app.id])),
    );
  for (const d of docs) {
    await tx.db
      .update(documents)
      .set({ status: "verified", verifiedAt, expiresOn: expiryOf(d.kind) ?? null })
      .where(eq(documents.id, d.id));
  }
  await tx.db.update(applications).set({ kycVerifiedAt: verifiedAt }).where(eq(applications.id, app.id));
  return { partyId, linked: !!other };
}

// ---------------------------------------------------------------- offer

async function unitAndPolicy(ctx: EngineContext, tx: Tx, app: AppRow) {
  const [unit] = await tx.db.select().from(units).where(eq(units.id, app.unitId));
  if (!unit?.askingRentFils) throw conflict("the unit has no approved asking rent");
  const { policy, contractRuleId } = await offerPolicyAndRuleFor(tx, unit, ctx.clock.today());
  return {
    unit,
    policy,
    contractRuleId,
    unitTerms: { askingRentFils: unit.askingRentFils, furnished: !!unit.furnished },
  };
}

export type OfferEntryOpts = {
  autopilot?: Partial<Pick<CompanyPolicy["autopilot"], "auto_send_offer" | "auto_send_counter">>;
};

async function autopilotFlag(
  ctx: EngineContext,
  tx: Tx,
  flag: "auto_send_offer" | "auto_send_counter",
  opts?: OfferEntryOpts,
): Promise<boolean> {
  const override = opts?.autopilot?.[flag];
  if (override !== undefined) return override;
  return (await getCompanyPolicy(tx, ctx.clock.today())).autopilot[flag];
}

/** The offer stays stored but unsent: an officer task asks for the send. No deadline yet. */
async function holdOffer(ctx: EngineContext, tx: Tx, app: AppRow, revision: number, opts?: OfferEntryOpts) {
  const { version } = await getCompanyPolicyVersion(tx, ctx.clock.today());
  await appendEvent(tx, ctx, {
    entity: { kind: "application", id: app.id },
    type: "OFFER_HELD",
    actor: "system",
    payload: { revision, policyVersion: version, ...(opts?.autopilot ? { autopilotOverride: opts.autopilot } : {}) },
    rulesVersion: ctx.rulesVersion,
  });
  await task(ctx, tx, app.id, {
    kind: "send_offer",
    title: `Send offer revision ${revision} (${appRef(app)})`,
    details: { revision },
    assigneeRole: "leasing_officer",
    dueOn: ctx.clock.today(),
    dedupeKey: `${app.id}:send_offer#${revision}`,
  });
  // `held_offer_auto_release` (D37): if no officer has sent it after N hours, the job tries to send it.
  const a = await autopilotNow(ctx, tx);
  if (a.held_offer_auto_release) {
    await scheduleTimed(ctx, tx, {
      name: HELD_OFFER_RELEASE_JOB,
      data: { applicationId: app.id, revision },
      singletonKey: `${app.id}:offer-release#${revision}`,
      startAfter: sendTime(a, hoursFrom(ctx.clock.now(), a.held_offer_release_hours)),
      entity: { kind: "application", id: app.id },
    });
  }
}

const eventRevision = (e: { payload: unknown }) => (e.payload as { revision?: number } | null)?.revision;

/** Sends the held offer revision: expiry counts from today; one outbound row per revision. */
export async function sendHeldOffer(
  ctx: EngineContext,
  applicationId: string,
  actor: Actor,
  /** The revision the caller meant (the auto-release job): refused if a newer one is held now. */
  expectedRevision?: number,
) {
  const result = await withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "OFFER" || !app.offer) throw conflict("no offer is held", "offer_not_held");
    const revision = app.offer.revision;
    // Under the row lock: the job meant one revision; a newer held one is not its to send.
    if (expectedRevision !== undefined && expectedRevision !== revision)
      throw conflict("no offer is held", "offer_not_held");
    const events = await tx.db
      .select({ type: leaseEvents.type, payload: leaseEvents.payload })
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, app.id), inArray(leaseEvents.type, ["OFFER_HELD", "OFFER_SENT"])));
    const held = events.some((e) => e.type === "OFFER_HELD" && eventRevision(e) === revision);
    const sent = events.some((e) => e.type === "OFFER_SENT" && eventRevision(e) === revision);
    if (!held || sent) throw conflict("no offer is held", "offer_not_held");
    const { unit, policy, contractRuleId, unitTerms } = await unitAndPolicy(ctx, tx, app);
    const today = ctx.clock.today();
    // The policy or the asking rent may have changed while the offer was held: check again now.
    const problems = noteDefaultLimits(offerProblems(app.offer, unitTerms, policy, today), contractRuleId);
    if (problems.length) {
      await askManagerForOffer(ctx, tx, app, unit, { ...app.offer, revision: revision + 1 }, problems, revision, null);
      return { problems };
    }
    const terms: OfferTerms = { ...app.offer, expiresOn: addDays(today, policy.offerValidDays) };
    await tx.db.update(applications).set({ offer: terms }).where(eq(applications.id, app.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "OFFER_SENT",
      actor,
      payload: {
        revision,
        expiresOn: terms.expiresOn,
        policyVersion: (await getCompanyPolicyVersion(tx, today)).version,
      },
      rulesVersion: ctx.rulesVersion,
    });
    await scheduleOfferExpiry(ctx, tx, app, terms);
    await queueMail(ctx, tx, app.id, "offer", revision);
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.dedupeKey, `${app.id}:send_offer#${revision}`), eq(tasks.status, "open")));
    return { revision, expiresOn: terms.expiresOn };
  });
  if ("problems" in result)
    throw unprocessable(
      "the held offer is now outside the company limits; a leasing manager has been asked to approve it",
      result.problems,
      "offer_out_of_limits",
    );
  return result;
}

/**
 * Job (`held_offer_auto_release`): sends a held offer nobody sent, through `sendHeldOffer`, which
 * re-runs the limits check and refuses an offer that is now outside them (it asks a manager
 * instead). The switch, the application's state and the held revision are checked again here.
 * Actor `system:auto-release`. Safe to run twice: a sent revision is no longer held.
 */
export async function autoReleaseHeldOffer(ctx: EngineContext, applicationId: string, revision: number) {
  const state = await withTx(ctx.database, async (tx) => {
    const a = await autopilotNow(ctx, tx);
    if (!a.held_offer_auto_release) return "switch is off";
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId));
    if (!app || app.state !== "OFFER" || app.offer?.revision !== revision) return "the offer moved on";
    const events = await tx.db
      .select({ type: leaseEvents.type, payload: leaseEvents.payload })
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, app.id), inArray(leaseEvents.type, ["OFFER_HELD", "OFFER_SENT"])));
    const held = events.some((e) => e.type === "OFFER_HELD" && eventRevision(e) === revision);
    const sent = events.some((e) => e.type === "OFFER_SENT" && eventRevision(e) === revision);
    if (!held || sent) return "the offer is not held";
    if (quietNow(a, ctx.clock.now())) {
      await scheduleTimed(ctx, tx, {
        name: HELD_OFFER_RELEASE_JOB,
        data: { applicationId, revision },
        singletonKey: `${applicationId}:offer-release#${revision}~${ctx.clock.now().getTime()}`,
        startAfter: sendTime(a, ctx.clock.now()),
        entity: { kind: "application", id: applicationId },
      });
      return "postponed: quiet hours";
    }
    return null;
  });
  if (state) return { released: false as const, reason: state };
  try {
    await sendHeldOffer(ctx, applicationId, "system:auto-release", revision);
    return { released: true as const };
  } catch (e) {
    // Outside the limits now: sendHeldOffer has already asked a leasing manager. Anything else is retried.
    if (e instanceof DomainError && e.code === "offer_out_of_limits")
      return { released: false as const, reason: "outside the company limits: a manager was asked" };
    if (e instanceof DomainError && e.code === "offer_not_held")
      return { released: false as const, reason: "the offer is not held" };
    throw e;
  }
}

async function proposeFirstOffer(ctx: EngineContext, tx: Tx, app: AppRow, opts?: OfferEntryOpts) {
  const { unit, policy, contractRuleId, unitTerms } = await unitAndPolicy(ctx, tx, app);
  const { run, helperRunId } = await runAndRecord(
    ctx,
    tx,
    offerHelper,
    { context: OfferContext, data: OfferData },
    { kind: "application", id: app.id },
    "OFFER",
    {
      mode: "propose",
      today: ctx.clock.today(),
      unit: unitTerms,
      policy,
      revision: 1,
      requestedMoveInOn: app.requestedMoveInOn,
      current: null,
      counter: null,
    },
    ctx.rulesVersion,
  );
  const data = run.result.data;
  if (!data) throw new Error("offer helper failed");
  if (!data.inLimits) {
    await askManagerForOffer(
      ctx,
      tx,
      app,
      unit,
      data.terms,
      noteDefaultLimits(data.problems, contractRuleId),
      null,
      helperRunId,
    );
    return;
  }
  await tx.db.update(applications).set({ offer: data.terms }).where(eq(applications.id, app.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "application", id: app.id },
    type: "OFFER_MADE",
    actor: "helper:offer",
    payload: { revision: 1, terms: data.terms, helperRunId },
    rulesVersion: ctx.rulesVersion,
  });
  if (!(await autopilotFlag(ctx, tx, "auto_send_offer", opts))) {
    await holdOffer(ctx, tx, app, 1, opts);
    return;
  }
  await scheduleOfferExpiry(ctx, tx, app, data.terms);
  await queueMail(ctx, tx, app.id, "offer", 1);
}

async function askManagerForOffer(
  ctx: EngineContext,
  tx: Tx,
  app: AppRow,
  unit: UnitRow,
  terms: OfferTerms,
  problems: string[],
  fromRevision: number | null,
  helperRunId: string | null,
) {
  const proposal: OfferLimitsProposal = { applicationId: app.id, terms, problems, fromRevision };
  await requestApproval(ctx, tx, {
    gate: "offer_out_of_limits",
    entity: { kind: "application", id: app.id },
    dedupeKey: `${app.id}:offer_out_of_limits#${terms.revision}`,
    title: `Offer outside limits: ${unit.code} (application ${appRef(app)}, revision ${terms.revision})`,
    proposal,
    reasons: problems,
    sources: [
      helperRunId
        ? { kind: "helper_run" as const, helperRunId, label: "Offer helper (limits check)" }
        : { kind: "field" as const, label: "Limits check", value: "re-run when the held offer was about to be sent" },
      { kind: "field", label: "Approved asking rent", value: formatAed(terms.askingRentFils) },
    ],
    rulesVersion: ctx.rulesVersion,
    proposedBy: "helper:offer",
    onApproveEvent: "OFFER_REVISED",
  });
}

async function classifyOfferComment(ctx: EngineContext, ev: InboundRow) {
  const reply = ev.payload as OfferResponded;
  if (!reply.comment?.trim()) return null;
  return withTx(ctx.database, async (tx) => {
    const policy = await getCompanyPolicy(tx, ctx.clock.today());
    return runAndRecord(
      ctx,
      tx,
      offerReplyClassifier(ctx.llm),
      { context: OfferReplyContext, data: OfferReplyData },
      { kind: "application", id: ev.entityId },
      "OFFER",
      {
        choice: reply.choice,
        comment: reply.comment ?? "",
        minConfidence: policy.replyMinConfidence,
        legalThreatThreshold: policy.replyLegalThreatThreshold,
        injectionThreshold: policy.replyInjectionThreshold,
      },
      ctx.rulesVersion,
    );
  });
}

/**
 * Buttons are trusted as typed; the comment is classified and never obeyed. Accept is recorded
 * (the reservation is the commitment, recorded by an officer); decline ends the application unless
 * the comment needs a person; a counter becomes a new revision within limits, or a manager decides.
 */
async function applyOfferResponse(
  ctx: EngineContext,
  tx: Tx,
  app: AppRow,
  ev: InboundRow,
  cls: Awaited<ReturnType<typeof classifyOfferComment>>,
): Promise<Applied> {
  const reply = ev.payload as OfferResponded;
  const comment = reply.comment?.trim() || null;
  const today = ctx.clock.today();
  const c = cls?.run.result;
  const base = {
    choice: reply.choice,
    revision: reply.revision,
    inboundRef: ev.ref,
    helperRunId: cls?.helperRunId ?? null,
    classification: c?.data ?? null,
  };
  if (app.state !== "OFFER" || app.offer?.revision !== reply.revision || app.offerAcceptedAt) {
    await task(ctx, tx, app.id, {
      kind: "offer_reply_out_of_step",
      title: `Offer answer (${reply.choice}) for application ${appRef(app)} no longer fits (${app.state})`,
      details: { ...base, comment, untrusted: true },
      assigneeRole: "leasing_officer",
      dueOn: today,
      dedupeKey: `${app.id}:offer_reply_out_of_step:${ev.id}`,
    });
    return { applied: false, detail: { ...base, reason: "offer changed or closed" } };
  }
  const needsPerson = !!comment && (!c?.data || c.data.needsPerson || c.status !== "ok");
  if (needsPerson) {
    await task(ctx, tx, app.id, {
      kind: "offer_reply_review",
      title: `Read the applicant's comment on offer revision ${reply.revision} (${appRef(app)})`,
      details: { ...base, comment, untrusted: true, reasons: c?.reasons ?? ["comment could not be classified"] },
      assigneeRole: "leasing_officer",
      dueOn: today,
      dedupeKey: `${app.id}:offer_reply_review:${ev.id}`,
    });
  }
  await appendEvent(tx, ctx, {
    entity: { kind: "application", id: app.id },
    type: "OFFER_ANSWERED",
    actor: ev.actor as Actor,
    payload: { choice: reply.choice, revision: reply.revision, inboundRef: ev.ref, needsPerson },
    rulesVersion: ctx.rulesVersion,
  });

  if (reply.choice === "accept" && needsPerson) {
    // "I accept if…": acceptance waits until a person has read the comment and spoken to the applicant.
    return {
      applied: false,
      detail: { ...base, action: "acceptance held for review", reason: "the comment needs a person" },
    };
  }
  if (reply.choice === "accept") {
    await tx.db.update(applications).set({ offerAcceptedAt: ctx.clock.now() }).where(eq(applications.id, app.id));
    await task(ctx, tx, app.id, {
      kind: "record_reservation",
      title: `Applicant accepted offer ${reply.revision} (${appRef(app)}): record the reservation of ${formatAed(app.offer.reservationFils)}`,
      details: { revision: reply.revision, reservationFils: app.offer.reservationFils },
      assigneeRole: "leasing_officer",
      dueOn: app.offer.expiresOn,
      dedupeKey: `${app.id}:record_reservation#${reply.revision}`,
    });
    await queueMail(ctx, tx, app.id, "accepted", reply.revision);
    return { applied: true, detail: { ...base, action: "accepted; waiting for the reservation" } };
  }

  if (reply.choice === "decline") {
    if (needsPerson) {
      return {
        applied: false,
        detail: { ...base, action: "decline held for review", reason: "the comment needs a person" },
      };
    }
    await advance(ctx, { kind: "application", id: app.id }, "OFFER_DECLINED", {
      actor: ev.actor as Actor,
      tx,
      payload: { revision: reply.revision, inboundRef: ev.ref },
    });
    return { applied: true, detail: { ...base, action: "declined" } };
  }

  // Counter-offer: a new revision from the structured fields only.
  const { unit, policy, contractRuleId, unitTerms } = await unitAndPolicy(ctx, tx, app);
  const { run, helperRunId } = await runAndRecord(
    ctx,
    tx,
    offerHelper,
    { context: OfferContext, data: OfferData },
    { kind: "application", id: app.id },
    "OFFER",
    {
      mode: "counter",
      today,
      unit: unitTerms,
      policy,
      revision: app.offer.revision + 1,
      requestedMoveInOn: null,
      current: app.offer,
      counter: reply.counter ?? {},
    },
    ctx.rulesVersion,
  );
  const data = run.result.data;
  if (!data) throw new Error("offer helper failed");
  if (data.inLimits) {
    await advance(ctx, { kind: "application", id: app.id }, "OFFER_REVISED", {
      actor: "helper:offer",
      tx,
      payload: { terms: data.terms, fromRevision: reply.revision, inboundRef: ev.ref, helperRunId },
    });
    return { applied: true, detail: { ...base, action: `revised offer ${data.terms.revision} sent (within limits)` } };
  }
  await askManagerForOffer(
    ctx,
    tx,
    app,
    unit,
    data.terms,
    noteDefaultLimits(data.problems, contractRuleId),
    reply.revision,
    helperRunId,
  );
  return { applied: true, detail: { ...base, action: "counter outside limits: sent to a leasing manager" } };
}

async function scheduleOfferExpiry(ctx: EngineContext, tx: Tx, app: AppRow, terms: OfferTerms) {
  // The offer is open through `expiresOn`; it lapses the next morning (Dubai).
  const dueOn = addDays(terms.expiresOn as CalendarDate, 1);
  const milestone = `offer_expiry@${terms.revision}`;
  const [row] = await tx.db
    .insert(deadlines)
    .values({
      id: newId(),
      entityKind: "application",
      entityId: app.id,
      milestone,
      dueOn,
      status: "pending",
      note: `Offer ${terms.revision} open until ${terms.expiresOn}`,
      rulesVersion: ctx.rulesVersion,
    })
    .onConflictDoNothing({ target: [deadlines.entityId, deadlines.milestone] })
    .returning();
  // Earlier revisions no longer lapse on their own date.
  await tx.db
    .update(deadlines)
    .set({ status: "cancelled", note: "replaced by a newer offer" })
    .where(and(eq(deadlines.entityId, app.id), eq(deadlines.status, "pending"), ne(deadlines.milestone, milestone)));
  if (row && !ctx.demoMode) {
    const jobId = await ctx.scheduler.send(tx, {
      name: DEADLINE_JOB,
      data: { deadlineId: row.id },
      singletonKey: `${app.id}:${milestone}`,
      startAfter: startOfDubaiDay(dueOn),
    });
    if (jobId) await tx.db.update(deadlines).set({ jobId }).where(eq(deadlines.id, row.id));
  }
}

/** Deadline handler: an unanswered offer lapses. Returns null when done, or why it didn't apply. */
export async function handleApplicationMilestone(
  ctx: EngineContext,
  tx: Tx,
  appId: string,
  milestone: string,
): Promise<string | null> {
  const [app] = await tx.db.select().from(applications).where(eq(applications.id, appId)).for("update");
  if (!app) return "application not found";
  const rev = Number(milestone.split("@")[1]);
  if (!milestone.startsWith("offer_expiry@")) return `unknown milestone ${milestone}`;
  if (app.state !== "OFFER" || app.offer?.revision !== rev) return `offer ${rev} is no longer open`;
  if (app.offerAcceptedAt) return "accepted; waiting for the reservation";
  const [waiting] = await tx.db
    .select({ id: approvals.id })
    .from(approvals)
    .where(
      and(eq(approvals.entityId, app.id), eq(approvals.gate, "offer_out_of_limits"), eq(approvals.status, "pending")),
    );
  if (waiting) return "a leasing manager is deciding a counter-offer";
  await advance(ctx, { kind: "application", id: app.id }, "OFFER_EXPIRED", {
    actor: "system",
    tx,
    payload: { revision: rev },
  });
  return null;
}

// ---------------------------------------------------------------- reservation → lease

/** An officer records the reservation payment; that is the applicant's commitment (OFFER → RESERVED). */
export async function recordReservation(
  ctx: EngineContext,
  applicationId: string,
  r: { paidOn: CalendarDate; reference: string },
  actor: Actor,
) {
  return withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    if (app.state !== "OFFER" || !app.offer) throw conflict(`application is ${app.state}, not at the offer stage`);
    if (!app.offerAcceptedAt) throw conflict("the applicant hasn't accepted the offer yet");
    const today = ctx.clock.today();
    if (r.paidOn > today) throw unprocessable("the payment date can't be in the future");
    if (app.offer.moveInOn <= today) {
      throw conflict(
        `the agreed move-in date (${app.offer.moveInOn}) has passed; the offer needs a new move-in date first`,
      );
    }
    // One lease per unit: no reservation while another applicant's lease is being set up.
    const [other] = await tx.db
      .select({ id: applications.id })
      .from(applications)
      .where(and(eq(applications.unitId, app.unitId), ne(applications.id, app.id), eq(applications.state, "RESERVED")));
    if (other || (await unitHasContractedLease(tx, app.unitId))) {
      throw conflict("another applicant already reserved this unit", "unit_contracted");
    }
    // The tenant's documents must still be valid when the lease starts (they may have been read weeks ago).
    const [party] = await tx.db.select().from(parties).where(eq(parties.id, app.partyId));
    const start = app.offer.startOn;
    const lapsing = (
      [
        ["Emirates ID", party?.idExpiresOn],
        ["passport", party?.passportExpiresOn],
        ["visa", party?.visaExpiresOn],
        ["trade licence", party?.tradeLicenceExpiresOn],
      ] as [string, string | null | undefined][]
    ).filter(([, d]) => d && d < start);
    if (lapsing.length) {
      throw unprocessable(
        "the tenant's documents expire before the lease starts",
        lapsing.map(
          ([label, d]) => `The ${label} expires on ${d}; the lease starts ${start}. Ask for the renewed document.`,
        ),
        "rule_violation",
      );
    }
    await tx.db
      .update(applications)
      .set({
        reservationPaidOn: r.paidOn,
        reservationFils: app.offer.reservationFils,
        reservationRef: r.reference.trim(),
        updatedAt: ctx.clock.now(),
      })
      .where(eq(applications.id, app.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "RESERVATION_RECORDED",
      actor,
      payload: { paidOn: r.paidOn, reservationFils: app.offer.reservationFils, reference: maskPiiText(r.reference) },
      rulesVersion: ctx.rulesVersion,
    });
    await tx.db
      .update(tasks)
      .set({ status: "done" })
      .where(and(eq(tasks.entityId, app.id), eq(tasks.kind, "record_reservation"), eq(tasks.status, "open")));
    return advance(ctx, { kind: "application", id: app.id }, "OFFER_ACCEPTED", { actor, tx });
  });
}

/** RESERVED: the lease is created in CONTRACT from the accepted offer, the verified tenant and the unit's company as landlord. */
async function createLeaseFromApplication(ctx: EngineContext, tx: Tx, app: AppRow, actor: Actor): Promise<string> {
  const terms = app.offer;
  if (!terms) throw conflict("no accepted offer");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, app.unitId)).for("update");
  if (!unit) throw notFound("unit");
  // The unit's company is the landlord (D44). Its legal details are checked when the contract is prepared.
  const { party: landlord } = await companyLandlord(tx, unit.companyId);
  if (await unitHasContractedLease(tx, unit.id)) throw conflict(`unit ${unit.code} already has a lease being signed`);
  const id = newId();
  // The version in force on the day the term starts (D23).
  const rulesVersion = rulesVersionForTerm(terms.startOn as CalendarDate);
  const ref = `${unit.code}/${terms.startOn.slice(0, 7)}`;
  await tx.db.insert(leases).values({
    id,
    ref,
    unitId: unit.id,
    applicationId: app.id,
    state: "CONTRACT",
    startOn: terms.startOn as CalendarDate,
    endOn: terms.endOn as CalendarDate,
    annualRentFils: terms.annualRentFils,
    cheques: terms.cheques,
    depositFils: terms.depositFils,
    rulesVersion,
    source: "engine",
  });
  await tx.db.insert(leaseParties).values([
    { leaseId: id, partyId: app.partyId, role: "tenant" },
    { leaseId: id, partyId: landlord.id, role: "landlord" },
  ]);
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id },
    type: "LEASE_CREATED",
    actor,
    toState: "CONTRACT",
    payload: {
      applicationId: app.id,
      offerRevision: terms.revision,
      rentFreeDays: terms.rentFreeDays,
      reservationFils: app.reservationFils,
      moveInOn: terms.moveInOn,
    },
    rulesVersion,
  });
  return id;
}

export async function rejectApplicant(ctx: EngineContext, applicationId: string, reason: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) throw notFound("application");
    const event = app.state === "SCREENING" ? "KYC_FAILED" : "WITHDRAWN";
    return advance(ctx, { kind: "application", id: app.id }, event, { actor, tx, payload: { reason } });
  });
}

// ---------------------------------------------------------------- email

/**
 * Sequence for a document-request email: the number of requests so far, counted from their events
 * (written before the email is queued), so two requests in a row never share a number.
 */
async function nextMailSeq(tx: Tx, appId: string, kind: ApplicationMailKind): Promise<number> {
  const events = await tx.db
    .select({ id: leaseEvents.id })
    .from(leaseEvents)
    .where(
      and(
        eq(leaseEvents.entityId, appId),
        inArray(
          leaseEvents.type,
          kind === "viewing"
            ? ["VIEWING_BOOKED"]
            : kind === "docs"
              ? ["APPLIED", "DOCUMENTS_REQUESTED"]
              : ["OFFER_MADE", "OFFER_REVISED"],
        ),
      ),
    );
  // The triggering event (APPLIED / DOCUMENTS_REQUESTED) is already written when this runs.
  return Math.max(1, events.length);
}

async function queueMail(
  ctx: EngineContext,
  tx: Tx,
  applicationId: string,
  kind: ApplicationMailKind,
  seq: number,
  variant?: string,
  startAfter?: Date,
) {
  const job = {
    name: APPLICATION_MAIL_JOB,
    data: { applicationId, kind, seq, ...(variant ? { variant } : {}) },
    singletonKey: `${applicationId}:${kind}#${seq}${variant ? `@${variant}` : ""}`,
  };
  if (startAfter)
    await scheduleTimed(ctx, tx, { ...job, startAfter, entity: { kind: "application", id: applicationId } });
  else await ctx.scheduler.send(tx, job);
}

// ---------------------------------------------------------------- reminders and chases (D37)

/** `viewing_reminder`: an email N hours before a booked viewing, unless that moment has passed or quiet hours push it past the viewing. */
async function queueViewingReminder(ctx: EngineContext, tx: Tx, applicationId: string, viewingAt: Date) {
  const a = await autopilotNow(ctx, tx);
  if (!a.viewing_reminder) return;
  const due = hoursFrom(viewingAt, -a.viewing_reminder_hours);
  if (due.getTime() <= ctx.clock.now().getTime()) return;
  const at = sendTime(a, due);
  if (at.getTime() >= viewingAt.getTime()) return;
  await queueMail(ctx, tx, applicationId, "viewing_reminder", 1, String(viewingAt.getTime()), at);
}

/** `no_show_followup`: a recorded no-show gets one friendly email (outside quiet hours). */
async function queueNoShowFollowup(ctx: EngineContext, tx: Tx, applicationId: string) {
  const a = await autopilotNow(ctx, tx);
  if (!a.no_show_followup) return;
  await queueMail(ctx, tx, applicationId, "no_show", 1, undefined, sendTime(a, ctx.clock.now()));
}

/** `kyc_chase`: N hours after a document request, one reminder with a fresh link if nothing was uploaded. */
async function queueDocsChase(ctx: EngineContext, tx: Tx, applicationId: string, requestSeq: number) {
  const a = await autopilotNow(ctx, tx);
  if (!a.kyc_chase) return;
  const at = sendTime(a, hoursFrom(ctx.clock.now(), a.kyc_chase_hours));
  await queueMail(ctx, tx, applicationId, "docs_chase", 1, String(requestSeq), at);
}

/** The reminder kinds, which re-read their switch when they fire. */
const REMINDER_SWITCH = {
  viewing_reminder: "viewing_reminder",
  no_show: "no_show_followup",
  docs_chase: "kyc_chase",
} as const satisfies Partial<Record<ApplicationMailKind, keyof Autopilot>>;

/** What a re-send asked by the applicant (web chat status check) did. */
export type ResendResult = "queued" | "already_today" | "not_now" | "being_prepared";

/**
 * Re-sends the upload link (SCREENING) or the offer email (OFFER, not yet answered, not lapsed) to
 * the applicant's address on file, at most once per Dubai day per kind (dedupe: an audit event under
 * the application's lock, and a day-specific outbound milestone). A new upload link replaces the
 * earlier ones, as `requestDocuments` does. The address is never taken from the caller.
 */
export async function resendApplicantLink(
  ctx: EngineContext,
  applicationId: string,
  kind: "docs" | "offer",
  actor: Actor,
  inTx?: Tx,
): Promise<ResendResult> {
  const run = async (tx: Tx): Promise<ResendResult> => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId)).for("update");
    if (!app) return "not_now";
    const today = ctx.clock.today();
    const ok =
      kind === "docs"
        ? app.state === "SCREENING"
        : app.state === "OFFER" && !!app.offer && !app.offerAcceptedAt && app.offer.expiresOn >= today;
    if (!ok) return "not_now";
    if (kind === "offer") {
      // A held offer is not out until a person sends it (the rule of `sendHeldOffer`): nothing to re-send yet.
      const revision = app.offer!.revision;
      const events = await tx.db
        .select({ type: leaseEvents.type, payload: leaseEvents.payload })
        .from(leaseEvents)
        .where(and(eq(leaseEvents.entityId, app.id), inArray(leaseEvents.type, ["OFFER_HELD", "OFFER_SENT"])));
      const held = events.some((e) => e.type === "OFFER_HELD" && eventRevision(e) === revision);
      const sent = events.some((e) => e.type === "OFFER_SENT" && eventRevision(e) === revision);
      if (held && !sent) return "being_prepared";
    }
    const done = await tx.db
      .select({ payload: leaseEvents.payload })
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, app.id), eq(leaseEvents.type, "APPLICANT_LINK_RESENT")));
    if (
      done.some(
        (e) =>
          (e.payload as { kind?: string; on?: string }).kind === kind && (e.payload as { on?: string }).on === today,
      )
    )
      return "already_today";
    const seq = kind === "docs" ? await nextMailSeq(tx, app.id, "docs") : app.offer!.revision;
    if (kind === "docs") {
      await tx.db
        .update(actionLinks)
        .set({ usedAt: ctx.clock.now() })
        .where(
          and(eq(actionLinks.entityId, app.id), eq(actionLinks.purpose, "kyc_upload"), isNull(actionLinks.usedAt)),
        );
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: app.id },
      type: "APPLICANT_LINK_RESENT",
      actor,
      payload: { kind, on: today, seq, via: "web_chat" },
      rulesVersion: ctx.rulesVersion,
    });
    await queueMail(ctx, tx, app.id, kind, seq, `resend-${today}`);
    return "queued";
  };
  return inTx ? run(inTx) : withTx(ctx.database, run);
}

const PURPOSE: Record<ApplicationMailKind, "link" | "offer" | "receipt" | "reminder"> = {
  viewing: "link",
  docs: "link",
  offer: "offer",
  accepted: "receipt",
  viewing_reminder: "reminder",
  no_show: "reminder",
  docs_chase: "reminder",
};

/**
 * Sends one application email (job). Links are created at send time, so their tokens exist only
 * in the email. Each email is recorded with its SMTP evidence; a sent email is never sent twice.
 */
export async function sendApplicationMail(
  ctx: EngineContext,
  applicationId: string,
  kind: ApplicationMailKind,
  seq: number,
  variant?: string,
) {
  const prepared = await withTx(ctx.database, async (tx) => {
    const [app] = await tx.db.select().from(applications).where(eq(applications.id, applicationId));
    if (!app) return null;
    const sw = REMINDER_SWITCH[kind as keyof typeof REMINDER_SWITCH];
    if (sw) {
      // A reminder re-reads its switch and the entity's state when it fires (D37).
      const a = await autopilotNow(ctx, tx);
      if (!a[sw]) return null;
      if (quietNow(a, ctx.clock.now())) {
        // Policy changed after scheduling: try again once quiet hours end (a new key per postponement).
        await queueMail(
          ctx,
          tx,
          app.id,
          kind,
          seq,
          `${variant ?? "q"}~${ctx.clock.now().getTime()}`,
          sendTime(a, ctx.clock.now()),
        );
        return null;
      }
    }
    const still =
      kind === "viewing"
        ? app.state === "VIEWING" && !!app.viewingAt
        : kind === "docs"
          ? app.state === "SCREENING"
          : kind === "offer"
            ? app.state === "OFFER" && app.offer?.revision === seq && !app.offerAcceptedAt
            : kind === "viewing_reminder"
              ? app.state === "VIEWING" &&
                !!app.viewingAt &&
                !app.viewingOutcome &&
                app.viewingAt.getTime() > ctx.clock.now().getTime() &&
                variant?.split("~")[0] === String(app.viewingAt.getTime())
              : kind === "no_show"
                ? app.viewingOutcome === "no_show"
                : kind === "docs_chase"
                  ? app.state === "SCREENING" && (await uploadedDocuments(tx, app.id)).length === 0
                  : !!app.offerAcceptedAt;
    if (!still) return null;
    const [party] = await tx.db.select().from(parties).where(eq(parties.id, app.partyId));
    const [unit] = await tx.db.select().from(units).where(eq(units.id, app.unitId));
    if (!party || !unit) return null;
    if (!party.email) {
      await task(ctx, tx, app.id, {
        kind: "no_email",
        title: `Application ${appRef(app)} has no email address: contact the applicant`,
        details: { mail: kind },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${app.id}:no_email`,
      });
      return null;
    }
    const milestone = `${kind}#${seq}${variant ? `@${variant}` : ""}`;
    const [existing] = await tx.db
      .select()
      .from(outboundMessages)
      .where(and(eq(outboundMessages.entityId, app.id), eq(outboundMessages.milestone, milestone)))
      .for("update");
    if (existing?.status === "sending") {
      // Interrupted between SMTP and recording the answer: a person checks before anything is resent.
      await task(ctx, tx, app.id, {
        kind: "email_unclear",
        title: `Email "${existing.subject}" for application ${appRef(app)} may or may not have been sent: check the sent mail`,
        details: { outboundMessageId: existing.id },
        assigneeRole: "leasing_officer",
        dueOn: ctx.clock.today(),
        dedupeKey: `${app.id}:email_unclear:${existing.id}`,
      });
      return null;
    }
    if (existing && existing.status !== "failed") return null;
    const status = await createLink(ctx, tx, {
      purpose: "application",
      entity: { kind: "application", id: app.id },
      partyId: party.id,
      ttlDays: 30,
    });
    const first = party.fullNameEn.split(/\s+/)[0] ?? party.fullNameEn;
    let mail: { subject: string; text: string; html: string };
    if (kind === "viewing") {
      // Reusable: the applicant may look at the property again before and after the viewing.
      const property = await createLink(ctx, tx, {
        purpose: "viewing",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: 30,
      });
      mail = viewingInvitationEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        address: unitAddress(unit),
        viewingAt: app.viewingAt!,
        propertyUrl: property.url,
        virtualTourUrl: unit.virtualTourUrl,
        statusUrl: status.url,
        reference: appRef(app),
        demo: ctx.demoMode,
      });
    } else if (kind === "viewing_reminder") {
      const property = await createLink(ctx, tx, {
        purpose: "viewing",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: 30,
      });
      mail = viewingReminderEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        address: unitAddress(unit),
        viewingAt: app.viewingAt!,
        propertyUrl: property.url,
        statusUrl: status.url,
        reference: appRef(app),
        demo: ctx.demoMode,
      });
    } else if (kind === "no_show") {
      const property = await createLink(ctx, tx, {
        purpose: "viewing",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: 30,
      });
      mail = noShowFollowupEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        reference: appRef(app),
        propertyUrl: property.url,
        demo: ctx.demoMode,
      });
    } else if (kind === "docs_chase") {
      // A fresh link replaces the earlier ones, as a new document request does.
      await tx.db
        .update(actionLinks)
        .set({ usedAt: ctx.clock.now() })
        .where(
          and(eq(actionLinks.entityId, app.id), eq(actionLinks.purpose, "kyc_upload"), isNull(actionLinks.usedAt)),
        );
      const upload = await createLink(ctx, tx, {
        purpose: "kyc_upload",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: 7,
      });
      mail = documentsChaseEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        reference: appRef(app),
        uploadUrl: upload.url,
        statusUrl: status.url,
        demo: ctx.demoMode,
      });
    } else if (kind === "docs") {
      const upload = await createLink(ctx, tx, {
        purpose: "kyc_upload",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: 7,
      });
      mail = documentsRequestEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        reference: appRef(app),
        uploadUrl: upload.url,
        statusUrl: status.url,
        demo: ctx.demoMode,
      });
    } else if (kind === "offer") {
      const t = app.offer!;
      const answer = await createLink(ctx, tx, {
        purpose: "offer",
        entity: { kind: "application", id: app.id },
        partyId: party.id,
        ttlDays: Math.max(1, diffDays(ctx.clock.today(), t.expiresOn as CalendarDate) + 1),
      });
      mail = offerEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        reference: appRef(app),
        revised: t.revision > 1,
        rent: formatAed(t.annualRentFils),
        cheques: t.cheques,
        deposit: formatAed(t.depositFils),
        reservation: formatAed(t.reservationFils),
        moveInOn: t.moveInOn,
        term: `${t.startOn} to ${t.endOn}`,
        expiresOn: t.expiresOn,
        offerUrl: answer.url,
        statusUrl: status.url,
        demo: ctx.demoMode,
      });
    } else {
      mail = offerAcceptedEmail({
        applicantName: first,
        unitLabel: unitLabel(unit),
        reference: appRef(app),
        reservation: formatAed(app.offer?.reservationFils ?? 0),
        statusUrl: status.url,
        demo: ctx.demoMode,
      });
    }
    const id = existing?.id ?? newId();
    if (existing) {
      await tx.db.update(outboundMessages).set({ status: "sending", error: null }).where(eq(outboundMessages.id, id));
    } else {
      await tx.db.insert(outboundMessages).values({
        id,
        entityKind: "application",
        entityId: app.id,
        purpose: PURPOSE[kind],
        milestone,
        to: party.email,
        intendedTo: party.email,
        template: `application_${kind}`,
        subject: mail.subject,
        status: "sending",
        createdAt: ctx.clock.now(),
      });
    }
    return { id, to: party.email, mail, appId: app.id };
  });
  if (!prepared) return { sent: false };
  let receipt: MailReceipt;
  try {
    receipt = await ctx.mailer.send({ to: prepared.to, ...prepared.mail });
  } catch (e) {
    const error = maskPiiText(e instanceof Error ? e.message : String(e));
    await ctx.database.db
      .update(outboundMessages)
      .set({ status: "failed", error })
      .where(eq(outboundMessages.id, prepared.id));
    throw new Error(`application email failed: ${error}`, { cause: e });
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
        error: ok ? null : maskPiiText(`recipient not accepted: ${receipt.response}`),
      })
      .where(eq(outboundMessages.id, prepared.id));
    await appendEvent(tx, ctx, {
      entity: { kind: "application", id: prepared.appId },
      type: ok ? "EMAIL_SENT" : "EMAIL_FAILED",
      actor: "system",
      payload: { outboundMessageId: prepared.id, kind, seq, messageId: receipt.messageId },
      rulesVersion: ctx.rulesVersion,
    });
  });
  return { sent: ok, outboundMessageId: prepared.id };
}

export type { LinkRow };
