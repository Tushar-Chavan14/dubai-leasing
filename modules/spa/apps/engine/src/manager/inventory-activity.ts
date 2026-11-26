import { dealEvents, type SpaDb } from "@spa/db";
import { and, desc, eq } from "drizzle-orm";
import { userNames } from "./views.ts";

/** What an Activity card says for each event type a unit or a project can have. Other types are not shown. */
const ACTIVITY_LABELS: Record<string, string> = {
  UNIT_ADDED: "Unit added",
  UNIT_PLACED: "Unit placed in a building",
  UNIT_UPDATED: "Details changed",
  PROJECT_UPDATED: "Details changed",
  MEDIA_ADDED: "Photo added",
  MEDIA_REMOVED: "Photo removed",
  MEDIA_REORDERED: "Photos reordered",
  MEDIA_CAPTIONED: "Photo caption changed",
  // M3 (S77): a listing's record. Seller names never appear; a reason is the staff member's own sentence.
  LISTING_CREATED: "Listing created",
  LISTING_UPDATED: "Details changed",
  LISTING_DOCUMENT_UPLOADED: "Document added",
  OWNERSHIP_RECORDED: "Ownership document recorded",
  LISTING_AGREEMENT_SIGNED: "A seller signed the listing agreement",
  APPROVAL_WITHDRAWN: "Sales manager check no longer needed",
  VERIFY: "Verified",
  ACTIVATE: "Activated",
  PUBLISH: "Page published",
  UNPUBLISH: "Page unpublished",
  WITHDRAW: "Listing withdrawn",
};
const WITH_REASON = new Set(["UNPUBLISH", "WITHDRAW"]);

export interface ActivityItem {
  id: string;
  label: string;
  at: string;
  actor: string;
  /** Field names that changed (never their values). */
  changed: string[];
  /** The reason given for an unpublish or a withdrawal. */
  note: string | null;
}

/** The newest events of a unit or a project in words, newest first. Actors are names, never ids. */
export async function activityOf(db: SpaDb, kind: "unit" | "project" | "listing", id: string): Promise<ActivityItem[]> {
  const events = await db
    .select()
    .from(dealEvents)
    .where(and(eq(dealEvents.entityKind, kind), eq(dealEvents.entityId, id)))
    .orderBy(desc(dealEvents.at), desc(dealEvents.id))
    .limit(50);
  const names = await userNames(
    db,
    events.map((e) => e.actor),
  );
  return events
    .filter((e) => e.type in ACTIVITY_LABELS)
    .map((e) => {
      const who = e.actor.startsWith("user:") ? names.get(e.actor.slice(5)) : undefined;
      const changed = (e.payload as { changed?: unknown }).changed;
      return {
        id: e.id,
        label: ACTIVITY_LABELS[e.type]!,
        at: e.at.toISOString(),
        actor: who ?? (e.actor.startsWith("user:") ? "Staff" : "System"),
        changed: Array.isArray(changed)
          ? changed.map(String)
          : Array.isArray((e.payload as { fields?: unknown }).fields)
            ? (e.payload as { fields: unknown[] }).fields.map(String)
            : [],
        note:
          WITH_REASON.has(e.type) && typeof (e.payload as { reason?: unknown }).reason === "string"
            ? String((e.payload as { reason: string }).reason)
            : null,
      };
    });
}
