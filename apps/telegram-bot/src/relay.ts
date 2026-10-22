import { inlineKeyboard } from "@leasing/adapters";
import { ChannelReply, ChannelUpdate, EnquiryCommand } from "@leasing/core";
import type { Bot, Context } from "grammy";
import { z } from "zod";

/**
 * The bot is a relay (decision D24): each private-chat update becomes a `ChannelUpdate`, goes
 * to the engine, and the engine's reply is sent back to the chat that update came from. The bot
 * keeps no conversation state, so one customer's answer can't reach another. Message text is
 * never logged.
 */

const EngineAnswer = z.object({ conversationId: z.string(), reply: ChannelReply.nullable() });

export type PostUpdate = (u: ChannelUpdate) => Promise<ChannelReply | null>;

const sorry = (lang?: string) =>
  lang?.startsWith("ar")
    ? "عذراً، حدث خطأ. يرجى المحاولة مرة أخرى بعد قليل."
    : "Sorry, something went wrong on our side. Please try again in a minute.";

/** A short, non-identifying label for logs. */
export const chatLabel = (chatId: string) => `chat …${chatId.slice(-3)}`;

/** Turns a Telegram update into the engine's shape. Null: not something the bot handles. */
export function toChannelUpdate(ctx: Context): ChannelUpdate | null {
  const chat = ctx.chat;
  const from = ctx.from;
  if (!chat || chat.type !== "private" || !from || from.is_bot) return null;
  const base = {
    channel: "telegram" as const,
    updateId: String(ctx.update.update_id),
    chatId: String(chat.id),
    from: {
      id: String(from.id),
      ...(from.first_name ? { firstName: from.first_name.slice(0, 128) } : {}),
      ...(from.language_code ? { languageCode: from.language_code } : {}),
    },
  };
  if (ctx.callbackQuery) {
    const data = ctx.callbackQuery.data;
    return data ? ChannelUpdate.parse({ ...base, kind: "callback", data }) : null;
  }
  const msg = ctx.message;
  // Edited messages, service messages and forwards are not enquiries.
  if (!msg || msg.forward_origin) return null;
  if (msg.text) {
    const command = /^\/([a-z_]+)(?:@\w+)?(?:\s|$)/i.exec(msg.text)?.[1]?.toLowerCase();
    if (command !== undefined) {
      const known = EnquiryCommand.safeParse(command);
      return { ...base, kind: "command", command: known.success ? known.data : "help" };
    }
    return { ...base, kind: "text", text: msg.text.slice(0, 4096) };
  }
  if (msg.photo || msg.document || msg.video || msg.voice || msg.audio || msg.sticker || msg.video_note)
    return { ...base, kind: "media" };
  return null;
}

/** Posts to the engine; retries network errors and 5xx (the engine dedupes by update id). */
export function enginePoster(opts: {
  engineUrl: string;
  secret: string;
  fetch?: typeof fetch;
  attempts?: number;
  backoffMs?: number;
  timeoutMs?: number;
}): PostUpdate {
  const doFetch = opts.fetch ?? fetch;
  const attempts = opts.attempts ?? 3;
  return async (u) => {
    let last = "";
    for (let i = 0; i < attempts; i++) {
      if (i) await new Promise((r) => setTimeout(r, (opts.backoffMs ?? 500) * 2 ** (i - 1)));
      try {
        const res = await doFetch(`${opts.engineUrl}/channel/telegram/updates`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${opts.secret}` },
          body: JSON.stringify(u),
          // The chat model can take ~20 s on demo hardware.
          signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
        });
        if (res.ok) return EngineAnswer.parse(await res.json()).reply;
        last = `engine answered ${res.status}`;
        if (res.status < 500) throw new RefusedError(last);
      } catch (e) {
        if (e instanceof RefusedError) throw e;
        last = e instanceof Error ? e.name : String(e);
      }
    }
    throw new Error(`engine unreachable (${last})`);
  };
}

class RefusedError extends Error {}

/**
 * Wires the relay into a bot. Each update is answered in its own chat; a group the bot is added
 * to is left at once (private chats only, one chat = one customer).
 */
export function installRelay(bot: Bot, post: PostUpdate, log: (line: string) => void = console.log) {
  bot.on("my_chat_member", async (ctx) => {
    if (ctx.chat.type !== "private" && ctx.myChatMember.new_chat_member.status === "member") {
      await ctx.leaveChat().catch(() => {});
    }
  });
  bot.on(["message", "callback_query:data"], async (ctx) => {
    if (ctx.callbackQuery) await ctx.answerCallbackQuery().catch(() => {});
    if (ctx.chat && ctx.chat.type !== "private") {
      await ctx.leaveChat().catch(() => {});
      return;
    }
    const update = toChannelUpdate(ctx);
    if (!update) return;
    let reply: ChannelReply | null;
    try {
      reply = await post(update);
    } catch (e) {
      log(`relay: ${chatLabel(update.chatId)} update ${update.updateId}: ${e instanceof Error ? e.message : "failed"}`);
      if (!(e instanceof RefusedError)) await ctx.reply(sorry(update.from.languageCode)).catch(() => {});
      return;
    }
    if (!reply) return;
    const keyboard = inlineKeyboard(reply.buttons);
    // `ctx.reply` sends to `ctx.chat`: the chat this update came from.
    await ctx.reply(reply.text, keyboard ? { reply_markup: keyboard } : {});
  });
}

/** The bot's command menu, in English and Arabic (enquiries only). */
export const COMMANDS = {
  en: [
    { command: "start", description: "Start over" },
    { command: "units", description: "Find a home to rent" },
    { command: "book", description: "Book a viewing" },
    { command: "mybooking", description: "My viewing" },
    { command: "contact", description: "My email and phone" },
    { command: "agent", description: "Talk to a leasing officer" },
    { command: "language", description: "English / العربية" },
    { command: "help", description: "What I can do" },
  ],
  ar: [
    { command: "start", description: "البدء من جديد" },
    { command: "units", description: "ابحث عن منزل للإيجار" },
    { command: "book", description: "احجز معاينة" },
    { command: "mybooking", description: "موعد معاينتي" },
    { command: "contact", description: "بريدي الإلكتروني وهاتفي" },
    { command: "agent", description: "التحدث مع موظف التأجير" },
    { command: "language", description: "English / العربية" },
    { command: "help", description: "ما يمكنني فعله" },
  ],
} satisfies Record<"en" | "ar", { command: EnquiryCommand; description: string }[]>;
