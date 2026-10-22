"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { engine, formError } from "../../../lib/engine";

export interface AppActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

/**
 * A `datetime-local` value ("2026-11-01T16:30") read as Dubai time (UTC+4 all year, no DST),
 * sent to the engine as an ISO instant with its offset. Anything else is passed through so the
 * engine's validation reports it.
 */
function dubaiInstant(v: FormDataEntryValue | null): string {
  const s = String(v ?? "").trim();
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s) ? `${s}:00+04:00` : s;
}

export async function createApplication(_prev: AppActionState, formData: FormData): Promise<AppActionState> {
  const moveIn = String(formData.get("requestedMoveInOn") ?? "");
  const body = {
    unitId: String(formData.get("unitId") ?? ""),
    nameEn: String(formData.get("nameEn") ?? "").trim(),
    email: String(formData.get("email") ?? "").trim(),
    phone: String(formData.get("phone") ?? "").trim() || undefined,
    kind: formData.get("kind") === "company" ? "company" : "individual",
    ...(moveIn ? { requestedMoveInOn: moveIn } : {}),
    viewingAt: dubaiInstant(formData.get("viewingAt")),
  };
  const r = await engine<{ id: string }>("/api/applications", { method: "POST", body: JSON.stringify(body) });
  if (!r.ok) return formError(r);
  revalidatePath("/applications");
  redirect(`/applications/${r.data.id}`);
}

async function act(id: string, path: string, body: unknown, ok: string): Promise<AppActionState> {
  const r = await engine(`/api/applications/${id}/${path}`, { method: "POST", body: JSON.stringify(body) });
  revalidatePath(`/applications/${id}`);
  revalidatePath("/", "layout");
  return r.ok ? { ok } : formError(r);
}

export async function bookViewing(_p: AppActionState, f: FormData) {
  return act(
    String(f.get("id")),
    "viewing",
    { viewingAt: dubaiInstant(f.get("viewingAt")) },
    "Viewing booked. The invitation is on its way to the applicant.",
  );
}
export async function recordViewingOutcome(_p: AppActionState, f: FormData) {
  const outcome = f.get("outcome") === "no_show" ? "no_show" : "attended";
  const note = String(f.get("note") ?? "").trim();
  return act(
    String(f.get("id")),
    "viewing-outcome",
    { outcome, ...(note ? { note } : {}) },
    outcome === "attended"
      ? "Viewing recorded. The document upload link is on its way to the applicant."
      : "No-show recorded. The application is closed; the applicant must apply again.",
  );
}
export async function requestDocuments(_p: AppActionState, f: FormData) {
  return act(String(f.get("id")), "request-documents", {}, "A new upload link is on its way to the applicant.");
}
export async function recordReservation(_p: AppActionState, f: FormData) {
  return act(
    String(f.get("id")),
    "reservation",
    { paidOn: String(f.get("paidOn") ?? ""), reference: String(f.get("reference") ?? "") },
    "Reservation recorded. The lease is created and waiting for its contract.",
  );
}
export async function rejectApplicant(_p: AppActionState, f: FormData) {
  return act(String(f.get("id")), "reject", { reason: String(f.get("reason") ?? "") }, "Application closed.");
}
