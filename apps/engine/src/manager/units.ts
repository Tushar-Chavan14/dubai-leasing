import type { LocalDiskStore } from "@leasing/adapters";
import { sniffImage, stripImageMetadata } from "@leasing/adapters";
import {
  type Actor,
  askingRentWithinRange,
  formatAed,
  newId,
  type PriceRange,
  PropertyCategory,
  PropertySubtype,
  SUBTYPES_BY_CATEGORY,
  type UnitEvent,
  unitChecklistMissing,
  unitMachine,
} from "@leasing/core";
import { approvals, companies, leases, type Tx, unitPhotos, units, withTx } from "@leasing/db";
import { and, asc, eq, like, ne, or } from "drizzle-orm";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound, unprocessable } from "../errors.ts";
import { unitHasActiveEjari, unitHasContractedLease } from "./advance.ts";
import { requestApproval } from "./approvals.ts";
import { appendEvent, getCompanyPolicyVersion } from "./events.ts";
import { effectiveProposal, PriceProposal } from "./gate-rules.ts";
import { priceRangeFor } from "./pricing.ts";

type ApprovalRow = typeof approvals.$inferSelect;

const optText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => (v === "" ? null : v))
    .nullable();
const optInt = (min: number, max: number) => z.number().int().min(min).max(max).nullable();

/** Unit fields staff can enter. Checklist fields may be left empty while the unit is in PREP. */
const UnitFieldsBase = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z0-9][A-Z0-9-]{1,23}$/, "letters, digits and dashes, e.g. MRN-1204"),
  building: z.string().trim().min(1).max(120),
  community: z.string().trim().min(1).max(120),
  companyId: z.string().uuid(),
  category: PropertyCategory,
  subtype: PropertySubtype.nullable(),
  emirate: z.literal("dubai").default("dubai"),
  unitNo: optText(20),
  floor: optInt(-5, 200),
  dldPropertyNo: optText(40),
  makaniNo: z
    .string()
    .trim()
    .transform((v) => v.replace(/\s/g, ""))
    .refine((v) => v === "" || /^\d{10}$/.test(v), "Makani numbers have 10 digits")
    .transform((v) => (v === "" ? null : v))
    .nullable(),
  plotNo: optText(40),
  dewaPremiseNo: optText(40),
  areaSqft: optInt(50, 100_000),
  bedrooms: optInt(0, 10),
  bathrooms: optInt(0, 10),
  parkingSpaces: optInt(0, 10),
  furnished: z.boolean().nullable(),
  askingRentFils: z.number().int().positive().max(100_000_000_00).nullable(),
  description: optText(4000),
  /** External virtual tour shown to applicants: https only. Optional so older clients still validate. */
  virtualTourUrl: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || /^https:\/\/[^\s/]+\.[^\s]*$/i.test(v), "the tour link must start with https://")
    .transform((v) => (v === "" ? null : v))
    .nullable()
    .optional(),
});
export const UnitFields = UnitFieldsBase.refine(
  (u) => u.subtype === null || SUBTYPES_BY_CATEGORY[u.category].includes(u.subtype),
  { message: "this type doesn't belong to the category", path: ["subtype"] },
);
export type UnitFields = z.infer<typeof UnitFields>;
export const UnitUpdate = UnitFieldsBase.partial();

/** Changing these after a lease exists would break the match with Ejari and the contract. */
/** `category` too: usage is part of the Ejari record and sets the own-use lock length. */
const IDENTITY_FIELDS = ["code", "unitNo", "dldPropertyNo", "makaniNo", "plotNo", "category", "companyId"] as const;
/** Anything that picks the rent rule, the SRI row or the band. A change voids a price approval. */
const PRICE_INPUT_FIELDS = [
  "companyId",
  "category",
  "subtype",
  "community",
  "emirate",
  "areaSqft",
  "askingRentFils",
  "bedrooms",
] as const;
const CHECKLIST_FIELDS = [
  "dldPropertyNo",
  "unitNo",
  "makaniNo",
  "areaSqft",
  "bedrooms",
  "furnished",
  "dewaPremiseNo",
] as const;
const MAX_PHOTOS = 24;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024;

/** The company must exist and be active before a unit can belong to it. */
async function companyProblem(tx: Tx, companyId: string): Promise<string | null> {
  const [c] = await tx.db.select({ active: companies.active }).from(companies).where(eq(companies.id, companyId));
  if (!c) return "company not found";
  return c.active ? null : "company is inactive";
}

/**
 * Server-side options for creating a unit. Not part of `UnitFields`.
 */
export interface CreateUnitOptions {
  /** Where the unit came from; recorded in the UNIT_CREATED event payload. */
  source?: "import";
}

export async function createUnit(ctx: EngineContext, input: UnitFields, actor: Actor, opts: CreateUnitOptions = {}) {
  return withTx(ctx.database, (tx) => createUnitInTx(ctx, tx, input, actor, opts));
}

/** `createUnit` inside the caller's transaction. Units always start in PREP. */
export async function createUnitInTx(
  ctx: EngineContext,
  tx: Tx,
  input: UnitFields,
  actor: Actor,
  opts: CreateUnitOptions = {},
) {
  const [clash] = await tx.db.select({ id: units.id }).from(units).where(eq(units.code, input.code));
  if (clash) throw conflict(`unit code ${input.code} is already used`, "duplicate_code");
  const badCompany = await companyProblem(tx, input.companyId);
  if (badCompany) throw unprocessable("unit can't be saved this way", [badCompany], "invalid_change");
  const id = newId();
  const [row] = await tx.db
    .insert(units)
    .values({ id, ...input, state: "PREP" })
    .returning();
  await appendEvent(tx, ctx, {
    entity: { kind: "unit", id },
    type: "UNIT_CREATED",
    actor,
    toState: "PREP",
    payload: opts.source ? { code: input.code, source: opts.source } : { code: input.code },
    rulesVersion: ctx.rulesVersion,
  });
  return row!;
}

export async function updateUnit(ctx: EngineContext, id: string, patch: z.infer<typeof UnitUpdate>, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [unit] = await tx.db.select().from(units).where(eq(units.id, id)).for("update");
    if (!unit) throw notFound("unit");
    const changed = Object.entries(patch).filter(
      ([k, v]) => v !== undefined && JSON.stringify(unit[k as keyof typeof unit]) !== JSON.stringify(v),
    );
    if (!changed.length) return unit;
    const keys = changed.map(([k]) => k);
    const problems: string[] = [];

    const hasLease =
      (
        await tx.db
          .select({ id: leases.id })
          .from(leases)
          .where(and(eq(leases.unitId, id), ne(leases.state, "CLOSED")))
          .limit(1)
      ).length > 0;
    if (hasLease) {
      for (const k of IDENTITY_FIELDS)
        if (keys.includes(k)) problems.push(`${k} can't change while the unit has a lease`);
    }
    if (patch.code && patch.code !== unit.code) {
      const [clash] = await tx.db.select({ id: units.id }).from(units).where(eq(units.code, patch.code));
      if (clash) problems.push(`unit code ${patch.code} is already used`);
    }
    if (patch.companyId !== undefined && patch.companyId !== unit.companyId) {
      const badCompany = await companyProblem(tx, patch.companyId);
      if (badCompany) throw unprocessable("unit can't be saved this way", [badCompany], "invalid_change");
    }
    if (unit.state !== "PREP") {
      const nextCategory = patch.category ?? unit.category;
      for (const k of CHECKLIST_FIELDS) {
        if (k === "bedrooms" && nextCategory !== "residential") continue;
        if (keys.includes(k) && (patch[k] === null || patch[k] === ""))
          problems.push(`${k} is required once the unit is ${unit.state}`);
      }
      if (keys.includes("category")) {
        for (const m of unitChecklistMissing({ ...unit, ...patch } as typeof unit))
          problems.push(`missing ${m}: required once the unit is ${unit.state}`);
      }
    }
    if (keys.includes("category") || keys.includes("subtype")) {
      const next = { ...unit, ...patch } as typeof unit;
      if (next.subtype !== null && !SUBTYPES_BY_CATEGORY[next.category].includes(next.subtype)) {
        problems.push(`${next.subtype} doesn't belong to the ${next.category} category`);
      }
    }
    // The allowed range depends on the company, type, area, rent and bedrooms: a change voids a price approval.
    const priceInputsChanged = PRICE_INPUT_FIELDS.some((k) => keys.includes(k));
    if (priceInputsChanged && (unit.state === "READY" || unit.state === "LISTED")) {
      const next = { ...unit, ...patch, priceApprovedAt: null } as typeof unit;
      const { range } = await priceRangeFor(tx, next, ctx.clock.today());
      if (!askingRentWithinRange(next, range)) {
        problems.push(
          "asking rent would be outside the allowed range: move the unit back to preparation and request approval",
        );
      }
    }
    if (problems.length) throw unprocessable("unit can't be changed this way", problems, "invalid_change");

    if (priceInputsChanged) await cancelPendingPriceApprovals(ctx, tx, id);
    const set = Object.fromEntries(changed) as Partial<typeof unit>;
    const [row] = await tx.db
      .update(units)
      .set({ ...set, ...(priceInputsChanged ? { priceApprovedAt: null } : {}), updatedAt: ctx.clock.now() })
      .where(eq(units.id, id))
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id },
      type: "UNIT_UPDATED",
      actor,
      payload: {
        changed: Object.fromEntries(changed.map(([k, v]) => [k, { from: unit[k as keyof typeof unit], to: v }])),
        ...(priceInputsChanged && unit.priceApprovedAt ? { priceApprovalCleared: true } : {}),
      },
      rulesVersion: ctx.rulesVersion,
    });
    return row!;
  });
}

/** A proposal made for old pricing inputs no longer applies once any of them changes. */
async function cancelPendingPriceApprovals(ctx: EngineContext, tx: Tx, unitId: string) {
  const gone = await tx.db
    .update(approvals)
    .set({ status: "cancelled", decidedAt: ctx.clock.now(), decisionNote: "pricing inputs changed" })
    .where(
      and(eq(approvals.entityId, unitId), eq(approvals.gate, "price_out_of_range"), eq(approvals.status, "pending")),
    )
    .returning({ id: approvals.id });
  for (const a of gone) {
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "APPROVAL_CANCELLED",
      actor: "system",
      payload: { approvalId: a.id, gate: "price_out_of_range" },
      rulesVersion: ctx.rulesVersion,
    });
  }
}

/** "AED 95,000" for whole dirhams, with fils otherwise. */
const aed = (fils: number) => formatAed(fils).replace(/\.00$/, "");

/** The real limits of a range: a side with no limit is null, never the sentinel. */
function limitsOf(r: PriceRange): { lo: number | null; hi: number | null } {
  return {
    lo: r.basis.aedMin === null && r.basis.bandMin === null ? null : r.min,
    hi: r.basis.aedMax === null && r.basis.bandMax === null ? null : r.max,
  };
}

/** The range as clients see it: a side with no limit is null, `basis` is kept as is. */
export function exposeRange(r: PriceRange | null) {
  if (!r) return null;
  const { lo, hi } = limitsOf(r);
  return { min: lo, max: hi, basis: r.basis };
}

function describeBand(r: PriceRange): string {
  const { lo, hi } = limitsOf(r);
  if (lo !== null && hi !== null) return `${aed(lo)} to ${aed(hi)}`;
  if (lo !== null) return `${aed(lo)} upwards, no upper limit`;
  if (hi !== null) return `up to ${aed(hi)}, no lower limit`;
  return "no limits";
}

/** Puts an out-of-range asking rent in the inbox for a leasing manager. */
export async function requestPriceApproval(ctx: EngineContext, id: string, actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const [unit] = await tx.db.select().from(units).where(eq(units.id, id)).for("update");
    if (!unit) throw notFound("unit");
    if (unit.askingRentFils === null || (unit.category === "residential" && unit.bedrooms === null)) {
      throw unprocessable(
        unit.category === "residential" ? "set the asking rent and bedrooms first" : "set the asking rent first",
        [],
        "invalid_change",
      );
    }
    const { version: policyVersion } = await getCompanyPolicyVersion(tx, ctx.clock.today());
    const { range, ruleId, sriId, sriLabel } = await priceRangeFor(tx, unit, ctx.clock.today());
    if (askingRentWithinRange(unit, range))
      throw conflict("asking rent is within the allowed range; no approval needed");
    if (unit.priceApprovedAt) throw conflict("this asking rent is already approved");
    const [company] = await tx.db
      .select({ name: companies.name })
      .from(companies)
      .where(eq(companies.id, unit.companyId));
    const base = `${unit.id}:price@${unit.bedrooms ?? unit.category}:${unit.askingRentFils}`;
    const previous = await tx.db
      .select({ status: approvals.status })
      .from(approvals)
      .where(or(eq(approvals.dedupeKey, base), like(approvals.dedupeKey, `${base}#%`)));
    const live = previous.find((p) => p.status === "pending");
    if (live) throw conflict("a price approval for this rent is already waiting");
    const proposal: PriceProposal = {
      unitId: unit.id,
      unitCode: unit.code,
      category: unit.category,
      bedrooms: unit.bedrooms,
      askingRentFils: unit.askingRentFils,
      rangeMinFils: range ? limitsOf(range).lo : null,
      rangeMaxFils: range ? limitsOf(range).hi : null,
      ruleId,
      sriId,
      policyVersion,
    };
    const who = `rent rule for ${company?.name ?? "the company"}, ${unit.category}${sriLabel ? `, ${sriLabel}` : ""}`;
    return requestApproval(ctx, tx, {
      gate: "price_out_of_range",
      entity: { kind: "unit", id: unit.id },
      dedupeKey: previous.length ? `${base}#${previous.length + 1}` : base,
      title: `Asking rent for ${unit.code}`,
      proposal,
      reasons: [
        range
          ? `${aed(unit.askingRentFils)} a year is outside the allowed range ${describeBand(range)} (${who}).`
          : `No allowed range applies to this unit: there is no rent rule, or its limits can't be worked out (${who}).`,
      ],
      sources: [
        { kind: "field", label: "Asking rent", value: aed(unit.askingRentFils) },
        ...(range ? [{ kind: "field" as const, label: "Allowed range", value: describeBand(range) }] : []),
        ...(sriLabel ? [{ kind: "field" as const, label: "Smart Rental Index", value: sriLabel }] : []),
        {
          kind: "field" as const,
          label: "Rent rule",
          value: ruleId === null ? "none" : `${company?.name ?? "company"}, ${unit.category}`,
        },
      ],
      proposedBy: actor,
    });
  });
}

/** Called when a manager approves a price: marks the unit's current asking rent as approved. */
export async function applyApprovedPrice(ctx: EngineContext, tx: Tx, approval: ApprovalRow, userId: string) {
  const p = PriceProposal.parse(effectiveProposal(approval));
  const [unit] = await tx.db.select().from(units).where(eq(units.id, p.unitId)).for("update");
  if (!unit) throw notFound("unit");
  if (unit.askingRentFils !== p.askingRentFils || unit.bedrooms !== p.bedrooms || unit.category !== p.category) {
    throw conflict(
      "the asking rent, bedrooms or category changed after this was proposed; reject it and request approval again",
    );
  }
  await tx.db.update(units).set({ priceApprovedAt: ctx.clock.now() }).where(eq(units.id, unit.id));
  await appendEvent(tx, ctx, {
    entity: { kind: "unit", id: unit.id },
    type: "PRICE_APPROVED",
    actor: `user:${userId}`,
    payload: { approvalId: approval.id, askingRentFils: p.askingRentFils },
    rulesVersion: ctx.rulesVersion,
  });
}

/** Unit events staff can trigger from the unit page, with whether each is allowed right now. */
const STAFF_EVENTS: UnitEvent[] = ["MARK_READY", "PUBLISH", "WITHDRAW"];

export async function unitActions(ctx: EngineContext, tx: Tx, unit: typeof units.$inferSelect) {
  const today = ctx.clock.today();
  const { range, ruleId, sriLabel } = await priceRangeFor(tx, unit, today);
  const guardCtx = {
    unit,
    today,
    priceRange: range,
    hasActiveEjari: await unitHasActiveEjari(tx, unit.id),
    hasContractedLease: await unitHasContractedLease(tx, unit.id),
  };
  return {
    checklistMissing: unitChecklistMissing(unit),
    priceInRange: askingRentWithinRange(unit, range),
    priceRange: exposeRange(range),
    priceBasis: { ruleId, sriLabel },
    actions: unitMachine.transitions
      .filter((t) => t.from === unit.state && STAFF_EVENTS.includes(t.event))
      .map((t) => {
        const g = t.guard?.(guardCtx) ?? { ok: true as const };
        return { event: t.event, to: t.to, allowed: g.ok, reasons: g.ok ? [] : g.reasons };
      }),
  };
}

// --- photos ---------------------------------------------------------------------------------

export async function addUnitPhoto(
  ctx: EngineContext,
  store: LocalDiskStore,
  unitId: string,
  bytes: Uint8Array,
  caption: string | null,
  actor: Actor,
) {
  if (bytes.byteLength > MAX_PHOTO_BYTES) throw unprocessable("photo is larger than 10 MB", [], "too_large");
  const type = sniffImage(bytes);
  if (!type) throw unprocessable("only JPEG, PNG or WebP photos", [], "unsupported_type");
  // Check the unit before writing anything to disk.
  const [exists] = await ctx.database.db.select({ id: units.id }).from(units).where(eq(units.id, unitId));
  if (!exists) throw notFound("unit");
  // Strip EXIF/GPS, XMP and similar here too: uploads may not come through the browser resizer.
  const clean = stripImageMetadata(bytes, type);
  if (!clean) throw unprocessable("the photo file looks damaged; export it again and retry", [], "unsupported_type");
  const stored = await store.put(clean, type.ext);
  return withTx(ctx.database, async (tx) => {
    const [unit] = await tx.db.select({ id: units.id }).from(units).where(eq(units.id, unitId)).for("update");
    if (!unit) throw notFound("unit");
    const existing = await tx.db.select().from(unitPhotos).where(eq(unitPhotos.unitId, unitId));
    const dup = existing.find((p) => p.sha256 === stored.sha256);
    if (dup) return { photo: dup, duplicate: true };
    if (existing.length >= MAX_PHOTOS)
      throw unprocessable(`a unit can have at most ${MAX_PHOTOS} photos`, [], "too_many");
    const sort = existing.reduce((m, p) => Math.max(m, p.sort + 1), 0);
    const [photo] = await tx.db
      .insert(unitPhotos)
      .values({
        id: newId(),
        unitId,
        sha256: stored.sha256,
        path: stored.path,
        mime: type.mime,
        bytes: stored.bytes,
        caption,
        sort,
        uploadedBy: actor,
      })
      .returning();
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "UNIT_PHOTO_ADDED",
      actor,
      payload: { photoId: photo!.id, sha256: stored.sha256, bytes: stored.bytes },
      rulesVersion: ctx.rulesVersion,
    });
    return { photo: photo!, duplicate: false };
  });
}

export async function removeUnitPhoto(
  ctx: EngineContext,
  store: LocalDiskStore,
  unitId: string,
  photoId: string,
  actor: Actor,
) {
  const gone = await withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .delete(unitPhotos)
      .where(and(eq(unitPhotos.id, photoId), eq(unitPhotos.unitId, unitId)))
      .returning();
    if (!row) throw notFound("photo");
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "UNIT_PHOTO_REMOVED",
      actor,
      payload: { photoId, sha256: row.sha256 },
      rulesVersion: ctx.rulesVersion,
    });
    return row;
  });
  // Delete the bytes once no unit uses them (photos are content-addressed and may be shared).
  const [stillUsed] = await ctx.database.db
    .select({ id: unitPhotos.id })
    .from(unitPhotos)
    .where(eq(unitPhotos.sha256, gone.sha256))
    .limit(1);
  if (!stillUsed) await store.remove(gone.path);
}

/** `ids` must list every photo of the unit once; the first becomes the cover. */
export async function reorderUnitPhotos(ctx: EngineContext, unitId: string, ids: string[], actor: Actor) {
  return withTx(ctx.database, async (tx) => {
    const rows = await tx.db
      .select({ id: unitPhotos.id })
      .from(unitPhotos)
      .where(eq(unitPhotos.unitId, unitId))
      .for("update");
    const current = new Set(rows.map((r) => r.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((i) => current.has(i))) {
      throw unprocessable("list every photo of this unit exactly once", [], "invalid_order");
    }
    for (const [sort, id] of ids.entries()) {
      await tx.db.update(unitPhotos).set({ sort }).where(eq(unitPhotos.id, id));
    }
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "UNIT_PHOTOS_REORDERED",
      actor,
      payload: { coverPhotoId: ids[0] ?? null },
      rulesVersion: ctx.rulesVersion,
    });
  });
}

export async function setPhotoCaption(
  ctx: EngineContext,
  unitId: string,
  photoId: string,
  caption: string | null,
  actor: Actor,
) {
  return withTx(ctx.database, async (tx) => {
    const [row] = await tx.db
      .update(unitPhotos)
      .set({ caption })
      .where(and(eq(unitPhotos.id, photoId), eq(unitPhotos.unitId, unitId)))
      .returning();
    if (!row) throw notFound("photo");
    await appendEvent(tx, ctx, {
      entity: { kind: "unit", id: unitId },
      type: "UNIT_PHOTO_CAPTIONED",
      actor,
      payload: { photoId, caption },
      rulesVersion: ctx.rulesVersion,
    });
    return row;
  });
}

export function listUnitPhotos(tx: Tx, unitId: string) {
  return tx.db.select().from(unitPhotos).where(eq(unitPhotos.unitId, unitId)).orderBy(asc(unitPhotos.sort));
}
