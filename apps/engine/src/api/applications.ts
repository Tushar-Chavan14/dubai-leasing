import { calendarDate, isCalendarDate, maskPii, type StaffRole } from "@leasing/core";
import {
  applications,
  approvals,
  conversations,
  documents,
  helperRuns,
  inboundEvents,
  outboundMessages,
  parties,
  tasks,
  units,
  withTx,
} from "@leasing/db";
import { and, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import {
  bookViewing,
  createApplication,
  recordReservation,
  recordViewingOutcome,
  rejectApplicant,
  requestDocuments,
  sendHeldOffer,
  applyWithoutViewing,
} from "../manager/applications.ts";
import { appendEvent } from "../manager/events.ts";
import { kycCheckState, kycStuckMs } from "../manager/kyc-check.ts";
import { retryKycCheck } from "../manager/kyc-retry.ts";
import { entityEvents } from "./queries.ts";
import { type AuthEnv, requireRole } from "./auth.ts";

const LEASING: StaffRole[] = ["leasing_officer", "leasing_manager"];
const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;
const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);
const calDate = z.string().refine(isCalendarDate, "expected YYYY-MM-DD").transform(calendarDate);
/** An instant with an explicit offset, e.g. "2026-10-23T16:30:00+04:00" (Dubai time). */
const instant = z.iso.datetime({ offset: true }).transform((v) => new Date(v));

/**
 * Staff routes for applications (steps 3–4). Any staff role can read; leasing officers and
 * managers act. ID numbers are masked in every response; document images are served only to
 * leasing staff and every view is recorded.
 */
export function registerApplicationRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  api.get("/applications", async (c) => {
    const rows = await db
      .select({
        id: applications.id,
        ref: applications.ref,
        state: applications.state,
        createdAt: applications.createdAt,
        updatedAt: applications.updatedAt,
        unitId: units.id,
        unitCode: units.code,
        building: units.building,
        applicant: parties.fullNameEn,
        kind: parties.kind,
        offer: applications.offer,
        offerAcceptedAt: applications.offerAcceptedAt,
      })
      .from(applications)
      .innerJoin(units, eq(units.id, applications.unitId))
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .orderBy(desc(applications.updatedAt))
      .limit(200);
    return c.json(rows);
  });

  api.get("/applications/:id", async (c) => {
    const id = uuid(c.req.param("id"));
    const [row] = await db
      .select({ app: applications, unit: units, party: parties })
      .from(applications)
      .innerJoin(units, eq(units.id, applications.unitId))
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(eq(applications.id, id));
    if (!row) throw notFound("application");
    const [docs, runs, aps, ts, inbound, outbound, events] = await Promise.all([
      db
        .select({
          id: documents.id,
          kind: documents.kind,
          side: documents.side,
          status: documents.status,
          bytes: documents.bytes,
          mime: documents.mime,
          expiresOn: documents.expiresOn,
          verifiedAt: documents.verifiedAt,
          createdAt: documents.createdAt,
        })
        .from(documents)
        .where(eq(documents.applicationId, id))
        .orderBy(documents.createdAt),
      db
        .select()
        .from(helperRuns)
        .where(and(eq(helperRuns.entityId, id), eq(helperRuns.entityKind, "application")))
        .orderBy(desc(helperRuns.at))
        .limit(20),
      db.select().from(approvals).where(eq(approvals.entityId, id)).orderBy(desc(approvals.createdAt)),
      db.select().from(tasks).where(eq(tasks.entityId, id)).orderBy(desc(tasks.createdAt)),
      db.select().from(inboundEvents).where(eq(inboundEvents.entityId, id)).orderBy(desc(inboundEvents.receivedAt)),
      db
        .select()
        .from(outboundMessages)
        .where(eq(outboundMessages.entityId, id))
        .orderBy(desc(outboundMessages.createdAt)),
      entityEvents(db, "application", id),
    ]);
    const kyc = runs.find((r) => r.helper === "kyc");
    const kycState = await kycCheckState(db, id, ctx.clock.now(), kycStuckMs(ctx));
    const [conversation] = await db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.applicationId, id))
      .limit(1);
    return c.json(
      maskPii({
        ...row.app,
        conversationId: conversation?.id ?? null,
        unit: {
          id: row.unit.id,
          code: row.unit.code,
          building: row.unit.building,
          community: row.unit.community,
          state: row.unit.state,
          askingRentFils: row.unit.askingRentFils,
          furnished: row.unit.furnished,
          bedrooms: row.unit.bedrooms,
        },
        applicant: {
          id: row.party.id,
          kind: row.party.kind,
          fullNameEn: row.party.fullNameEn,
          email: row.party.email,
          phone: row.party.phone,
          nationality: row.party.nationality,
          birthDate: row.party.birthDate,
          emiratesIdNo: row.party.emiratesIdNo,
          idExpiresOn: row.party.idExpiresOn,
          passportNo: row.party.passportNo,
          passportExpiresOn: row.party.passportExpiresOn,
          visaNo: row.party.visaNo,
          visaExpiresOn: row.party.visaExpiresOn,
          tradeLicenceNo: row.party.tradeLicenceNo,
          tradeLicenceExpiresOn: row.party.tradeLicenceExpiresOn,
        },
        documents: docs,
        kyc: kyc
          ? {
              helperRunId: kyc.id,
              at: kyc.at,
              status: kyc.status,
              latencyMs: kyc.latencyMs,
              result: (kyc.output as { data?: unknown } | null)?.data ?? null,
              reasons: (kyc.output as { reasons?: string[] } | null)?.reasons ?? [],
            }
          : null,
        // Where the latest document check stands (running, stuck, failed or none), from the stored submission.
        kycCheck: {
          state: kycState.state,
          inboundId: kycState.state === "none" ? null : kycState.inboundId,
          reason: kycState.state === "stuck" || kycState.state === "failed" ? kycState.reason : null,
        },
        helperRuns: runs.map((r) => ({ id: r.id, helper: r.helper, status: r.status, at: r.at })),
        approvals: aps,
        tasks: ts,
        inbound,
        outbound,
        events,
      }),
    );
  });

  api.post("/applications", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z
      .object({
        unitId: z.uuid(),
        nameEn: z.string().trim().min(2).max(120),
        email: z.email(),
        phone: z.string().trim().max(40).optional(),
        kind: z.enum(["individual", "company"]).default("individual"),
        requestedMoveInOn: calDate.optional(),
        viewingAt: instant,
      })
      .parse(await c.req.json());
    const r = await createApplication(
      ctx,
      {
        unitId: b.unitId,
        nameEn: b.nameEn,
        email: b.email,
        phone: b.phone ?? null,
        kind: b.kind,
        requestedMoveInOn: b.requestedMoveInOn ?? null,
        viewingAt: b.viewingAt,
      },
      actorOf(c),
    );
    return c.json(r, 201);
  });

  /** Books a viewing for an enquiry; the invitation email follows. */
  api.post("/applications/:id/viewing", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z.object({ viewingAt: instant }).parse(await c.req.json());
    return c.json(await bookViewing(ctx, uuid(c.req.param("id")), b.viewingAt, actorOf(c)));
  });

  /** Attended → screening (upload link emailed); no-show → the application closes. */
  api.post("/applications/:id/viewing-outcome", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z
      .object({ outcome: z.enum(["attended", "no_show"]), note: z.string().trim().max(500).optional() })
      .parse(await c.req.json());
    return c.json(await recordViewingOutcome(ctx, uuid(c.req.param("id")), b.outcome, b.note || null, actorOf(c)));
  });

  /** Apply from an enquiry without a viewing. 409 `viewing_required` unless the policy toggle allows it. */
  api.post("/applications/:id/events", async (c) => {
    requireRole(c.get("user"), LEASING);
    z.object({ event: z.literal("APPLIED") }).parse(await c.req.json());
    return c.json(await applyWithoutViewing(ctx, uuid(c.req.param("id")), actorOf(c)));
  });

  api.post("/applications/:id/request-documents", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await requestDocuments(ctx, uuid(c.req.param("id")), actorOf(c)));
  });

  /** Runs a failed or stuck document check again. 409 while one is running or when there is none. */
  api.post("/applications/:id/kyc/retry", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await retryKycCheck(ctx, uuid(c.req.param("id")), actorOf(c)), 202);
  });

  api.post("/applications/:id/offer/send", async (c) => {
    requireRole(c.get("user"), LEASING);
    return c.json(await sendHeldOffer(ctx, uuid(c.req.param("id")), actorOf(c)));
  });

  api.post("/applications/:id/reservation", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z.object({ paidOn: calDate, reference: z.string().trim().min(2).max(80) }).parse(await c.req.json());
    return c.json(await recordReservation(ctx, uuid(c.req.param("id")), b, actorOf(c)));
  });

  api.post("/applications/:id/reject", async (c) => {
    requireRole(c.get("user"), LEASING);
    const b = z.object({ reason: z.string().trim().min(3).max(500) }).parse(await c.req.json());
    return c.json(await rejectApplicant(ctx, uuid(c.req.param("id")), b.reason, actorOf(c)));
  });

  /** An uploaded ID image, for leasing staff only. Every view is recorded on the application. */
  api.get("/applications/:id/documents/:docId", async (c) => {
    requireRole(c.get("user"), LEASING);
    const appId = uuid(c.req.param("id"));
    const [doc] = await db
      .select()
      .from(documents)
      .where(and(eq(documents.id, uuid(c.req.param("docId"))), eq(documents.applicationId, appId)));
    if (!doc) throw notFound("document");
    const bytes = await ctx.uploads.read(doc.path);
    await withTx(ctx.database, (tx) =>
      appendEvent(tx, ctx, {
        entity: { kind: "application", id: appId },
        type: "DOCUMENT_VIEWED",
        actor: actorOf(c),
        payload: { documentId: doc.id, kind: doc.kind, side: doc.side },
        rulesVersion: ctx.rulesVersion,
      }),
    );
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": doc.mime ?? "application/octet-stream",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    });
  });
}
