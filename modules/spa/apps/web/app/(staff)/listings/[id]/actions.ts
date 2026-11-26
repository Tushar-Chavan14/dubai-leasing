"use server";

import { revalidatePath } from "next/cache";
import { engineSend } from "../../../../lib/engine";

/**
 * The listing record's calls (S77): one engine route each, as the signed-in user, answered in fixed words. The engine
 * decides every step; a refusal comes back with the machine's own sentences, which the record lists.
 */
export interface ListingStepResult {
  ok?: boolean;
  error?: string;
  reasons?: string[];
}

const WORDS: Record<string, string> = {
  forbidden: "Only a sales role changes listings.",
  not_found: "That listing is no longer there.",
  listing_not_editable: "This listing can't change any more.",
  reason_required: "Say why, in a few words.",
  not_a_seller: "Only a seller of this listing signs its agreement.",
  transition_not_allowed: "That step isn't available from where the listing is now.",
};
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function post(id: string, path: string, body: unknown): Promise<ListingStepResult> {
  if (!uuid.test(id)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/listings/${id}/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status >= 200 && res.status < 300) {
    revalidatePath(`/listings/${id}`);
    revalidatePath("/listings");
    return { ok: true };
  }
  const out = (await res.json().catch(() => null)) as { code?: string; reasons?: string[] } | null;
  if (out?.code === "step_refused") return { error: "That step isn't allowed yet.", reasons: out.reasons ?? [] };
  if (res.status === 422 && out?.reasons?.length && out.code !== "reason_required")
    return { error: "Some values need attention.", reasons: out.reasons };
  return { error: WORDS[out?.code ?? ""] ?? "That wasn't saved. Try again." };
}

export async function stepListingAction(id: string, event: string, reason?: string): Promise<ListingStepResult> {
  return post(id, "steps", { event, ...(reason?.trim() ? { reason: reason.trim() } : {}) });
}

export async function recordOwnershipAction(
  id: string,
  kind: string,
  ref: string,
  owners: string[],
): Promise<ListingStepResult> {
  return post(id, "ownership", { kind, ref, ownersAsOnDocument: owners });
}

export async function recordSignatureAction(id: string, partyId: string): Promise<ListingStepResult> {
  return post(id, "signatures", { partyId });
}

/** Withdraws the listing's open offer (M6, S81). The reason is required and kept in the activity; the sellers' links stop. */
export async function withdrawOfferAction(
  listingId: string,
  offerId: string,
  reason: string,
): Promise<ListingStepResult> {
  if (!uuid.test(listingId) || !uuid.test(offerId)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/offers/${offerId}/withdraw`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ reason: reason.trim() }),
  });
  if (res.status === 200) {
    revalidatePath(`/listings/${listingId}`);
    revalidatePath("/listings");
    return { ok: true };
  }
  const out = (await res.json().catch(() => null)) as { code?: string } | null;
  if (out?.code === "offer_closed") return { error: "This offer has already been answered or closed." };
  return { error: WORDS[out?.code ?? ""] ?? "The offer wasn't withdrawn. Try again." };
}

/** Records the resale deposit cheque after acceptance (M6). The amount is the policy's, worked out by the engine. */
export async function recordDepositAction(
  listingId: string,
  dealId: string,
  cheque: { chequeNo: string; bank: string; chequeOn: string; holder: string },
): Promise<ListingStepResult & { amountFils?: number }> {
  if (!uuid.test(listingId) || !uuid.test(dealId)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/deals/${dealId}/deposit`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(cheque),
  });
  const out = (await res.json().catch(() => null)) as { amountFils?: number; code?: string } | null;
  if (res.status === 201) {
    revalidatePath(`/listings/${listingId}`);
    return { ok: true, ...(out?.amountFils ? { amountFils: out.amountFils } : {}) };
  }
  if (res.status === 422) return { error: "Check the cheque number (digits only), the bank, the date and the holder." };
  if (out?.code === "deposit_exists") return { error: "The deposit is already recorded." };
  if (out?.code === "too_late") return { error: "The deposit can't be recorded at this stage of the deal." };
  return { error: WORDS[out?.code ?? ""] ?? "The deposit wasn't recorded. Try again." };
}
