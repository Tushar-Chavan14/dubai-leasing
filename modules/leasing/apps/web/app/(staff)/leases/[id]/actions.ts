"use server";

import { parseAed } from "@leasing/core";
import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../../lib/engine";

export interface LeaseActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

export async function recordResponse(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const kind = String(formData.get("kind"));
  const comment = String(formData.get("comment") ?? "").trim();
  const body =
    kind === "ack"
      ? { type: "NOTICE_ACKNOWLEDGED", payload: {} }
      : { type: "RENEWAL_REPLY", payload: comment ? { choice: kind, comment } : { choice: kind } };
  if (!["ack", "renew", "vacate", "discuss"].includes(kind)) return { error: "Choose what the tenant told you." };
  const r = await engine<{ ref: string }>(`/api/leases/${id}/inbound`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath(`/leases/${id}`);
  return r.ok
    ? { ok: `Recorded (reference ${r.data.ref}). The engine processes it within a few seconds.` }
    : formError(r);
}

export async function renewLease(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const r = await engine(`/api/leases/${id}/renew`, { method: "POST", body: "{}" });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  return r.ok ? { ok: "Renewed. The lease is active on its new term and its milestones are scheduled." } : formError(r);
}

export async function recordSri(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  let avgAnnualRentFils: number;
  try {
    avgAnnualRentFils = parseAed(String(formData.get("sriAed") ?? ""));
  } catch {
    return { error: "Enter the SRI average as an AED amount, for example 100,000." };
  }
  const reason = String(formData.get("reason") ?? "").trim();
  const r = await engine<{ redrafted: boolean; reason?: string }>(`/api/leases/${id}/sri-override`, {
    method: "POST",
    body: JSON.stringify({ avgAnnualRentFils, reason }),
  });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  if (!r.ok) return formError(r);
  return {
    ok: r.data.redrafted
      ? "Recorded. A new notice draft at the new cap is in the approval inbox."
      : `Recorded. ${r.data.reason ?? ""}`,
  };
}

/**
 * Prepare a new contract version with the chosen clauses and optional extra terms. The engine queues the work and
 * answers at once (the model calls take minutes); the contract panel shows it as preparing and refreshes itself.
 */
export async function prepareContract(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const clauses = formData.getAll("clause").map(String);
  const freeText = String(formData.get("freeText") ?? "").trim();
  const r = await engine<{ status: string }>(`/api/leases/${id}/contract/prepare-async`, {
    method: "POST",
    body: JSON.stringify({ clauses, freeText: freeText || null }),
  });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  return r.ok
    ? { ok: "Preparing the contract. It shows here while it runs and appears in the approval inbox when ready." }
    : formError(r);
}

/** "Prepare contract again": same clauses, current rule and template; only while the approval is still pending. */
export async function reprepareContract(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const r = await engine<{ status: string }>(`/api/leases/${id}/contract/reprepare-async`, {
    method: "POST",
    body: "{}",
  });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  return r.ok
    ? {
        ok: "Preparing the contract again. It shows here while it runs; the earlier approval is replaced when it is ready.",
      }
    : formError(r);
}

export async function resendSignLink(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const signerId = String(formData.get("signerId"));
  const r = await engine(`/api/leases/${id}/contract/signers/${signerId}/resend`, { method: "POST", body: "{}" });
  revalidatePath(`/leases/${id}`);
  return r.ok ? { ok: "A new signing link is on its way; the old one no longer works." } : formError(r);
}

export async function proposeEjari(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const r = await engine(`/api/leases/${id}/ejari/propose`, { method: "POST", body: "{}" });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  return r.ok ? { ok: "A new Ejari submission is in the approval inbox." } : formError(r);
}

/**
 * D67: re-issue the contract from a change request: the AI's draft as it is, or the officer's edited clauses and extra
 * terms. The new version waits for the `final_contract` approval like any other.
 */
export async function reissueChange(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const requestId = String(formData.get("requestId"));
  const edited = formData.get("edited") === "1";
  const body = edited
    ? {
        addendum: {
          clauses: formData.getAll("clause").map(String).filter(Boolean),
          freeText: String(formData.get("freeText") ?? "").trim() || null,
        },
      }
    : {};
  const r = await engine<{ status: string; version?: number; reasons?: string[] }>(
    `/api/leases/${id}/contract/change-requests/${requestId}/reissue`,
    { method: "POST", body: JSON.stringify(body) },
  );
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  if (r.status === 422 && r.error && "status" in (r.error as object)) {
    const b = r.error as unknown as { reasons?: string[] };
    return { error: "The contract can't be prepared yet.", reasons: b.reasons ?? [] };
  }
  return r.ok
    ? { ok: `Version ${r.data.version} prepared with the change. It is waiting for approval in the approval inbox.` }
    : formError(r);
}

/** D67: keep the contract as it is. The note is emailed to the requester and signing opens again. */
export async function declineChange(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const requestId = String(formData.get("requestId"));
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 5) return { error: "Write a short note for the signer: it is emailed to them." };
  const r = await engine<{ paused: boolean }>(`/api/leases/${id}/contract/change-requests/${requestId}/decline`, {
    method: "POST",
    body: JSON.stringify({ note }),
  });
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  return r.ok
    ? {
        ok: r.data.paused
          ? "Declined and emailed. Signing stays paused: another request is still open."
          : "Declined and emailed. Signing is open again; both signers get a fresh link.",
      }
    : formError(r);
}

/** Marked change requests: the officer's own wording for one mark, checked by code (`marks/:n/wording`). */
export async function writeMarkWording(
  leaseId: string,
  requestId: string,
  n: number,
  text: string,
): Promise<
  { rewrite: import("@leasing/core").MarkRewrite | null; problems: string[] } | { error: string; reasons: string[] }
> {
  const t = text.trim();
  if (t.length < 3) return { error: "Write what the clause should say.", reasons: [] };
  const r = await engine<{ rewrite: import("@leasing/core").MarkRewrite | null; problems: string[] }>(
    `/api/leases/${encodeURIComponent(leaseId)}/contract/change-requests/${encodeURIComponent(requestId)}/marks/${n}/wording`,
    { method: "POST", body: JSON.stringify({ text: t }) },
  );
  if (!r.ok) return formError(r);
  return { rewrite: r.data.rewrite, problems: r.data.problems };
}

/** Marked change requests: approve the decided marks. A new version still waits at `final_contract` for signing. */
export async function approveMarks(
  leaseId: string,
  requestId: string,
  decisions: Record<number, "apply" | "keep">,
  keepReasons: Record<number, string>,
): Promise<LeaseActionState> {
  const reasons: Record<string, string> = {};
  for (const [k, v] of Object.entries(keepReasons))
    if (decisions[Number(k)] === "keep" && v.trim()) reasons[k] = v.trim().slice(0, 500);
  const r = await engine<{ status: string; version?: number | null; paused?: boolean }>(
    `/api/leases/${encodeURIComponent(leaseId)}/contract/change-requests/${encodeURIComponent(requestId)}/approve`,
    { method: "POST", body: JSON.stringify({ decisions, keepReasons: reasons }) },
  );
  revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/", "layout");
  if (!r.ok) return formError(r);
  if (r.data.status === "needs_manager")
    return {
      ok: "Sent to a leasing manager for approval. The lease and contract stay as they are until they decide; signing stays paused.",
    };
  return {
    ok:
      r.data.status === "approved"
        ? `Version ${r.data.version} is ready. It was approved with the changes and signing links are on their way.`
        : "Nothing was changed. The tenant was told and signing is open again.",
  };
}
