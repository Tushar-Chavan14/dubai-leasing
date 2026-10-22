"use server";

import { parseAed } from "@leasing/core";
import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../../lib/engine";

export interface DecisionState {
  ok?: "approved" | "rejected" | "edited";
  error?: string;
  reasons?: string[];
}

export async function decide(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") ?? "").trim() || undefined;
  let body: Record<string, unknown>;
  if (decision === "edit") {
    let proposedRentFils: number;
    try {
      proposedRentFils = parseAed(String(formData.get("proposedRentAed") ?? ""));
    } catch {
      return { error: "Enter the rent as an AED amount, for example 85,000." };
    }
    body = { decision: "edit", note, proposal: { proposedRentFils, ...(note ? { note } : {}) } };
  } else if (decision === "reject" && !note) {
    return { error: "Add a note saying why. It goes into the lease's audit trail." };
  } else if (decision === "approve" || decision === "reject") {
    body = { decision, note };
  } else {
    return { error: "Unknown decision." };
  }
  const r = await engine(`/api/approvals/${id}/decide`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath("/", "layout");
  if (!r.ok) return formError(r);
  return { ok: decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "edited" };
}
