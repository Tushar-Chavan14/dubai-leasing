"use server";

import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../lib/engine";

export interface ConversationActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
}

/** An officer's reply goes to this conversation's Telegram chat (the engine sends it). */
export async function replyAction(
  _prev: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const id = String(formData.get("id") ?? "");
  const text = String(formData.get("text") ?? "").trim();
  if (!text) return { error: "Write a reply first." };
  const r = await engine(`/api/conversations/${id}/reply`, { method: "POST", body: JSON.stringify({ text }) });
  if (!r.ok) return formError(r);
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  return { ok: "Sent." };
}

export async function releaseAction(
  _prev: ConversationActionState,
  formData: FormData,
): Promise<ConversationActionState> {
  const id = String(formData.get("id") ?? "");
  const r = await engine(`/api/conversations/${id}/release`, { method: "POST" });
  if (!r.ok) return formError(r);
  revalidatePath(`/conversations/${id}`);
  revalidatePath("/conversations");
  return { ok: "Handed back to the bot." };
}
