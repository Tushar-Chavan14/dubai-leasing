"use server";

import { parseAed } from "@leasing/core";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engine, formError } from "../../../lib/engine";

export interface DecisionState {
  ok?: "approved" | "rejected" | "edited";
  error?: string;
  reasons?: string[];
}

/** Approve, reject or edit a pending approval. Used by the detail pane's decision form and the log's inline buttons. */
export async function decide(_prev: DecisionState, formData: FormData): Promise<DecisionState> {
  const id = String(formData.get("id"));
  const decision = String(formData.get("decision"));
  const note = String(formData.get("note") ?? "").trim() || undefined;
  let body: Record<string, unknown>;
  if (decision === "edit") {
    // The rent field exists only on gates that allow it (the renewal notice); every other editable
    // gate takes a note-only edit. The engine refuses anything else (checkDecision).
    if (String(formData.get("editField")) === "note") {
      if (!note) return { error: "Add the note you want to record with this approval." };
      body = { decision: "edit", note, proposal: { note } };
    } else {
      let proposedRentFils: number;
      try {
        proposedRentFils = parseAed(String(formData.get("proposedRentAed") ?? ""));
      } catch {
        return { error: "Enter the rent as an AED amount, for example 85,000." };
      }
      body = { decision: "edit", note, proposal: { proposedRentFils, ...(note ? { note } : {}) } };
    }
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

export interface EntryActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/**
 * The other inline buttons, each calling the route the full pages use. `op` names the action; the
 * record id comes from the form, never from the entry text.
 */
export async function runEntryAction(_prev: EntryActionState, f: FormData): Promise<EntryActionState> {
  const op = text(f, "op");
  const id = text(f, "recordId");
  let r;
  let ok: string;
  switch (op) {
    case "send_offer":
      r = await engine(`/api/applications/${id}/offer/send`, { method: "POST", body: "{}" });
      ok = "Offer sent to the applicant.";
      break;
    case "retry_kyc":
      r = await engine(`/api/applications/${id}/kyc/retry`, { method: "POST", body: "{}" });
      ok = "Document check restarted.";
      break;
    case "prepare_contract":
      r = await engine<{ status: string; version?: number; reasons?: string[] }>(`/api/leases/${id}/contract/prepare`, {
        method: "POST",
        body: JSON.stringify({ clauses: [], freeText: null }),
      });
      if (!r.ok && r.status === 422 && r.error && "reasons" in (r.error as object)) {
        return {
          error: "The contract can't be prepared yet.",
          reasons: (r.error as { reasons?: string[] }).reasons ?? [],
        };
      }
      ok = "Contract prepared and sent for approval.";
      break;
    case "done":
      r = await engine(`/api/tasks/${text(f, "entryId")}/done`, { method: "POST", body: JSON.stringify({}) });
      ok = "Marked done.";
      break;
    case "viewing_attended":
    case "viewing_no_show": {
      const outcome = op === "viewing_no_show" ? "no_show" : "attended";
      r = await engine(`/api/applications/${id}/viewing-outcome`, {
        method: "POST",
        body: JSON.stringify({ outcome }),
      });
      ok = outcome === "attended" ? "Viewing recorded." : "No-show recorded.";
      break;
    }
    case "reservation":
      r = await engine(`/api/applications/${id}/reservation`, {
        method: "POST",
        body: JSON.stringify({ paidOn: text(f, "paidOn"), reference: text(f, "reference") }),
      });
      ok = "Reservation recorded.";
      break;
    default:
      return { error: "Unknown action." };
  }
  // Keyed on the record so the actor's own change shows at once; the layout pass keeps the nav badge current.
  if (id) for (const base of ["applications", "leases"]) revalidatePath(`/${base}/${id}`);
  revalidatePath("/work");
  revalidatePath("/", "layout");
  return r.ok ? { ok } : formError(r);
}

export interface ViewState {
  error?: string;
}

export async function saveView(_prev: ViewState, f: FormData): Promise<ViewState> {
  const name = text(f, "name");
  if (!name) return { error: "Name the view." };
  const stage = text(f, "stage");
  const q = text(f, "q");
  const filter = { ...(stage ? { stage } : {}), ...(q ? { q } : {}), ...(f.get("mine") === "1" ? { mine: true } : {}) };
  const r = await engine<{ id: string }>("/api/views", { method: "POST", body: JSON.stringify({ name, filter }) });
  if (r.status === 409) return { error: "You already have a view with that name." };
  if (!r.ok) return { error: formError(r).error };
  revalidatePath("/work");
  redirect(`/work?view=${r.data.id}`);
}

export async function deleteView(f: FormData): Promise<void> {
  await engine(`/api/views/${text(f, "id")}`, { method: "DELETE" });
  revalidatePath("/work");
  redirect("/work");
}
