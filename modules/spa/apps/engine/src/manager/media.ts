import { type LocalDiskStore, sniffImage, stripImageMetadata } from "@platform/adapters";
import { newId } from "@platform/kernel/ids";
import { type MediaOwnerKind, type SpaRole } from "@spa/core";
import { listings, projects, spaMedia, type SpaDb, units, withSpaTx } from "@spa/db";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import { requireInventory } from "./inventory.ts";
import { requireListings } from "./listing-reads.ts";
import { isPublicMediaOwner } from "./public-catalogue.ts";

/**
 * Marketing photos of a project, unit or listing (S75). Not personal data and never mixed with party documents:
 * their own store (`data/spa-media`) and their own table. The owner's existence is checked here, since one column
 * can't reference three tables. Inventory photos are an admin's; listing photos follow the listing's write roles.
 */
type Person = { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined };
export type MediaOwner = { kind: MediaOwnerKind; id: string };
export type MediaRow = typeof spaMedia.$inferSelect;

export const MAX_MEDIA_BYTES = 10 * 1024 * 1024;
export const MAX_MEDIA_PER_OWNER = 24;
const Caption = z
  .string()
  .trim()
  .max(200, "at most 200 characters")
  .nullable()
  .transform((c) => c || null);
const actorOf = (u: Person) => `user:${u.id}` as const;

async function requireRole(db: SpaDb, owner: MediaOwner, user: Person, mode: "read" | "write") {
  if (owner.kind === "listing") await requireListings(db, user, mode);
  else await requireInventory(db, user, mode);
}

const ownerTable = { project: projects, unit: units, listing: listings } as const;

/** 404 unless the owner exists. */
async function requireOwner(db: SpaDb, owner: MediaOwner): Promise<void> {
  const t = ownerTable[owner.kind];
  const [row] = await db.select({ id: t.id }).from(t).where(eq(t.id, owner.id));
  if (!row) throw notFound(owner.kind);
}

async function mediaOf(db: SpaDb, mediaId: string): Promise<MediaRow> {
  const [m] = await db.select().from(spaMedia).where(eq(spaMedia.id, mediaId));
  if (!m) throw notFound("photo");
  return m;
}

export async function listMedia(
  db: SpaDb,
  owner: MediaOwner,
): Promise<{ id: string; caption: string | null; sort: number }[]> {
  return db
    .select({ id: spaMedia.id, caption: spaMedia.caption, sort: spaMedia.sort })
    .from(spaMedia)
    .where(and(eq(spaMedia.ownerKind, owner.kind), eq(spaMedia.ownerId, owner.id)))
    .orderBy(asc(spaMedia.sort), asc(spaMedia.createdAt));
}

/** The photo list of one owner for a signed-in reader (the role rule of its kind). */
export async function listMediaFor(ctx: SpaContext, owner: MediaOwner, user: Person) {
  await requireRole(ctx.database.db, owner, user, "read");
  await requireOwner(ctx.database.db, owner);
  return listMedia(ctx.database.db, owner);
}

export async function addMedia(
  ctx: SpaContext,
  store: LocalDiskStore,
  owner: MediaOwner,
  bytes: Uint8Array,
  caption: string | null,
  user: Person,
): Promise<{ media: MediaRow; duplicate: boolean }> {
  const db = ctx.database.db;
  await requireRole(db, owner, user, "write");
  await requireOwner(db, owner);
  const cap = Caption.safeParse(caption);
  if (!cap.success) throw unprocessable("invalid_caption", "the caption is too long");
  if (bytes.byteLength > MAX_MEDIA_BYTES) throw unprocessable("too_large", "the photo is larger than 10 MB");
  const type = sniffImage(bytes);
  if (!type) throw unprocessable("unsupported_type", "only JPEG, PNG or WebP photos");
  // EXIF, GPS, XMP and the like never reach the disk, whichever way the file arrived.
  const clean = stripImageMetadata(bytes, type);
  if (!clean) throw unprocessable("unsupported_type", "the photo file looks damaged; export it again and retry");
  const stored = await store.put(clean, type.ext);
  const t = ownerTable[owner.kind];
  try {
    return await withSpaTx(ctx.database, async (tx) => {
      // Lock the owner so two uploads can't both pass the count at 23.
      const [locked] = await tx.db.select({ id: t.id }).from(t).where(eq(t.id, owner.id)).for("update");
      if (!locked) throw notFound(owner.kind);
      const existing = await tx.db
        .select()
        .from(spaMedia)
        .where(and(eq(spaMedia.ownerKind, owner.kind), eq(spaMedia.ownerId, owner.id)));
      const dup = existing.find((m) => m.sha256 === stored.sha256);
      if (dup) return { media: dup, duplicate: true };
      if (existing.length >= MAX_MEDIA_PER_OWNER)
        throw unprocessable("too_many", `at most ${MAX_MEDIA_PER_OWNER} photos each`);
      const sort = existing.reduce((m, p) => Math.max(m, p.sort + 1), 0);
      const [media] = await tx.db
        .insert(spaMedia)
        .values({
          id: newId(),
          ownerKind: owner.kind,
          ownerId: owner.id,
          sha256: stored.sha256,
          path: stored.path,
          mime: type.mime,
          bytes: stored.bytes,
          caption: cap.data,
          sort,
          uploadedBy: actorOf(user),
          createdAt: ctx.clock.now(),
        })
        .returning();
      await appendDealEvent(tx, ctx, {
        entity: owner,
        type: "MEDIA_ADDED",
        actor: actorOf(user),
        payload: { mediaId: media!.id, sha256: stored.sha256, bytes: stored.bytes },
      });
      return { media: media!, duplicate: false };
    });
  } catch (e) {
    await dropIfUnused(db, store, stored.sha256, stored.path);
    throw e;
  }
}

/** Files are content-addressed and may be shared by owners: the bytes go only when no row uses them. */
async function dropIfUnused(db: SpaDb, store: LocalDiskStore, sha256: string, path: string) {
  const [used] = await db.select({ id: spaMedia.id }).from(spaMedia).where(eq(spaMedia.sha256, sha256)).limit(1);
  if (!used) await store.remove(path);
}

export async function removeMedia(ctx: SpaContext, store: LocalDiskStore, mediaId: string, user: Person) {
  const db = ctx.database.db;
  const m = await mediaOf(db, mediaId);
  const owner = { kind: m.ownerKind, id: m.ownerId };
  await requireRole(db, owner, user, "write");
  await withSpaTx(ctx.database, async (tx) => {
    const [gone] = await tx.db.delete(spaMedia).where(eq(spaMedia.id, mediaId)).returning();
    if (!gone) throw notFound("photo");
    await appendDealEvent(tx, ctx, {
      entity: owner,
      type: "MEDIA_REMOVED",
      actor: actorOf(user),
      payload: { mediaId, sha256: m.sha256, bytes: m.bytes },
    });
  });
  await dropIfUnused(db, store, m.sha256, m.path);
}

/** `ids` must list every photo of the owner once; the first becomes the cover. */
export async function reorderMedia(ctx: SpaContext, owner: MediaOwner, ids: string[], user: Person) {
  await requireRole(ctx.database.db, owner, user, "write");
  await requireOwner(ctx.database.db, owner);
  await withSpaTx(ctx.database, async (tx) => {
    const rows = await tx.db
      .select({ id: spaMedia.id })
      .from(spaMedia)
      .where(and(eq(spaMedia.ownerKind, owner.kind), eq(spaMedia.ownerId, owner.id)))
      .for("update");
    const current = new Set(rows.map((r) => r.id));
    if (ids.length !== current.size || new Set(ids).size !== ids.length || !ids.every((i) => current.has(i)))
      throw unprocessable("invalid_order", "list every photo exactly once");
    for (const [sort, id] of ids.entries()) await tx.db.update(spaMedia).set({ sort }).where(eq(spaMedia.id, id));
    await appendDealEvent(tx, ctx, {
      entity: owner,
      type: "MEDIA_REORDERED",
      actor: actorOf(user),
      payload: { coverMediaId: ids[0] ?? null, count: ids.length },
    });
  });
}

export async function captionMedia(ctx: SpaContext, mediaId: string, caption: string | null, user: Person) {
  const db = ctx.database.db;
  const m = await mediaOf(db, mediaId);
  const owner = { kind: m.ownerKind, id: m.ownerId };
  await requireRole(db, owner, user, "write");
  const cap = Caption.safeParse(caption);
  if (!cap.success) throw unprocessable("invalid_caption", "the caption is too long");
  await withSpaTx(ctx.database, async (tx) => {
    await tx.db.update(spaMedia).set({ caption: cap.data }).where(eq(spaMedia.id, mediaId));
    await appendDealEvent(tx, ctx, {
      entity: owner,
      type: "MEDIA_CAPTIONED",
      actor: actorOf(user),
      payload: { mediaId, sha256: m.sha256, bytes: m.bytes },
    });
  });
}

export async function readMedia(
  ctx: SpaContext,
  store: LocalDiskStore,
  mediaId: string,
  user: Person,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string }> {
  const m = await mediaOf(ctx.database.db, mediaId);
  await requireRole(ctx.database.db, { kind: m.ownerKind, id: m.ownerId }, user, "read");
  return { bytes: new Uint8Array(await store.read(m.path)) as Uint8Array<ArrayBuffer>, mime: m.mime };
}

/**
 * A photo for a visitor with no sign-in (S78): served only while its owner is public right now (a published listing with
 * a valid permit, an available unit on sale, or the project of one). Anything else, including an unknown id, is null.
 */
export async function readPublicMedia(
  ctx: SpaContext,
  store: LocalDiskStore,
  mediaId: string,
): Promise<{ bytes: Uint8Array<ArrayBuffer>; mime: string } | null> {
  const [m] = await ctx.database.db.select().from(spaMedia).where(eq(spaMedia.id, mediaId));
  if (!m || !(await isPublicMediaOwner(ctx, m.ownerKind, m.ownerId))) return null;
  return { bytes: new Uint8Array(await store.read(m.path)) as Uint8Array<ArrayBuffer>, mime: m.mime };
}
