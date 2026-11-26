"use server";

import { engineSend } from "../../../../../lib/engine";

/**
 * The Make an offer form's call (M6, S81): one engine route as the signed-in user. The engine emails each seller their own
 * single-use link, so nothing here ever holds one. Every value is checked again there.
 */
export interface MakeOfferResult {
  ok?: boolean;
  /** One entry per seller: whether their email went. */
  emailed?: { status: "sent" | "failed" }[];
  error?: string;
  reasons?: string[];
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORDS: Record<string, string> = {
  forbidden: "Only a sales role makes an offer, and only in a company that keeps listings.",
  not_found: "That listing is no longer there.",
  open_offer_exists: "This listing already has an open offer or a deal.",
  mail_unavailable: "Email isn't set up, so the sellers can't be sent their links. Nothing was created.",
  transition_not_allowed: "This listing can't take an offer in its current state.",
  no_sellers: "This listing has no sellers to answer the offer.",
  conditions_name_party: "The conditions can't name a buyer: the sellers' link shows them.",
  lead_mismatch: "That enquiry is about another home.",
  lead_finished: "That enquiry is already closed or has a deal.",
};

export async function makeOfferAction(listingId: string, payload: Record<string, unknown>): Promise<MakeOfferResult> {
  if (!uuid.test(listingId)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/listings/${listingId}/offers`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = (await res.json().catch(() => null)) as {
    emailed?: { status: "sent" | "failed" }[];
    code?: string;
    reasons?: string[];
  } | null;
  if (res.status === 201) {
    // No revalidatePath here: it would re-render this page, where the listing is now under offer, and replace the result.
    return { ok: true, emailed: (body?.emailed ?? []).map((e) => ({ status: e.status })) };
  }
  if (res.status === 422 && body?.reasons?.length)
    return { error: "Some fields need attention.", reasons: body.reasons };
  return { error: WORDS[body?.code ?? ""] ?? "The offer wasn't made. Try again." };
}
