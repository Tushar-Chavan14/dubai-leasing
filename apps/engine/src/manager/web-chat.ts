import type { ChannelReply, ChannelUpdate, CustomerAccount, WebChatInput } from "@leasing/core";
import { conversations, messages } from "@leasing/db";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { handleChannelUpdate, type UpdateResult } from "./enquiries.ts";

/**
 * The customer web chat (customer chat design). It is the same enquiry autopilot as Telegram:
 * the browser's message becomes a `ChannelUpdate` for the signed-in account, and the engine
 * answers it the same way. The client message id is the update id, so a retry gets the stored
 * reply instead of a second answer.
 */
export async function handleWebChat(
  ctx: EngineContext,
  account: CustomerAccount,
  input: WebChatInput,
): Promise<UpdateResult> {
  const base = {
    channel: "web" as const,
    updateId: input.clientMessageId,
    chatId: account.id,
    from: { id: account.id },
  };
  const update: ChannelUpdate =
    input.kind === "text"
      ? { ...base, kind: "text", text: input.text }
      : { ...base, kind: "callback", data: input.data };
  return handleChannelUpdate(ctx, update);
}

export interface WebHistoryMessage {
  id: string;
  direction: "in" | "out";
  body: string;
  /** The full reply (buttons, cards, records) for messages we sent. */
  reply: ChannelReply | null;
  at: Date;
}

/**
 * The customer's chat, oldest first, at most 100 messages. Without `after` it is the latest 100;
 * with `after` it is what came since that time.
 */
export async function webHistory(ctx: EngineContext, accountId: string, after?: Date): Promise<WebHistoryMessage[]> {
  const db = ctx.database.db;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(eq(conversations.customerAccountId, accountId));
  if (!conv) return [];
  const where = after
    ? and(eq(messages.conversationId, conv.id), gt(messages.at, after))
    : eq(messages.conversationId, conv.id);
  // Same-instant messages (a question and its answer) keep their order through the time-ordered id.
  const rows = after
    ? await db.select().from(messages).where(where).orderBy(asc(messages.at), asc(messages.id)).limit(100)
    : (
        await db.select().from(messages).where(where).orderBy(desc(messages.at), desc(messages.id)).limit(100)
      ).toReversed();
  return rows.map((m) => ({
    id: m.id,
    direction: m.direction as "in" | "out",
    body: m.body,
    reply: m.direction === "out" ? ((m.meta.reply as ChannelReply | undefined) ?? null) : null,
    at: m.at,
  }));
}
