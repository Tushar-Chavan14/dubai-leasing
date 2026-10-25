"use server";

import type { ChannelReply } from "@leasing/core";
import { ensureVisitorId, isUuid, publicEngine, visitorId } from "../../lib/public";

export interface HistoryItem {
  id: string;
  direction: "in" | "out";
  body: string;
  reply: ChannelReply | null;
  at: string;
}

export type ChatInput =
  | { kind: "text"; text: string; clientMessageId: string }
  | { kind: "callback"; data: string; clientMessageId: string };

export type SendResult = { ok: true; reply: ChannelReply | null } | { ok: false; error: string };

export async function sendChat(input: ChatInput): Promise<SendResult> {
  if (!isUuid(input.clientMessageId)) return { ok: false, error: "Something went wrong. Try again." };
  const visitor = await ensureVisitorId();
  const base = {
    channel: "web" as const,
    updateId: input.clientMessageId,
    chatId: visitor,
    from: { id: visitor },
  };
  const update =
    input.kind === "text"
      ? { ...base, kind: "text" as const, text: input.text.slice(0, 1000) }
      : { ...base, kind: "callback" as const, data: input.data };
  const r = await publicEngine<{ reply: ChannelReply | null }>("/channel/web/updates", {
    method: "POST",
    body: JSON.stringify(update),
  });
  if (r.ok) return { ok: true, reply: r.data.reply };
  if (r.status === 429) return { ok: false, error: "You're sending messages quickly. Wait a moment and try again." };
  return { ok: false, error: "We couldn't send that. Try again." };
}

export async function loadHistory(): Promise<HistoryItem[]> {
  const visitor = await visitorId();
  if (!visitor) return []; // no cookie yet: nothing was ever said
  const r = await publicEngine<HistoryItem[]>("/channel/web/history", {
    method: "POST",
    body: JSON.stringify({ visitorId: visitor }),
  });
  if (!r.ok) throw new Error("history failed");
  return r.data;
}
