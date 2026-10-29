import type { LocalDiskStore } from "@leasing/adapters";
import { PropertyCategory, PropertySubtype, type StaffRole } from "@leasing/core";
import { approvals, leaseParties, leases, parties, unitPhotos, units, withTx } from "@leasing/db";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound, unprocessable } from "../errors.ts";
import { advance } from "../manager/advance.ts";
import {
  addUnitPhoto,
  createUnit,
  listUnitPhotos,
  removeUnitPhoto,
  reorderUnitPhotos,
  requestPriceApproval,
  setPhotoCaption,
  UnitFields,
  UnitUpdate,
  exposeRange,
  unitActions,
  updateUnit,
} from "../manager/units.ts";
import { type AuthEnv, requireRole } from "./auth.ts";
import { entityEvents } from "./queries.ts";
import { priceRangeFor } from "../manager/pricing.ts";
import { lookupCompanyLandlord } from "../manager/company-legal.ts";

/** Units are managed by leasing staff and admins; finance can look but not change. */
const EDITORS: StaffRole[] = ["admin", "leasing_manager", "leasing_officer"];

const PriceRangeQuery = z.object({
  companyId: z.string().uuid(),
  category: PropertyCategory,
  subtype: PropertySubtype.nullable(),
  community: z.string().trim().min(1).max(120),
  bedrooms: z.number().int().min(0).max(10).nullable(),
  areaSqft: z.number().int().min(50).max(100_000).nullable(),
});
const actorOf = (c: { get(k: "user"): { id: string } }) => `user:${c.get("user").id}` as const;

export function registerUnitRoutes(api: Hono<AuthEnv>, ctx: EngineContext, store: LocalDiskStore) {
  const db = ctx.database.db;

  api.get("/units", async (c) => {
    const rows = await db
      .select({
        unit: units,
        coverPhotoId: sql<
          string | null
        >`(select p.id from unit_photos p where p.unit_id = "units"."id" order by p.sort limit 1)`,
        photoCount: sql<number>`(select count(*)::int from unit_photos p where p.unit_id = "units"."id")`,
      })
      .from(units)
      .orderBy(asc(units.code));
    const live = await db
      .select({
        unitId: leases.unitId,
        ref: leases.ref,
        state: leases.state,
        id: leases.id,
        endOn: leases.endOn,
        annualRentFils: leases.annualRentFils,
      })
      .from(leases)
      .where(ne(leases.state, "CLOSED"));
    return c.json(
      rows.map((r) => ({
        ...r.unit,
        coverPhotoId: r.coverPhotoId,
        photoCount: r.photoCount,
        lease: live.find((l) => l.unitId === r.unit.id) ?? null,
      })),
    );
  });

  api.get("/units/:id", async (c) => {
    const id = c.req.param("id");
    const result = await withTx(ctx.database, async (tx) => {
      const [unit] = await tx.db.select().from(units).where(eq(units.id, id));
      if (!unit) return null;
      const [photos, unitLeases, events, aps, status] = await Promise.all([
        listUnitPhotos(tx, id),
        tx.db
          .select({
            id: leases.id,
            ref: leases.ref,
            state: leases.state,
            startOn: leases.startOn,
            endOn: leases.endOn,
            annualRentFils: leases.annualRentFils,
          })
          .from(leases)
          .where(eq(leases.unitId, id))
          .orderBy(desc(leases.startOn)),
        entityEvents(tx.db, "unit", id, 100),
        tx.db.select().from(approvals).where(eq(approvals.entityId, id)).orderBy(desc(approvals.createdAt)),
        unitActions(ctx, tx, unit),
      ]);
      const tenants = unitLeases.length
        ? await tx.db
            .select({ leaseId: leaseParties.leaseId, name: parties.fullNameEn })
            .from(leaseParties)
            .innerJoin(parties, eq(parties.id, leaseParties.partyId))
            .where(
              and(
                inArray(
                  leaseParties.leaseId,
                  unitLeases.map((l) => l.id),
                ),
                eq(leaseParties.role, "tenant"),
              ),
            )
        : [];
      // The unit's landlord is its company (D44): its legal name, with the company id for the link.
      const { party } = await lookupCompanyLandlord(tx, unit.companyId);
      const { landlordPartyId: _unused, ...unitRest } = unit;
      return {
        ...unitRest,
        landlord: { companyId: unit.companyId, name: party.fullNameEn },
        photos,
        leases: unitLeases.map((l) => ({ ...l, tenantName: tenants.find((t) => t.leaseId === l.id)?.name ?? null })),
        events,
        approvals: aps,
        ...status,
      };
    });
    if (!result) throw notFound("unit");
    return c.json(result);
  });

  /** Allowed asking-rent range for the unit form preview. Any signed-in staff. */
  api.post("/units/price-range", async (c) => {
    const b = PriceRangeQuery.parse(await c.req.json());
    const out = await withTx(ctx.database, (tx) =>
      priceRangeFor(tx, { ...b, emirate: "dubai", bedrooms: b.bedrooms, areaSqft: b.areaSqft }, ctx.clock.today()),
    );
    return c.json({ range: exposeRange(out.range), sriLabel: out.sriLabel, ruleId: out.ruleId });
  });
  api.post("/units", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const input = UnitFields.parse(await c.req.json());
    return c.json(await createUnit(ctx, input, actorOf(c)), 201);
  });

  api.patch("/units/:id", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const patch = UnitUpdate.parse(await c.req.json());
    return c.json(await updateUnit(ctx, c.req.param("id"), patch, actorOf(c)));
  });

  api.post("/units/:id/events", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const { event } = z.object({ event: z.enum(["MARK_READY", "PUBLISH", "WITHDRAW"]) }).parse(await c.req.json());
    return c.json(await advance(ctx, { kind: "unit", id: c.req.param("id") }, event, { actor: actorOf(c) }));
  });

  api.post("/units/:id/price-approval", async (c) => {
    requireRole(c.get("user"), EDITORS);
    return c.json(await requestPriceApproval(ctx, c.req.param("id"), actorOf(c)), 201);
  });

  // Photos: multipart upload, one file per request.
  api.post("/units/:id/photos", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const form = await c.req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw unprocessable("attach a photo as `file`", [], "invalid_request");
    const caption =
      z
        .string()
        .trim()
        .max(140)
        .optional()
        .parse(form.get("caption") ?? undefined) || null;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const r = await addUnitPhoto(ctx, store, c.req.param("id"), bytes, caption, actorOf(c));
    return c.json(r, r.duplicate ? 200 : 201);
  });

  api.get("/units/:id/photos/:photoId", async (c) => {
    const [p] = await db
      .select()
      .from(unitPhotos)
      .where(and(eq(unitPhotos.id, c.req.param("photoId")), eq(unitPhotos.unitId, c.req.param("id"))));
    if (!p) throw notFound("photo");
    const bytes = await store.read(p.path);
    return c.body(new Uint8Array(bytes), 200, {
      "content-type": p.mime,
      // Content-addressed: the bytes behind a photo id never change.
      "cache-control": "private, max-age=31536000, immutable",
      etag: `"${p.sha256}"`,
    });
  });

  api.patch("/units/:id/photos/:photoId", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const { caption } = z.object({ caption: z.string().trim().max(140).nullable() }).parse(await c.req.json());
    return c.json(await setPhotoCaption(ctx, c.req.param("id"), c.req.param("photoId"), caption || null, actorOf(c)));
  });

  api.delete("/units/:id/photos/:photoId", async (c) => {
    requireRole(c.get("user"), EDITORS);
    await removeUnitPhoto(ctx, store, c.req.param("id"), c.req.param("photoId"), actorOf(c));
    return c.body(null, 204);
  });

  api.put("/units/:id/photos/order", async (c) => {
    requireRole(c.get("user"), EDITORS);
    const { ids } = z.object({ ids: z.array(z.string()).max(50) }).parse(await c.req.json());
    await reorderUnitPhotos(ctx, c.req.param("id"), ids, actorOf(c));
    return c.body(null, 204);
  });
}
