import type { LocalDiskStore } from "@leasing/adapters";
import { addDays, InboundType, maskPii } from "@leasing/core";
import { sha256Hex } from "@leasing/core/tokens";
import {
  applications,
  approvals,
  complaints,
  contracts,
  contractSigners,
  documents,
  leaseParties,
  leases,
  maintenanceTickets,
  parties,
  type Tx,
  unitPhotos,
  units,
  withTx,
} from "@leasing/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, unprocessable } from "../errors.ts";
import { effectiveProposal, RenewalNoticeProposal } from "../manager/gate-rules.ts";
import { receiveInbound, storeInboundWhileTenancyOff, termReplies } from "../manager/inbound.ts";
import { addApplicationDocument, removeApplicationDocument, uploadedDocuments } from "../manager/applications.ts";
import { contractPdf, signContract, signView } from "../manager/contracts.ts";
import { openForReply } from "../manager/collections.ts";
import { portalStatement } from "../manager/deposit.ts";
import { getCompanyPolicy } from "../manager/events.ts";
import { moveOutBooking } from "../manager/move-out.ts";
import { type LinkRow, resolveLink } from "../manager/links.ts";
import { moveInStatus } from "../manager/move-in.ts";
import { addTenancyPhoto } from "../manager/tenancy-files.ts";
import { noticeSentForTerm, sentNoticeValid } from "../manager/outbound.ts";
import type { AuthEnv } from "./auth.ts";

/**
 * Tenant portal API (architecture §8a). Authenticated by the magic-link token only; a token
 * sees exactly one lease. No staff data, identifiers masked, nothing editable except the forms.
 */
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;
const hits = new Map<string, { n: number; until: number }>();

/** Small per-token rate limit (wall-clock, not domain time). */
function limited(token: string): boolean {
  const key = sha256Hex(token);
  const now = Date.now();
  // Random tokens must not grow the map without bound: drop expired windows when it gets big.
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
  const h = hits.get(key);
  if (!h || h.until < now) {
    hits.set(key, { n: 1, until: now + WINDOW_MS });
    return false;
  }
  h.n++;
  return h.n > MAX_PER_WINDOW;
}

const unknownLink = () =>
  new DomainError(
    "This link has expired or isn't valid. Use the newest email from us, or contact the leasing team.",
    404,
    "link_invalid",
  );

/** Links that may show the applicant the property they're viewing (details and photos). */
const PROPERTY_PURPOSES = new Set(["viewing", "application"]);

/** What the tenant can do during the tenancy: open payments to reply about, their reports, the move-in report. */
async function tenancyView(ctx: EngineContext, tx: Tx, lease: typeof leases.$inferSelect, link: LinkRow) {
  const purpose = link.purpose;
  const open = await openForReply(tx, lease.id);
  const reports = await tx.db
    .select({
      ref: complaints.ref,
      status: complaints.status,
      category: complaints.category,
      createdAt: complaints.createdAt,
      ticketStatus: maintenanceTickets.status,
    })
    .from(complaints)
    .leftJoin(maintenanceTickets, eq(maintenanceTickets.complaintId, complaints.id))
    .where(eq(complaints.leaseId, lease.id))
    .orderBy(desc(complaints.createdAt))
    .limit(10);
  const moveIn =
    purpose === "move_in_ack"
      ? await moveInStatus(ctx, tx, lease.id).then((s) => ({
          checked: s.items.filter((i) => i.kind === "check" && i.done).map((i) => i.label),
          rooms: s.items.filter((i) => i.kind === "room").map((i) => i.label),
        }))
      : null;
  const today = ctx.clock.today();
  const policy = await getCompanyPolicy(tx, today);
  return {
    today,
    /** The latest "will pay by" date the form accepts (policy). */
    latestPayBy: addDays(today, policy.promiseToPayMaxDays),
    canReportIssue: ["ACTIVE", "RENEWAL", "MOVE_OUT", "DISPUTE"].includes(lease.state),
    openPayments: open.map((p) => ({
      id: p.id,
      seq: p.seq,
      amountFils: p.amountFils,
      dueOn: p.dueOn,
      status: p.status,
    })),
    reports,
    moveIn,
    moveOut: await moveOutView(ctx, tx, lease, link),
  };
}

/** Step 10: give notice (at the lease end), book the inspection, answer the deposit statement. */
async function moveOutView(ctx: EngineContext, tx: Tx, lease: typeof leases.$inferSelect, link: LinkRow) {
  const running = lease.state === "ACTIVE" || lease.state === "RENEWAL";
  const replies = running ? await termReplies(tx, lease) : null;
  const opens = addDays(lease.endOn, -(await getCompanyPolicy(tx, ctx.clock.today())).vacateNoticeOpensDays);
  const statement = lease.state === "MOVE_OUT" || lease.state === "CLOSED" ? await portalStatement(tx, lease.id) : null;
  const booking = lease.state === "MOVE_OUT" ? await moveOutBooking(ctx, tx, lease) : null;
  return {
    leaseEndOn: lease.endOn,
    moveOutOn: lease.moveOutOn,
    canGiveNotice: link.purpose === "tenancy" && running && !replies?.final && ctx.clock.today() >= opens,
    booking:
      booking && link.purpose === "tenancy" ? booking : booking ? { ...booking, canBook: false, slots: [] } : null,
    statement,
    canRespondToStatement:
      link.purpose === "deposit_response" && !link.usedAt && statement?.status === "sent" && lease.state === "MOVE_OUT",
  };
}

/** Inbound types of move-in through move-out; stored as needs-human, not processed, while TENANCY_OPS is off. */
const TENANCY_OPS_INBOUND = new Set<string>([
  "MOVE_IN_ACKNOWLEDGED",
  "PAYMENT_REPLY",
  "COMPLAINT_SUBMITTED",
  "VACATE_NOTICE",
  "INSPECTION_BOOKED",
  "DEPOSIT_RESPONSE",
  "RENEWAL_REPLY",
  "NOTICE_ACKNOWLEDGED",
]);

export function registerPortalRoutes(app: Hono<AuthEnv>, ctx: EngineContext, mediaStore?: LocalDiskStore) {
  /** A photo of the unit behind an applicant's viewing/status link; never another unit's. */
  app.get("/api/portal/:token/photos/:photoId", async (c) => {
    const token = c.req.param("token");
    // Its own window (a gallery loads many photos at once), so photos never starve the page.
    if (limited(`${token}:photos`)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
    const photoId = z.uuid().safeParse(c.req.param("photoId"));
    const photo = await withTx(ctx.database, async (tx) => {
      const link = await resolveLink(tx, token, ctx.clock.now());
      if (!link || link.entityKind !== "application" || !PROPERTY_PURPOSES.has(link.purpose)) throw unknownLink();
      if (!photoId.success) return null;
      const [p] = await tx.db
        .select({ path: unitPhotos.path, mime: unitPhotos.mime, sha256: unitPhotos.sha256 })
        .from(unitPhotos)
        .innerJoin(applications, eq(applications.unitId, unitPhotos.unitId))
        .where(and(eq(unitPhotos.id, photoId.data), eq(applications.id, link.entityId)));
      return p ?? null;
    });
    if (!photo || !mediaStore) throw new DomainError("photo not found", 404, "not_found");
    const bytes = await mediaStore.read(photo.path);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": photo.mime,
      "cache-control": "private, max-age=3600",
      "x-content-type-options": "nosniff",
      etag: `"${photo.sha256}"`,
    });
  });

  app.get("/api/portal/:token", async (c) => {
    const token = c.req.param("token");
    if (limited(token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
    const data = await withTx(ctx.database, async (tx) => {
      const link = await resolveLink(tx, token, ctx.clock.now());
      if (link?.entityKind === "application") return applicationView(tx, link);
      if (link?.purpose === "sign") {
        const view = await signView(tx, link);
        if (!view) throw unknownLink();
        return maskPii({ ...view, demo: ctx.demoMode });
      }
      if (!link || link.entityKind !== "lease") throw unknownLink();
      const [lease] = await tx.db.select().from(leases).where(eq(leases.id, link.entityId));
      if (!lease) throw unknownLink();
      const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
      const [tenant] = await tx.db
        .select({ name: parties.fullNameEn })
        .from(leaseParties)
        .innerJoin(parties, eq(parties.id, leaseParties.partyId))
        .where(and(eq(leaseParties.leaseId, lease.id), eq(leaseParties.role, "tenant")));
      // The latest notice sent for this term (e.g. a same-rent offer that replaced a late one).
      const sent = await noticeSentForTerm(tx, lease, "latest");
      let notice: Record<string, unknown> | null = null;
      if (sent) {
        const [a] = await tx.db.select().from(approvals).where(eq(approvals.id, sent.approvalId));
        const p = a ? RenewalNoticeProposal.parse(effectiveProposal(a)) : null;
        notice = p
          ? {
              sentAt: sent.sentAt,
              acknowledgedAt: sent.acknowledgedAt,
              currentRentFils: p.currentRentFils,
              proposedRentFils: p.proposedRentFils,
              newTermStartOn: p.newTermStartOn,
              newTermEndOn: p.newTermEndOn,
            }
          : null;
      }
      // A late increase can't be applied: no online answer until the same-rent offer is sent.
      const offerValid = !!sent && sentNoticeValid(sent.proposedRentFils, sent.sentAt, lease);
      const replies = await termReplies(tx, lease);
      const reply = replies.latest;
      const tenancy = await tenancyView(ctx, tx, lease, link);
      return {
        purpose: link.purpose,
        linkUsed: !!link.usedAt,
        tenancy,
        tenantFirstName: (tenant?.name ?? "").split(/\s+/)[0] ?? "",
        lease: {
          state: lease.state,
          startOn: lease.startOn,
          endOn: lease.endOn,
          annualRentFils: lease.annualRentFils,
          ref: lease.ref,
        },
        unit: unit ? { label: `${unit.unitNo ?? unit.code}, ${unit.building}`, community: unit.community } : null,
        notice,
        reply: reply
          ? {
              ref: reply.ref,
              choice: (reply.payload as { choice?: string }).choice ?? null,
              receivedAt: reply.receivedAt,
            }
          : null,
        canAcknowledge: !!notice && !notice.acknowledgedAt,
        // After "discuss" the tenant can still give a final answer.
        canReply: lease.state === "RENEWAL" && !!notice && !replies.final && offerValid,
      };
    });
    return c.json(data);
  });

  app.get("/api/portal/:token/notice.pdf", async (c) => {
    const token = c.req.param("token");
    if (limited(token)) return c.json({ error: "Too many requests" }, 429);
    const file = await withTx(ctx.database, async (tx) => {
      const link = await resolveLink(tx, token, ctx.clock.now());
      if (!link || link.entityKind !== "lease") throw unknownLink();
      const [lease] = await tx.db.select().from(leases).where(eq(leases.id, link.entityId));
      if (!lease) throw unknownLink();
      // Same notice as the portal page shows.
      const msg = await noticeSentForTerm(tx, lease, "latest");
      if (!msg?.documentId) throw unknownLink();
      const [doc] = await tx.db.select().from(documents).where(eq(documents.id, msg.documentId));
      return doc ?? null;
    });
    if (!file) throw unknownLink();
    const bytes = await ctx.documents.read(file.path);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="renewal-notice.pdf"`,
      "cache-control": "private, no-store",
    });
  });

  /** The contract a signer is asked to sign (the approved PDF). Only through that signer's link. */
  app.get("/api/portal/:token/contract.pdf", async (c) => {
    const token = c.req.param("token");
    if (limited(token)) return c.json({ error: "Too many requests" }, 429);
    const bytes = await withTx(ctx.database, async (tx) => {
      const link = await resolveLink(tx, token, ctx.clock.now());
      if (link?.purpose !== "sign") throw unknownLink();
      const [s] = await tx.db
        .select({ contract: contracts })
        .from(contractSigners)
        .innerJoin(contracts, eq(contracts.id, contractSigners.contractId))
        .where(eq(contractSigners.linkId, link.id));
      if (!s) throw unknownLink();
      return contractPdf(ctx, tx, s.contract, "approved");
    });
    return c.body(bytes, 200, {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="tenancy-contract.pdf"`,
      "cache-control": "private, no-store",
    });
  });

  app.post("/api/portal/:token/sign", async (c) => {
    const token = c.req.param("token");
    if (limited(token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
    const link = await withTx(ctx.database, (tx) => resolveLink(tx, token, ctx.clock.now()));
    if (!link || link.purpose !== "sign") throw unknownLink();
    const r = await signContract(ctx, link, await c.req.json(), {
      // Set by the web app's route handler from the signer's request.
      ip: c.req.header("x-signer-ip") ?? null,
      userAgent: c.req.header("x-signer-user-agent") ?? c.req.header("user-agent") ?? null,
    });
    return c.json(r, 201);
  });

  app.post("/api/inbound", async (c) => {
    const body = z.object({ token: z.string(), type: InboundType, payload: z.unknown() }).parse(await c.req.json());
    if (limited(body.token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
    if (!ctx.tenancyOps && TENANCY_OPS_INBOUND.has(body.type)) {
      // Kept as evidence and marked for a person; never processed while tenancy operations are off.
      const stored = await withTx(ctx.database, async (tx) => {
        const link = await resolveLink(tx, body.token, ctx.clock.now());
        if (!link || link.entityKind !== "lease") throw unknownLink();
        return storeInboundWhileTenancyOff(ctx, tx, {
          type: body.type,
          payload: body.payload,
          channel: "portal",
          actor: `tenant:${link.partyId ?? "unknown"}`,
          entity: { kind: "lease", id: link.entityId },
          linkId: link.id,
        });
      });
      return c.json({ ref: stored.ref, duplicate: stored.duplicate }, stored.duplicate ? 200 : 202);
    }
    const r = await withTx(ctx.database, async (tx) => {
      const link = await resolveLink(tx, body.token, ctx.clock.now());
      if (link?.entityKind === "application") {
        // Documents go with their upload link, an offer answer with its offer link; each works once.
        const need = body.type === "DOCS_UPLOADED" ? "kyc_upload" : body.type === "OFFER_RESPONDED" ? "offer" : null;
        if (!need || link.purpose !== need) throw conflict("Open the link from the newest email to do this.");
        if (link.usedAt) throw conflict("This link was already used. Use the newest email from us.");
        return receiveInbound(ctx, tx, {
          type: body.type,
          payload: body.payload,
          channel: "portal",
          actor: `tenant:${link.partyId ?? "unknown"}`,
          entity: { kind: "application", id: link.entityId },
          linkId: link.id,
        });
      }
      if (!link || link.entityKind !== "lease") throw unknownLink();
      const [lease] = await tx.db.select().from(leases).where(eq(leases.id, link.entityId));
      if (!lease) throw unknownLink();
      let outboundMessageId: string | undefined;
      if (body.type === "MOVE_IN_ACKNOWLEDGED") {
        if (link.purpose !== "move_in_ack")
          throw conflict("Open the 'Confirm the move-in report' link from your email.");
        if (link.usedAt) throw conflict("You already confirmed the move-in report. Thank you.");
      } else if (
        body.type === "PAYMENT_REPLY" ||
        body.type === "COMPLAINT_SUBMITTED" ||
        body.type === "VACATE_NOTICE" ||
        body.type === "INSPECTION_BOOKED"
      ) {
        if (link.purpose !== "tenancy") throw conflict("Open the 'My tenancy' link from your newest email to do this.");
      } else if (body.type === "DEPOSIT_RESPONSE") {
        if (link.purpose !== "deposit_response")
          throw conflict("Open the 'Accept or dispute' link from your deposit statement email.");
        if (link.usedAt) throw conflict("You already answered this deposit statement. Thank you.");
      } else if (body.type === "NOTICE_ACKNOWLEDGED") {
        outboundMessageId = link.outboundMessageId ?? (await noticeSentForTerm(tx, lease))?.id;
        if (!outboundMessageId) throw conflict("There is no notice to acknowledge yet.");
      } else {
        if (link.purpose !== "tenancy") throw conflict("Open the 'Reply' link from your notice email to answer.");
        const latest = await noticeSentForTerm(tx, lease, "latest");
        if (lease.state !== "RENEWAL" || !latest || !sentNoticeValid(latest.proposedRentFils, latest.sentAt, lease))
          throw conflict("There's no renewal offer to answer right now.");
        const p = body.payload as { choice?: unknown; confirmVacate?: unknown } | null;
        if (p?.choice === "vacate" && p.confirmVacate !== true)
          throw conflict("Please confirm that you won't renew before choosing Move out.");
      }
      return receiveInbound(ctx, tx, {
        type: body.type,
        payload: body.payload,
        channel: "portal",
        actor: `tenant:${link.partyId ?? "unknown"}`,
        entity: { kind: "lease", id: lease.id },
        linkId: link.id,
        ...(outboundMessageId ? { outboundMessageId } : {}),
      });
    });
    return c.json({ ref: r.ref, duplicate: r.duplicate }, r.duplicate ? 200 : 202);
  });

  // ---- tenancy photos: own move-in photos, payment proof, photos of an issue ----
  app.post(
    "/api/portal/:token/files",
    bodyLimit({ maxSize: 11 * 1024 * 1024, onError: (c) => c.json({ error: "the photo is larger than 10 MB" }, 413) }),
    async (c, next) => {
      const token = c.req.param("token");
      if (limited(token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
      const link = await withTx(ctx.database, (tx) => resolveLink(tx, token, ctx.clock.now()));
      if (!link || link.entityKind !== "lease" || link.usedAt) throw unknownLink();
      if (link.purpose !== "move_in_ack" && link.purpose !== "tenancy") throw unknownLink();
      await next();
    },
    async (c) => {
      const link = (await withTx(ctx.database, (tx) => resolveLink(tx, c.req.param("token"), ctx.clock.now())))!;
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File)) throw unprocessable("attach a photo as `file`", [], "invalid_request");
      const allowed = link.purpose === "move_in_ack" ? ["tenant_condition_photo"] : ["payment_proof", "issue_photo"];
      const kind = z.enum(["tenant_condition_photo", "payment_proof", "issue_photo"]).parse(form.get("kind"));
      if (!allowed.includes(kind))
        throw unprocessable("this link can't take that kind of photo", [], "invalid_request");
      const room = z
        .string()
        .trim()
        .max(60)
        .optional()
        .parse(form.get("room") || undefined);
      const r = await addTenancyPhoto(
        ctx,
        {
          leaseId: link.entityId,
          kind,
          uploadedBy: `tenant:${link.partyId ?? "unknown"}`,
          partyId: link.partyId,
          room: room ?? null,
          linkId: link.id,
        },
        new Uint8Array(await file.arrayBuffer()),
      );
      return c.json({ id: r.id, kind: r.kind, bytes: r.bytes }, 201);
    },
  );

  // ---- applicant documents (upload link only) ----
  app.post(
    "/api/portal/:token/documents",
    // Checked before the body is read: the size, then the link (no anonymous 100 MB uploads).
    bodyLimit({ maxSize: 11 * 1024 * 1024, onError: (c) => c.json({ error: "the photo is larger than 10 MB" }, 413) }),
    async (c, next) => {
      const token = c.req.param("token");
      if (limited(token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
      const link = await withTx(ctx.database, (tx) => resolveLink(tx, token, ctx.clock.now()));
      if (!link || link.purpose !== "kyc_upload" || link.usedAt) throw unknownLink();
      await next();
    },
    async (c) => {
      const token = c.req.param("token");
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw unprocessable("attach a photo of the document as `file`", [], "invalid_request");
      const meta = z
        .object({
          kind: z.enum(["emirates_id", "passport", "visa", "trade_licence"]),
          side: z.enum(["front", "back", "page"]),
        })
        .parse({ kind: form.get("kind"), side: form.get("side") });
      const link = await withTx(ctx.database, (tx) => resolveLink(tx, token, ctx.clock.now()));
      const r = await addApplicationDocument(ctx, link, new Uint8Array(await file.arrayBuffer()), meta.kind, meta.side);
      return c.json(r, r.duplicate ? 200 : 201);
    },
  );

  app.delete("/api/portal/:token/documents/:docId", async (c) => {
    const token = c.req.param("token");
    if (limited(token)) return c.json({ error: "Too many requests; try again in a minute." }, 429);
    const link = await withTx(ctx.database, (tx) => resolveLink(tx, token, ctx.clock.now()));
    await removeApplicationDocument(ctx, link, z.uuid().parse(c.req.param("docId")));
    return c.body(null, 204);
  });

  /** What an applicant sees: status, their uploads (upload link), the current offer (offer link). Nothing else. */
  async function applicationView(tx: Tx, link: LinkRow) {
    const [row] = await tx.db
      .select({ app: applications, unit: units, name: parties.fullNameEn })
      .from(applications)
      .innerJoin(units, eq(units.id, applications.unitId))
      .innerJoin(parties, eq(parties.id, applications.partyId))
      .where(eq(applications.id, link.entityId));
    if (!row) throw unknownLink();
    const { app: a, unit } = row;
    const today = ctx.clock.today();
    const offerOpen = a.state === "OFFER" && !!a.offer && !a.offerAcceptedAt && today <= a.offer.expiresOn;
    return {
      kind: "application" as const,
      purpose: link.purpose,
      linkUsed: !!link.usedAt,
      firstName: (row.name ?? "").split(/\s+/)[0] ?? "",
      ref: a.ref,
      state: a.state,
      unit: { label: `${unit.unitNo ?? unit.code}, ${unit.building}`, community: unit.community },
      documents: link.purpose === "kyc_upload" ? await uploadedDocuments(tx, a.id) : [],
      canUpload: link.purpose === "kyc_upload" && !link.usedAt && a.state === "SCREENING",
      offer:
        a.offer && (a.state === "OFFER" || a.state === "RESERVED" || a.state === "CONVERTED")
          ? {
              revision: a.offer.revision,
              annualRentFils: a.offer.annualRentFils,
              cheques: a.offer.cheques,
              depositFils: a.offer.depositFils,
              reservationFils: a.offer.reservationFils,
              moveInOn: a.offer.moveInOn,
              startOn: a.offer.startOn,
              endOn: a.offer.endOn,
              expiresOn: a.offer.expiresOn,
              acceptedAt: a.offerAcceptedAt,
            }
          : null,
      canRespond: link.purpose === "offer" && !link.usedAt && offerOpen,
      reservationRecorded: !!a.reservationPaidOn,
      viewingAt: a.viewingAt,
      viewingOutcome: a.viewingOutcome,
      // Unit facts only: no landlord, no other applicants, no internal codes or registry numbers.
      property: PROPERTY_PURPOSES.has(link.purpose)
        ? {
            building: unit.building,
            community: unit.community,
            unitNo: unit.unitNo,
            bedrooms: unit.bedrooms,
            bathrooms: unit.bathrooms,
            areaSqft: unit.areaSqft,
            floor: unit.floor,
            furnished: unit.furnished,
            parkingSpaces: unit.parkingSpaces,
            description: unit.description,
            askingRentFils: unit.askingRentFils,
            virtualTourUrl: unit.virtualTourUrl,
            photos: await tx.db
              .select({ id: unitPhotos.id, caption: unitPhotos.caption })
              .from(unitPhotos)
              .where(eq(unitPhotos.unitId, unit.id))
              .orderBy(asc(unitPhotos.sort), asc(unitPhotos.createdAt)),
          }
        : null,
    };
  }
}
