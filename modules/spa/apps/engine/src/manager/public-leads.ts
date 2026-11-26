import { LeadInput, ViewingBookInput } from "@spa/core";
import { tooMany, unprocessable } from "./errors.ts";
import type { SpaContext } from "./context.ts";
import { hourBucket, takeRateLimit } from "./assistants.ts";
import { notFound } from "./errors.ts";
import { findPublicHome, recordLead } from "./leads.ts";
import { currentPolicy } from "./policy.ts";
import { bookViewing, cancelViewingByToken, freeSlotsFor } from "./viewings.ts";

/**
 * What the public site may do about a home (S79): see free times, enquire, book, and cancel from the emailed link. Every
 * answer is allow-listed: it never says whether an email already had a lead, and never carries another visitor's data.
 */

/** Caps all visitors together per home per hour (policy `listingChat.enquiriesPerListingPerHour`, shared with the chat). */
export async function takeHomeAllowance(ctx: SpaContext, ref: string): Promise<void> {
  const cap = (await currentPolicy(ctx.database.db)).values.listingChat.enquiriesPerListingPerHour;
  if (!(await takeRateLimit(ctx, { key: `home:${ref}`, bucket: `home-leads:${ref}:${hourBucket(ctx)}`, limit: cap })))
    throw tooMany("too many enquiries for this home just now, try again later");
}

export async function publicSlots(ctx: SpaContext, ref: string): Promise<{ slots: string[] }> {
  const home = await findPublicHome(ctx, ref);
  if (!home) throw notFound("home");
  return { slots: await freeSlotsFor(ctx, { kind: home.kind, ref }, 24) };
}

/** A malformed request is refused before it can use up the home's hourly allowance. */
function checkShape(schema: { safeParse(v: unknown): { success: boolean } }, value: unknown): void {
  if (!schema.safeParse(value).success)
    throw unprocessable("invalid_request", "check the details and tick the consent box");
}

export async function publicEnquiry(ctx: SpaContext, ref: string, body: unknown): Promise<{ ok: true }> {
  if (!(await findPublicHome(ctx, ref))) throw notFound("home");
  checkShape(LeadInput, { ...(body as object), ref });
  await takeHomeAllowance(ctx, ref);
  await recordLead(ctx, { ...(body as object), ref }, "party:visitor:new", { source: "form" });
  return { ok: true };
}

export async function publicBook(ctx: SpaContext, ref: string, body: unknown): Promise<{ ok: true; startsAt: string }> {
  if (!(await findPublicHome(ctx, ref))) throw notFound("home");
  checkShape(ViewingBookInput, { ...(body as object), ref });
  await takeHomeAllowance(ctx, ref);
  const r = await bookViewing(ctx, { ...(body as object), ref }, "party:visitor:new", { source: "form" });
  return { ok: true, startsAt: r.startsAt };
}

export const publicCancel = cancelViewingByToken;
