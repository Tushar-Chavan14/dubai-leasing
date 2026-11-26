import type { ChannelReply } from "@leasing/core";
import { conversations, messages } from "@leasing/db";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import type { EngineContext } from "../context.ts";

/**
 * The public web chat is the same enquiry autopilot as Telegram: the web server relays each
 * visitor message as a `ChannelUpdate` (channel "web", chat id = visitor id) to
 * `POST /channel/web/updates`. This file only reads the visitor's history back.
 */

export interface WebHistoryMessage {
  id: string;
  direction: "in" | "out";
  body: string;
  /** The full reply (buttons, cards) for messages we sent. */
  reply: ChannelReply | null;
  at: Date;
}

/**
 * The visitor's chat, oldest first, at most 100 messages. Without `after` it is the latest 100;
 * with `after` it is what came since that time.
 */
export async function webHistory(ctx: EngineContext, visitorId: string, after?: Date): Promise<WebHistoryMessage[]> {
  const db = ctx.database.db;
  const [conv] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channel, "web"), eq(conversations.externalChatId, visitorId)));
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
