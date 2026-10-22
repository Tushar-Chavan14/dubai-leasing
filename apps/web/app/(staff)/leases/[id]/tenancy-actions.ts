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
