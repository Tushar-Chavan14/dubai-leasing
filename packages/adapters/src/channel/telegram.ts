import { Api, InlineKeyboard } from "grammy";
import type { ChannelSender, OutboundMessage } from "./types.ts";

/** One button per row; Telegram renders callback buttons under the message. */
export function inlineKeyboard(buttons: OutboundMessage["buttons"]): InlineKeyboard | undefined {
  if (!buttons?.length) return undefined;
  return InlineKeyboard.from(buttons.map((b) => [InlineKeyboard.text(b.label, b.data)]));
}

/** Sends to one Telegram chat through the Bot API (no polling; the bot app receives updates). */
export class TelegramSender implements ChannelSender {
  readonly name = "telegram" as const;
  private readonly api: Api;
  constructor(token: string) {
    this.api = new Api(token);
  }

  async reply(chatId: string, msg: OutboundMessage): Promise<{ messageId: string }> {
    const keyboard = inlineKeyboard(msg.buttons);
    const sent = await this.api.sendMessage(chatId, msg.text, keyboard ? { reply_markup: keyboard } : {});
    return { messageId: String(sent.message_id) };
  }
}

/** Test double: records what would have been sent, per chat. */
export class FakeChannelSender implements ChannelSender {
  readonly name = "telegram" as const;
  sent: { chatId: string; msg: OutboundMessage }[] = [];
  fail = false;
  async reply(chatId: string, msg: OutboundMessage): Promise<{ messageId: string }> {
    if (this.fail) throw new Error("telegram unavailable");
    this.sent.push({ chatId, msg });
    return { messageId: String(this.sent.length) };
  }
}
