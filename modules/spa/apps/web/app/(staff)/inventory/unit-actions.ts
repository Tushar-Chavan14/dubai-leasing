"use server";

import { splitReasons } from "@platform/ui/field-errors";
import { revalidatePath } from "next/cache";
import { engineSend } from "../../../lib/engine";

/**
 * The unit and photo actions of the Inventory screens (S75). Each calls one engine route as the signed-in user and
 * answers in fixed words: the engine's own text is never shown, only the field its Zod error names. The engine checks
 * the role (admin), the company kind and every value again; this is a convenience, never the rule.
 */
export interface ActionResult {
  ok?: boolean;
  id?: string;
  error?: string;
  fieldErrors?: Record<string, string>;
}

const WORDS: Record<string, string> = {
  unit_in_deal: "This unit has a deal in progress, so its code and building can't change.",
  unit_code_taken: "That unit code is already used. Pick another.",
  unit_placed: "A unit stays in the building it was placed in.",
  forbidden: "Only an admin changes the inventory.",
  not_found: "That record is no longer there.",
};

type Reply = { status: number; json(): Promise<unknown> };
async function toResult(res: Reply, id?: string): Promise<ActionResult> {
  if (res.status >= 200 && res.status < 300) return { ok: true, ...(id ? { id } : {}) };
  const body = (await res.json().catch(() => null)) as { code?: string; reasons?: string[] } | null;
  if (res.status === 422) {
    const { fieldErrors } = splitReasons(body?.reasons ?? []);
    return { error: "Some fields need attention.", fieldErrors };
  }
  return { error: WORDS[body?.code ?? ""] ?? "That wasn't saved. Try again." };
}

const json = (method: "POST" | "PUT", body: unknown) => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function createUnitAction(projectId: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (!uuid.test(projectId)) return { error: "Choose a project." };
  const res = await engineSend(`/api/projects/${projectId}/units`, json("POST", payload));
  if (res.status === 201) {
    const created = (await res.json().catch(() => null)) as { id?: string } | null;
    revalidatePath("/inventory");
    return { ok: true, ...(created?.id ? { id: created.id } : {}) };
  }
  const out = await toResult(res);
  return out.error === WORDS.unit_code_taken ? { ...out, fieldErrors: { code: WORDS.unit_code_taken! } } : out;
}

export async function updateUnitAction(id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (!uuid.test(id)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/units/${id}`, json("PUT", payload));
  const out = await toResult(res, id);
  if (out.ok) {
    revalidatePath(`/inventory/units/${id}`);
    revalidatePath("/inventory");
  }
  return out;
}

export async function updateProjectAction(id: string, payload: Record<string, unknown>): Promise<ActionResult> {
  if (!uuid.test(id)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/projects/${id}`, json("PUT", payload));
  const out = await toResult(res, id);
  if (out.ok) {
    revalidatePath(`/inventory/projects/${id}`);
    revalidatePath("/inventory");
  }
  return out;
}

/** The photo calls: each takes the owner it belongs to, so a photo is only ever changed through its own record. */
type Owner = { kind: "project" | "unit" | "listing"; id: string };
const reval = (o: Owner) => {
  if (o.kind === "unit") revalidatePath(`/inventory/units/${o.id}`);
  if (o.kind === "project") revalidatePath(`/inventory/projects/${o.id}`);
  if (o.kind === "listing") revalidatePath(`/listings/${o.id}`);
  revalidatePath("/inventory");
};

export async function captionMediaAction(owner: Owner, mediaId: string, caption: string): Promise<ActionResult> {
  if (!uuid.test(mediaId)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/media/${mediaId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ caption: caption.trim() || null }),
  });
  reval(owner);
  return toResult(res);
}

export async function removeMediaAction(owner: Owner, mediaId: string): Promise<ActionResult> {
  if (!uuid.test(mediaId)) return { error: WORDS.not_found! };
  const res = await engineSend(`/api/media/${mediaId}`, { method: "DELETE" });
  reval(owner);
  return toResult(res);
}

export async function reorderMediaAction(owner: Owner, ids: string[]): Promise<ActionResult> {
  const res = await engineSend("/api/media/order", json("PUT", { kind: owner.kind, id: owner.id, ids }));
  reval(owner);
  return toResult(res);
}
