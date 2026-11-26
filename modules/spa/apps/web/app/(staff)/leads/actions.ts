"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { engineGet, engineSend } from "../../../lib/engine";
import { loadLeadSlots } from "../../../lib/loaders";

// ---------------------------------------------------------------------------------------------
// M5 (S79): viewings and leads. Each action posts as the signed-in user; the engine checks the role and the state
// again, and its words never reach the page: a fixed sentence per refusal.

export interface ActionResult {
  ok?: true;
  error?: string;
}

const REFUSALS: Record<string, string> = {
  not_booked: "That viewing is no longer booked. Refresh the page.",
  viewing_not_started: "The viewing hasn't happened yet.",
  slot_taken: "Someone just took that time. Pick another.",
  slot_unavailable: "That time isn't offered. Pick another.",
  reason_required: "Say why, in 3 to 500 characters.",
  note_required: "Say why, in 3 to 500 characters.",
  lead_finished: "This lead is already closed.",
  mail_unavailable: "Email isn't set up, so a viewing can't be confirmed.",
};

async function post(path: string, method: "POST" | "PUT", body: unknown, revalidate: string[]): Promise<ActionResult> {
  const res = await engineSend(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { error: "The sales engine didn't answer. Try again in a moment." };
  if (res.status === 401) redirect("/sign-in");
  if (res.status >= 200 && res.status < 300) {
    for (const p of revalidate) revalidatePath(p);
    return { ok: true };
  }
  const code = ((await res.json().catch(() => ({}))) as { code?: string }).code ?? "";
  if (res.status === 403) return { error: "That isn't yours to change." };
  return { error: REFUSALS[code] ?? "That couldn't be saved. Check it and try again." };
}

const id = (v: unknown): string | null => {
  const r = z.uuid().safeParse(v);
  return r.success ? r.data : null;
};
const REVALIDATE = ["/work", "/leads"];

export async function recordOutcomeAction(
  viewingId: string,
  outcome: "attended" | "no_show",
  note: string,
): Promise<ActionResult> {
  if (!id(viewingId)) return { error: "That viewing wasn't found." };
  return post(
    `/api/viewings/${viewingId}/outcome`,
    "POST",
    { outcome, ...(note.trim() ? { note: note.trim() } : {}) },
    REVALIDATE,
  );
}

export async function cancelViewingAction(viewingId: string, reason: string): Promise<ActionResult> {
  if (!id(viewingId)) return { error: "That viewing wasn't found." };
  return post(`/api/viewings/${viewingId}/cancel`, "POST", { reason }, REVALIDATE);
}

export async function rescheduleViewingAction(viewingId: string, slot: string): Promise<ActionResult> {
  if (!id(viewingId) || !slot) return { error: "Pick a time." };
  return post(`/api/viewings/${viewingId}/reschedule`, "POST", { slot }, REVALIDATE);
}

export async function bookViewingAction(leadId: string, slot: string): Promise<ActionResult> {
  if (!id(leadId) || !slot) return { error: "Pick a time." };
  return post("/api/viewings", "POST", { leadId, slot }, REVALIDATE);
}

export async function setLeadStatusAction(leadId: string, status: string, note?: string): Promise<ActionResult> {
  if (!id(leadId)) return { error: "That lead wasn't found." };
  return post(`/api/leads/${leadId}/status`, "PUT", { status, ...(note ? { note } : {}) }, REVALIDATE);
}

/** The free times of the lead's home, for the pickers (a read, so a plain GET with the user's token). */
export async function leadSlotsAction(leadId: string): Promise<{ slots?: string[]; error?: string }> {
  if (!id(leadId)) return { error: "That lead wasn't found." };
  const r = await loadLeadSlots(engineGet, leadId).catch(() => null);
  return r ? { slots: r.slots } : { error: "The free times couldn't be loaded." };
}
