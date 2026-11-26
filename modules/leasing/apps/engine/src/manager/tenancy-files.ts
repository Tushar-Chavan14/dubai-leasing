import { sniffImage, stripImageMetadata } from "@leasing/adapters";
import { newId } from "@leasing/core";
import { documents, leases, type Tx, withTx } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { unprocessable } from "../errors.ts";
import { appendEvent, leaseRulesVersion } from "./events.ts";

/**
 * Photos during the tenancy (phase 3): staff condition photos at move-in, and from the tenant
 * portal their own move-in photos, payment proofs and photos of an issue; staff condition photos
 * at move-out (phase 4). Same rules as ID uploads: JPEG/PNG/WebP by content, 10 MB, metadata
 * (EXIF/GPS) stripped, stored in UPLOADS_DIR by SHA-256, shown to staff only. Never sent to a
 * cloud API. Only staff condition photos (move-in and move-out) reach a model: the local vision
 * model compares them room by room, suggestions only (D29).
 */
export type TenancyFileKind =
  | "condition_photo"
  | "tenant_condition_photo"
  | "payment_proof"
  | "issue_photo"
  | "move_out_photo";

const MAX_BYTES = 10 * 1024 * 1024;
/** Uploads through one portal link, removed ones included, so a link can't fill the disk. */
export const MAX_UPLOADS_PER_LINK = 25;

export interface TenancyFileInput {
  leaseId: string;
  kind: TenancyFileKind;
  /** `user:<id>` or `tenant:<partyId>`. */
  uploadedBy: `user:${string}` | `tenant:${string}`;
  partyId?: string | null;
  room?: string | null;
  inspectionId?: string | null;
  linkId?: string | null;
}

/** Checks, cleans and stores one photo; records it on the lease. */
export async function addTenancyPhoto(ctx: EngineContext, input: TenancyFileInput, bytes: Uint8Array) {
  if (bytes.byteLength > MAX_BYTES) throw unprocessable("the photo is larger than 10 MB", [], "too_large");
  const type = sniffImage(bytes);
  if (!type) throw unprocessable("only JPEG, PNG or WebP photos", [], "unsupported_type");
  const clean = stripImageMetadata(bytes, type);
  if (!clean) throw unprocessable("the photo file looks damaged; take it again and retry", [], "unsupported_type");
  if (input.linkId) await withTx(ctx.database, (tx) => checkLinkQuota(tx, input.linkId!));
  const stored = await ctx.uploads.put(clean, type.ext);
  return withTx(ctx.database, async (tx) => {
    const [lease] = await tx.db.select({ id: leases.id }).from(leases).where(eq(leases.id, input.leaseId));
    if (!lease) throw unprocessable("lease not found");
    if (input.linkId) await checkLinkQuota(tx, input.linkId);
    const id = newId();
    await tx.db.insert(documents).values({
      id,
      leaseId: input.leaseId,
      partyId: input.partyId ?? null,
      kind: input.kind,
      sha256: stored.sha256,
      path: stored.path,
      mime: type.mime,
      bytes: stored.bytes,
      status: "uploaded",
      room: input.room ?? null,
      inspectionId: input.inspectionId ?? null,
      uploadedViaLinkId: input.linkId ?? null,
      uploadedBy: input.uploadedBy,
    });
    await appendEvent(tx, ctx, {
      entity: { kind: "lease", id: input.leaseId },
      type: "PHOTO_UPLOADED",
      actor: input.uploadedBy,
      payload: { documentId: id, kind: input.kind, room: input.room ?? null, sha256: stored.sha256 },
      rulesVersion: await leaseRulesVersion(tx, input.leaseId),
    });
    return { id, kind: input.kind, room: input.room ?? null, bytes: stored.bytes };
  });
}

async function checkLinkQuota(tx: Tx, linkId: string) {
  const via = await tx.db.select({ id: documents.id }).from(documents).where(eq(documents.uploadedViaLinkId, linkId));
  if (via.length >= MAX_UPLOADS_PER_LINK)
    throw unprocessable("too many uploads on this link; ask the leasing team for a new one", [], "too_many");
}

/**
 * The photos a portal submission refers to: they must be this lease's, of the given kind, and
 * uploaded through a link of this lease. Unknown ids are refused (a form can't claim others' files).
 */
export async function ownPhotos(tx: Tx, leaseId: string, kind: TenancyFileKind, ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const rows = await tx.db
    .select({ id: documents.id })
    .from(documents)
    .where(and(eq(documents.leaseId, leaseId), eq(documents.kind, kind)));
  const mine = new Set(rows.map((r) => r.id));
  const missing = ids.filter((i) => !mine.has(i));
  if (missing.length) throw unprocessable("some photos don't belong to this tenancy", [], "invalid_payload");
  return ids;
}
