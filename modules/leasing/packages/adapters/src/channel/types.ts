/** Enquiry channel (architecture §8). Telegram now, WhatsApp later. Enquiries only. */
export interface InboundMessage {
  chatId: string;
  text: string;
  from: { id: string; name?: string; languageCode?: string };
  at: Date;
}

export interface OutboundMessage {
  text: string;
  buttons?: { label: string; data: string }[];
}

export interface EnquiryChannel {
  name: "telegram" | "whatsapp";
  onMessage(handler: (m: InboundMessage) => Promise<void>): void;
  reply(chatId: string, msg: OutboundMessage): Promise<{ messageId: string }>;
}

/**
 * The sending half of a channel, used by the engine for an officer's reply in a handed-off
 * conversation. Bot answers go back through the bot itself, on the update that asked.
 */
export type ChannelSender = Pick<EnquiryChannel, "name" | "reply">;
