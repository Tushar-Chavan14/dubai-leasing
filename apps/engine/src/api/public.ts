import type { LocalDiskStore } from "@leasing/adapters";
import { type Actor, formatAed, newId, normalisePhone, SIZE_BAND_LIMITS } from "@leasing/core";
import { type Tx, unitPhotos, units, withTx } from "@leasing/db";
import { formatSlot } from "@leasing/helpers";
import { and, asc, eq, inArray } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, DomainError, notFound } from "../errors.ts";
import {
  createApplication,
  MAX_OPEN_WEB_PER_EMAIL,
  openApplicationsFor,
  openWebApplicationsFor,
} from "../manager/applications.ts";
import { listedUnit, listedUnits, takenViewings } from "../manager/availability.ts";
import { publicPhotoPath } from "../manager/enquiries.ts";
import { getCompanyPolicy } from "../manager/events.ts";
import { freeViewingSlots } from "../manager/viewing-slots.ts";
import type { AuthEnv } from "./auth.ts";
import { clientIp, ipLimiter, secretGate } from "./secret-gate.ts";

/**
 * Public listings and the viewing enquiry form (decisions P6, P7). Called by the web server only,
 * with `CHANNEL_SECRET`, and limited per forwarded client IP. Only bookable units are visible
 * (the same rule as the chat); no landlord or internal field leaves here. Rent is formatted by
 * code from the asking rent.
 */

const MAX_READS_PER_IP = 3000;
const MAX_ENQUIRIES_PER_IP = 10;
const SLOTS_SHOWN = 8;

type UnitRow = typeof units.$inferSelect;

const httpsOnly = (u: string | null) => (u && /^https:\/\//i.test(u) ? u : null);

async function photoIds(tx: Tx, unitIds: string[]): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (!unitIds.length) return out;
  const rows = await tx.db
    .select({ id: unitPhotos.id, unitId: unitPhotos.unitId })
    .from(unitPhotos)
    .where(inArray(unitPhotos.unitId, unitIds))
    .orderBy(asc(unitPhotos.sort), asc(unitPhotos.createdAt));
  for (const r of rows) out.set(r.unitId, [...(out.get(r.unitId) ?? []), r.id]);
  return out;
}

function summary(u: UnitRow) {
  const fils = u.askingRentFils!;
  return {
    id: u.id,
    code: u.code,
    building: u.building,
    community: u.community,
    bedrooms: u.bedrooms,
    bathrooms: u.bathrooms,
    areaSqft: u.areaSqft,
    furnished: u.furnished ?? false,
    category: u.category,
    subtype: u.subtype,
    rent: formatAed(fils),
    rentFils: fils,
  };
}

const ListQuery = z.object({
  category: z.enum(["residential", "commercial", "retail", "all"]).default("residential"),
  community: z.string().trim().min(1).max(120).optional(),
  /** 0 is a studio; 4 means four or more (as the chat filter). */
  bedrooms: z.coerce.number().int().min(0).max(4).optional(),
  /** Floor-area band; only narrows commercial and retail units. */
  size: z.enum(["small", "medium", "large"]).optional(),
  /** Annual rent ceiling in whole AED. */
  budget: z.coerce.number().int().min(1).max(999_999_999).optional(),
});

const EnquiryBody = z.object({
  unitId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  phone: z
    .string()
    .trim()
    .max(40)
    .optional()
    .transform((p, ctx) => {
      if (!p) return null;
      const n = normalisePhone(p);
      if (!n) ctx.addIssue({ code: "custom", message: "not a phone number" });
      return n;
    }),
  slot: z.iso.datetime({ offset: true }).transform((s) => new Date(s)),
  visitorId: z.uuid().optional(),
});

export function registerPublicRoutes(
  app: Hono<AuthEnv>,
  ctx: EngineContext,
  secret: string | undefined,
  mediaStore?: LocalDiskStore,
) {
  const gate = secretGate(secret);
  const readLimited = ipLimiter(MAX_READS_PER_IP);
  const enquiryLimited = ipLimiter(MAX_ENQUIRIES_PER_IP);
  const tooMany = (c: Parameters<typeof gate>[0]) =>
    c.json({ error: "Too many requests; try again later.", code: "rate_limited" }, 429);

  // Listing pages and photos show every category; viewings through the form stay residential (slots, enquiries).
  const bookable = (tx: Tx, unitId: string, anyCategory = false) =>
    listedUnit(tx, ctx.clock.today(), unitId, anyCategory);
  const unitId = (raw: string) => {
    const id = z.uuid().safeParse(raw);
    if (!id.success) throw notFound("unit");
    return id.data;
  };

  app.get("/public/units", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (readLimited(clientIp(c))) return tooMany(c);
    // Residential unless asked: `?category=all|commercial|retail` widens it (the web grid shows what the chat can show).
    const q = ListQuery.parse({
      category: c.req.query("category"),
      community: c.req.query("community"),
      bedrooms: c.req.query("bedrooms"),
      size: c.req.query("size"),
      budget: c.req.query("budget"),
    });
    const band = q.size ? SIZE_BAND_LIMITS[q.size] : undefined;
    const out = await withTx(ctx.database, async (tx) => {
      const rows = (
        await listedUnits(
          tx,
          ctx.clock.today(),
          {
            category: q.category,
            community: q.community,
            bedrooms: q.bedrooms,
            maxRentFils: q.budget === undefined ? undefined : q.budget * 100,
          },
          500,
        )
      ).filter(
        (u) =>
          !band ||
          u.category === "residential" ||
          (u.areaSqft !== null &&
            (band.min === undefined || u.areaSqft >= band.min) &&
            (band.max === undefined || u.areaSqft <= band.max)),
      );
      const photos = await photoIds(
        tx,
        rows.map((u) => u.id),
      );
      return rows.map((u) => ({
        ...summary(u),
        description: u.description?.trim().slice(0, 300) || null,
        photoUrls: (photos.get(u.id) ?? []).slice(0, 1).map((p) => publicPhotoPath(u.id, p)),
      }));
    });
    return c.json(out);
  });

  app.get("/public/units/:id", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (readLimited(clientIp(c))) return tooMany(c);
    const id = unitId(c.req.param("id"));
    const out = await withTx(ctx.database, async (tx) => {
      const u = await bookable(tx, id, true);
      if (!u) return null;
      const photos = (await photoIds(tx, [u.id])).get(u.id) ?? [];
      return {
        ...summary(u),
        floor: u.floor,
        parkingSpaces: u.parkingSpaces,
        description: u.description?.trim() || null,
        virtualTourUrl: httpsOnly(u.virtualTourUrl),
        photoUrls: photos.map((p) => publicPhotoPath(u.id, p)),
      };
    });
    if (!out) throw notFound("unit");
    return c.json(out);
  });

  app.get("/public/units/:id/photos/:photoId", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (readLimited(clientIp(c))) return tooMany(c);
    const id = unitId(c.req.param("id"));
    const photoId = z.uuid().safeParse(c.req.param("photoId"));
    const photo = await withTx(ctx.database, async (tx) => {
      if (!photoId.success || !(await bookable(tx, id, true))) return null;
      const [p] = await tx.db
        .select({ path: unitPhotos.path, mime: unitPhotos.mime, sha256: unitPhotos.sha256 })
        .from(unitPhotos)
        .where(and(eq(unitPhotos.id, photoId.data), eq(unitPhotos.unitId, id)));
      return p ?? null;
    });
    if (!photo || !mediaStore) throw new DomainError("photo not found", 404, "not_found");
    const bytes = await mediaStore.read(photo.path).catch(() => null);
    if (!bytes) throw new DomainError("photo not found", 404, "not_found");
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": photo.mime,
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
      etag: `"${photo.sha256}"`,
    });
  });

  app.get("/public/units/:id/slots", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (readLimited(clientIp(c))) return tooMany(c);
    const id = unitId(c.req.param("id"));
    const slots = await withTx(ctx.database, async (tx) => {
      const policy = await getCompanyPolicy(tx, ctx.clock.today());
      const u = await listedUnit(tx, ctx.clock.today(), id);
      if (!u) return null;
      return freeViewingSlots(ctx.clock.now(), policy, await takenViewings(tx, u.id), SLOTS_SHOWN);
    });
    if (!slots) throw notFound("unit");
    return c.json(slots.map((s) => ({ at: s.toISOString(), label: formatSlot(s, "en") })));
  });

  app.post("/public/enquiries", async (c) => {
    const denied = gate(c);
    if (denied) return denied;
    if (enquiryLimited(clientIp(c))) return tooMany(c);
    const body = EnquiryBody.parse(await c.req.json().catch(() => ({})));
    // Actor: the existing `enquirer:` variant (Telegram and web-chat enquirers), tagged `web-form`
    // with the visitor id when the web server sends one, so the audit trail tells the form from the chat.
    const actor: Actor = `enquirer:web-form:${body.visitorId ?? newId()}`;
    const created = await withTx(ctx.database, async (tx) => {
      // The unit row first (as createApplication and bookViewing do), so racing enquiries queue up
      // and the later one sees the earlier booking.
      await tx.db.select({ id: units.id }).from(units).where(eq(units.id, body.unitId)).for("update");
      const policy = await getCompanyPolicy(tx, ctx.clock.today());
      if (!(await listedUnit(tx, ctx.clock.today(), body.unitId)))
        throw conflict("This unit is no longer available to view.", "unit_not_bookable");
      const open = await openApplicationsFor(tx, body.email);
      if (open.some((o) => o.unitId === body.unitId))
        throw conflict("You already have a viewing request for this unit.", "already_enquired");
      if ((await openWebApplicationsFor(tx, body.email)) >= MAX_OPEN_WEB_PER_EMAIL)
        throw new DomainError("Too many open viewing requests for this email address.", 429, "too_many_enquiries");
      const taken = await takenViewings(tx, body.unitId);
      const at = body.slot.getTime();
      const onGrid = (list: Date[]) => list.some((s) => s.getTime() === at);
      if (!onGrid(freeViewingSlots(ctx.clock.now(), policy, taken, Number.POSITIVE_INFINITY))) {
        // On the grid but not free: someone booked it. Otherwise it is past, off-grid or out of range.
        const grid = freeViewingSlots(ctx.clock.now(), policy, [], Number.POSITIVE_INFINITY);
        if (onGrid(grid))
          throw conflict("That viewing time was just taken; please pick another.", "viewing_slot_taken");
        throw conflict("That time isn't available. Pick another.", "viewing_slot_unavailable");
      }
      return createApplication(
        ctx,
        {
          unitId: body.unitId,
          nameEn: body.name,
          email: body.email,
          phone: body.phone,
          kind: "individual",
          viewingAt: body.slot,
          source: "web_form",
        },
        actor,
        tx,
      );
    });
    return c.json({ ref: created.ref }, 201);
  });
}
