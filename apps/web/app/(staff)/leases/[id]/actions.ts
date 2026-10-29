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

/** Prepare a new contract version with the chosen clauses and optional extra terms. */
export async function prepareContract(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const clauses = formData.getAll("clause").map(String);
  const freeText = String(formData.get("freeText") ?? "").trim();
  const r = await engine<{ status: string; version?: number; reasons?: string[] }>(
    `/api/leases/${id}/contract/prepare`,
    { method: "POST", body: JSON.stringify({ clauses, freeText: freeText || null }) },
  );
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  if (r.status === 422 && r.error && "status" in (r.error as object)) {
    const body = r.error as unknown as { reasons?: string[] };
    return { error: "The contract can't be prepared yet.", reasons: body.reasons ?? [] };
  }
  return r.ok
    ? {
        ok: `Version ${r.data.version} prepared. It is in the approval inbox; once approved, both parties get a signing link.`,
      }
    : formError(r);
}

/** "Prepare contract again": same clauses, current rule and template; only while the approval is still pending. */
export async function reprepareContract(_prev: LeaseActionState, formData: FormData): Promise<LeaseActionState> {
  const id = String(formData.get("leaseId"));
  const r = await engine<{ status: string; version?: number; reasons?: string[] }>(
    `/api/leases/${id}/contract/reprepare`,
    { method: "POST", body: "{}" },
  );
  revalidatePath(`/leases/${id}`);
  revalidatePath("/", "layout");
  if (r.status === 422 && r.error && "status" in (r.error as object)) {
    const body = r.error as unknown as { reasons?: string[] };
    return { error: "The contract can't be prepared yet.", reasons: body.reasons ?? [] };
  }
  return r.ok
    ? {
        ok: `Version ${r.data.version} prepared. The earlier approval was cancelled; the new one is in the approval inbox.`,
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
