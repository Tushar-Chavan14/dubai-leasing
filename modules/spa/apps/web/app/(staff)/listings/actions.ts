"use server";

import { revalidatePath } from "next/cache";
import { engineSend } from "../../../lib/engine";

/**
 * The listing form's calls (S77): each posts to one engine route as the signed-in user and answers in fixed words.
 * The engine checks the role, the company kind and every value again; this is a convenience, never the rule.
 */
export interface ListingActionResult {
  ok?: boolean;
  id?: string;
  error?: string;
  /** The engine's "path: sentence" lines, which the form puts under the field each names. */
  reasons?: string[];
}

const WORDS: Record<string, string> = {
  forbidden: "Only a sales role changes listings.",
  not_found: "That listing is no longer there.",
  listing_not_editable: "This listing has an offer or is closed, so it can't be edited.",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function send(path: string, method: "POST" | "PUT", payload: unknown) {
  const res = await engineSend(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true as const, body: await res.json().catch(() => null) };
  const body = (await res.json().catch(() => null)) as { code?: string; reasons?: string[] } | null;
  if (res.status === 422 && body?.reasons?.length)
    return { ok: false as const, out: { error: "Some fields need attention.", reasons: body.reasons } };
  return { ok: false as const, out: { error: WORDS[body?.code ?? ""] ?? "That wasn't saved. Try again." } };
}

export async function createListingAction(payload: Record<string, unknown>): Promise<ListingActionResult> {
  const r = await send("/api/listings", "POST", payload);
  if (!r.ok) return r.out;
  revalidatePath("/listings");
  return { ok: true, ...((r.body as { id?: string } | null)?.id ? { id: (r.body as { id: string }).id } : {}) };
}

export async function updateListingAction(id: string, payload: Record<string, unknown>): Promise<ListingActionResult> {
  if (!uuid.test(id)) return { error: WORDS.not_found! };
  const r = await send(`/api/listings/${id}`, "PUT", payload);
  if (!r.ok) return r.out;
  revalidatePath(`/listings/${id}`);
  revalidatePath("/listings");
  return { ok: true, id };
}
