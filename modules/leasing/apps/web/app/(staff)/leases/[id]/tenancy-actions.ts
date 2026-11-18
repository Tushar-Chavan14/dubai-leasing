"use server";

import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../../lib/engine";

export interface TenancyActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

const done = (leaseId: string, ok: string) => {
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/", "layout");
  return { ok };
};

export async function tickItem(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const item = String(f.get("item"));
  const r = await engine(`/api/leases/${leaseId}/move-in/items/${encodeURIComponent(item)}`, {
    method: "POST",
    body: JSON.stringify({ done: f.get("done") === "true" }),
  });
  return r.ok ? done(leaseId, "Saved.") : formError(r);
}

export async function completeMoveIn(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/move-in/complete`, { method: "POST", body: "{}" });
  return r.ok
    ? done(
        leaseId,
        "Moved in. The lease is active, rent instalments are scheduled and the tenant gets the move-in report.",
      )
    : formError(r);
}

export async function recordPayment(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const outcome = String(f.get("outcome"));
  const body =
    outcome === "paid"
      ? { outcome, paidOn: String(f.get("paidOn") ?? ""), ref: String(f.get("ref") ?? "").trim() }
      : { outcome: "bounced", note: String(f.get("note") ?? "").trim() || undefined };
  const r = await engine(`/api/payments/${String(f.get("paymentId"))}/record`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return r.ok
    ? done(
        leaseId,
        outcome === "paid" ? "Payment confirmed." : "Recorded as bounced. The tenant gets a friendly reminder.",
      )
    : formError(r);
}

export async function proposeFormal(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/payments/${String(f.get("paymentId"))}/formal-reminder`, { method: "POST", body: "{}" });
  return r.ok
    ? done(leaseId, "Sent to a leasing manager for approval. Nothing goes to the tenant before that.")
    : formError(r);
}

export async function resolveComplaint(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const action = String(f.get("action"));
  const body =
    action === "ticket"
      ? { action, category: String(f.get("category")), urgency: Number(f.get("urgency")) }
      : { action: "close", reason: String(f.get("reason") ?? "").trim() };
  const r = await engine(`/api/complaints/${String(f.get("complaintId"))}/resolve`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  return r.ok ? done(leaseId, action === "ticket" ? "Ticket opened." : "Closed.") : formError(r);
}

export async function logComplaint(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const payload = {
    description: String(f.get("description") ?? "").trim(),
    room: String(f.get("room") ?? "").trim() || undefined,
    atRisk: f.get("atRisk") === "on",
  };
  const r = await engine<{ ref: string }>(`/api/leases/${leaseId}/inbound`, {
    method: "POST",
    body: JSON.stringify({ type: "COMPLAINT_SUBMITTED", payload }),
  });
  return r.ok ? done(leaseId, `Logged as ${r.data.ref}. Triage runs in a few seconds.`) : formError(r);
}

export async function updateTicket(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId") ?? "");
  const body = { status: String(f.get("status")), notes: String(f.get("notes") ?? "").trim() || undefined };
  const r = await engine(`/api/tickets/${String(f.get("ticketId"))}`, { method: "PATCH", body: JSON.stringify(body) });
  if (!r.ok) return formError(r);
  revalidatePath("/maintenance");
  return leaseId ? done(leaseId, "Updated.") : { ok: "Updated." };
}

// ---------------------------------------------------------------- move-out (step 10)

export async function tickMoveOutItem(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const item = String(f.get("item"));
  const r = await engine(`/api/leases/${leaseId}/move-out/items/${encodeURIComponent(item)}`, {
    method: "POST",
    body: JSON.stringify({ done: f.get("done") === "true" }),
  });
  return r.ok ? done(leaseId, "Saved.") : formError(r);
}

export async function compareRooms(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/move-out/compare`, { method: "POST", body: "{}" });
  return r.ok
    ? done(leaseId, "Comparing with the move-in photos. Suggestions appear here in a minute; refresh to see them.")
    : formError(r);
}

export async function addDamage(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const itemId = String(f.get("itemId") ?? "");
  const quantity = Number(f.get("quantity") ?? 1);
  const room = String(f.get("room") ?? "").trim();
  const otherLabel = String(f.get("otherLabel") ?? "").trim();
  const otherAed = Number(f.get("otherAed") ?? 0);
  if (!itemId) return { error: "Choose an item from the price list." };
  if (itemId === "other" && (!otherLabel || !(otherAed > 0)))
    return { error: "Describe the item and give an amount (finance must approve it)." };
  const r = await engine(`/api/leases/${leaseId}/move-out/findings`, {
    method: "POST",
    body: JSON.stringify({
      room: room || null,
      itemId,
      quantity,
      ...(itemId === "other" ? { otherLabel, otherAmountFils: Math.round(otherAed * 100) } : {}),
      fromSuggestion: f.get("fromSuggestion") === "true",
    }),
  });
  return r.ok ? done(leaseId, "Damage item added.") : formError(r);
}

export async function removeDamage(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/move-out/findings/${encodeURIComponent(String(f.get("findingId")))}`, {
    method: "DELETE",
  });
  return r.ok ? done(leaseId, "Removed.") : formError(r);
}

export async function completeMoveOut(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/move-out/complete`, { method: "POST", body: "{}" });
  return r.ok
    ? done(
        leaseId,
        "Inspection complete. The deposit statement is emailed to the tenant; Ejari is cancelled from the move-out date.",
      )
    : formError(r);
}

export async function reissueStatement(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/deposit/reissue`, { method: "POST", body: "{}" });
  return r.ok ? done(leaseId, "A revised statement is emailed to the tenant.") : formError(r);
}

export async function recordRefund(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/deposit/refund-paid`, {
    method: "POST",
    body: JSON.stringify({ paidOn: String(f.get("paidOn") ?? ""), ref: String(f.get("ref") ?? "") }),
  });
  return r.ok ? done(leaseId, "Refund recorded. The deposit is settled.") : formError(r);
}

/** Finance only: the tenant's refund account, fetched on request (each view is recorded). */
export async function showRefundAccount(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine<{ accountName: string; iban: string }>(`/api/leases/${leaseId}/deposit/refund-account`);
  if (!r.ok) return formError(r);
  return { ok: `Pay to ${r.data.accountName}, IBAN ${r.data.iban}` };
}

// ---------------------------------------------------------------- dispute (step 11)

export async function openDispute(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/dispute`, {
    method: "POST",
    body: JSON.stringify({ reason: String(f.get("reason") ?? "") }),
  });
  return r.ok ? done(leaseId, "Dispute opened. Export the case pack for the RDC.") : formError(r);
}

export async function resolveDispute(_p: TenancyActionState, f: FormData): Promise<TenancyActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/dispute/resolve`, {
    method: "POST",
    body: JSON.stringify({ outcome: String(f.get("outcome") ?? ""), note: String(f.get("note") ?? "") }),
  });
  return r.ok ? done(leaseId, "Dispute resolved.") : formError(r);
}
