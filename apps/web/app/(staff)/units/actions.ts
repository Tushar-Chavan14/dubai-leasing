"use server";

import { revalidatePath } from "next/cache";
import { type EngineResult, engine, formError } from "../../../lib/engine";

export interface ActionResult {
  ok?: boolean;
  id?: string;
  error?: string;
  reasons?: string[];
  /** Field name → message, from the engine's Zod errors ("makaniNo: …"). */
  fieldErrors?: Record<string, string>;
}

function toResult(r: EngineResult<unknown>): ActionResult {
  const reasons = r.error?.reasons ?? [];
  const fieldErrors: Record<string, string> = {};
  const other: string[] = [];
  for (const reason of reasons) {
    const m = /^([a-zA-Z]+): (.+)$/.exec(reason);
    if (m?.[1] && m[2]) fieldErrors[m[1]] = m[2];
    else other.push(reason);
  }
  const nice = formError({
    ...r,
    error: r.error ? { ...r.error, reasons: other } : undefined,
  } as EngineResult<unknown>);
  return {
    error: r.status === 400 ? "Some fields need attention." : nice.error,
    reasons: nice.reasons,
    fieldErrors: Object.fromEntries(
      Object.entries(fieldErrors).map(([k, v]) => [k, v.charAt(0).toUpperCase() + v.slice(1)]),
    ),
  };
}

export async function createUnitAction(payload: Record<string, unknown>): Promise<ActionResult> {
  const r = await engine<{ id: string }>("/api/units", { method: "POST", body: JSON.stringify(payload) });
  if (!r.ok) return toResult(r);
  revalidatePath("/units");
  return { ok: true, id: r.data.id };
}

export async function updateUnitAction(id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  const r = await engine(`/api/units/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
  if (!r.ok) return toResult(r);
  revalidatePath(`/units/${id}`);
  revalidatePath("/units");
  return { ok: true, id };
}

export async function unitEventAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id"));
  const event = String(formData.get("event"));
  const r = await engine(`/api/units/${id}/events`, { method: "POST", body: JSON.stringify({ event }) });
  revalidatePath(`/units/${id}`);
  revalidatePath("/units");
  return r.ok ? { ok: true } : toResult(r);
}

export async function requestPriceApprovalAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const id = String(formData.get("id"));
  const r = await engine<{ id: string }>(`/api/units/${id}/price-approval`, { method: "POST" });
  revalidatePath(`/units/${id}`);
  revalidatePath("/", "layout");
  return r.ok ? { ok: true, id: r.data.id } : toResult(r);
}

export async function deletePhotoAction(unitId: string, photoId: string): Promise<ActionResult> {
  const r = await engine(`/api/units/${unitId}/photos/${photoId}`, { method: "DELETE" });
  revalidatePath(`/units/${unitId}`);
  return r.ok ? { ok: true } : toResult(r);
}

export async function reorderPhotosAction(unitId: string, ids: string[]): Promise<ActionResult> {
  const r = await engine(`/api/units/${unitId}/photos/order`, { method: "PUT", body: JSON.stringify({ ids }) });
  revalidatePath(`/units/${unitId}`);
  revalidatePath("/units");
  return r.ok ? { ok: true } : toResult(r);
}

export async function captionPhotoAction(unitId: string, photoId: string, caption: string): Promise<ActionResult> {
  const r = await engine(`/api/units/${unitId}/photos/${photoId}`, {
    method: "PATCH",
    body: JSON.stringify({ caption: caption.trim() || null }),
  });
  return r.ok ? { ok: true } : toResult(r);
}
