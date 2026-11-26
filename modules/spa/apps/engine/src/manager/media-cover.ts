import { spaMedia, type SpaDb } from "@spa/db";
import { and, asc, eq, inArray } from "drizzle-orm";

/** The first photo of each owner, by sort. */
export async function coverMedia(db: SpaDb, kind: "project" | "unit" | "listing", ownerIds: string[]) {
  const out = new Map<string, string>();
  if (!ownerIds.length) return out;
  const rows = await db
    .selectDistinctOn([spaMedia.ownerId], { ownerId: spaMedia.ownerId, id: spaMedia.id })
    .from(spaMedia)
    .where(and(eq(spaMedia.ownerKind, kind), inArray(spaMedia.ownerId, ownerIds)))
    .orderBy(spaMedia.ownerId, asc(spaMedia.sort), asc(spaMedia.createdAt));
  for (const r of rows) out.set(r.ownerId, r.id);
  return out;
}
