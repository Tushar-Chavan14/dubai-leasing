import { z } from "zod";

/**
 * Enquiry channel messages (architecture §8, decision D24). The bot turns each Telegram update
 * into a `ChannelUpdate`, posts it to the engine and sends back the engine's `ChannelReply` to
 * the same chat. The bot keeps no conversation state; the engine owns it.
 */

/** Commands in the bot's menu. Enquiries only: tenants act through the portal (rule 10). */
export const EnquiryCommand = z.enum(["start", "units", "book", "mybooking", "agent", "language", "contact", "help"]);
export type EnquiryCommand = z.infer<typeof EnquiryCommand>;

/** Telegram limits callback data to 64 bytes. */
const CallbackData = z.string().min(1).max(64);

const telegramBase = {
  channel: z.literal("telegram"),
  /** Telegram `update_id`: the same update delivered twice is handled once. */
  updateId: z.string().regex(/^\d{1,20}$/),
  /** Private chats only: the chat id is the customer. */
  chatId: z.string().regex(/^\d{1,20}$/),
  from: z.object({
    id: z.string().regex(/^\d{1,20}$/),
    firstName: z.string().max(128).optional(),
    languageCode: z.string().max(16).optional(),
  }),
};

/** Web chat: `updateId` is the client message id (UUID); `chatId` and `from.id` are the customer account id. */
const webBase = {
  channel: z.literal("web"),
  updateId: z.uuid(),
  chatId: z.uuid(),
  from: z.object({
    id: z.uuid(),
    firstName: z.string().max(128).optional(),
    languageCode: z.string().max(16).optional(),
  }),
};

export const ChannelUpdate = z.union([
  z.discriminatedUnion("kind", [
    z.object({ ...telegramBase, kind: z.literal("text"), text: z.string().min(1).max(4096) }),
    z.object({ ...telegramBase, kind: z.literal("command"), command: EnquiryCommand }),
    z.object({ ...telegramBase, kind: z.literal("callback"), data: CallbackData }),
    /** A photo, file, voice note or sticker. Never stored or forwarded (ID documents go through the upload link only). */
    z.object({ ...telegramBase, kind: z.literal("media") }),
  ]),
  z.discriminatedUnion("kind", [
    z.object({ ...webBase, kind: z.literal("text"), text: z.string().min(1).max(1000) }),
    z.object({ ...webBase, kind: z.literal("callback"), data: CallbackData }),
  ]),
]);
export type ChannelUpdate = z.infer<typeof ChannelUpdate>;

export const ChannelButton = z.object({ label: z.string().min(1).max(64), data: CallbackData });
export type ChannelButton = z.infer<typeof ChannelButton>;

/** A unit shown in the web chat. `rent` is formatted by code, never by a model. */
export const UnitCard = z.object({
  unitId: z.uuid(),
  code: z.string(),
  building: z.string(),
  community: z.string(),
  bedrooms: z.number().int(),
  bathrooms: z.number().int(),
  areaSqft: z.number(),
  furnished: z.boolean(),
  rent: z.string(),
  photoUrl: z.string().nullable(),
});
export type UnitCard = z.infer<typeof UnitCard>;

/** An application or lease shown in the web chat. */
export const RecordCard = z.object({
  kind: z.enum(["application", "lease"]),
  id: z.string(),
  ref: z.string(),
  unitLabel: z.string(),
  community: z.string(),
  stage: z.string(),
  stageLabel: z.string(),
  dates: z.array(z.object({ label: z.string(), on: z.string() })),
  nextPayment: z.object({ dueOn: z.string(), amount: z.string() }).nullable(),
  needsDocuments: z.boolean(),
});
export type RecordCard = z.infer<typeof RecordCard>;

/** Document upload prompt for an application, with what is already uploaded. */
export const UploadCard = z.object({
  applicationId: z.string(),
  documents: z.array(
    z.object({ id: z.string(), kind: z.string(), side: z.string().nullable(), uploadedAt: z.string() }),
  ),
});
export type UploadCard = z.infer<typeof UploadCard>;

export const ChannelReply = z.object({
  text: z.string().min(1).max(4000),
  /** Inline keyboard, one button per row. */
  buttons: z.array(ChannelButton).max(10).optional(),
  /** Web chat only. */
  cards: z.array(UnitCard).max(5).optional(),
  records: z.array(RecordCard).max(10).optional(),
  upload: UploadCard.optional(),
});
export type ChannelReply = z.infer<typeof ChannelReply>;

/** Where a customer is in the booking flow. Stored per conversation; never shared between chats. */
export const EnquiryFlow = z.object({
  /** Contact first (email required, phone optional), then search, unit, slot and name. */
  step: z.enum([
    "asking_contact_email",
    "asking_contact_phone",
    "idle",
    "choosing_unit",
    "choosing_slot",
    "asking_name",
    "asking_email",
  ]),
  bedrooms: z.number().int().min(0).max(4).optional(),
  furnished: z.boolean().optional(),
  community: z.string().max(120).optional(),
  unitId: z.uuid().optional(),
  /** ISO instant of the chosen viewing slot. */
  slot: z.iso.datetime({ offset: true }).optional(),
  nameEn: z.string().max(120).optional(),
});
export type EnquiryFlow = z.infer<typeof EnquiryFlow>;
export const IDLE_FLOW: EnquiryFlow = { step: "idle" };

export type EnquiryLanguage = "en" | "ar";

/**
 * A phone number as typed → `+<country><number>`, or null if it isn't one. Spaces, dashes, dots
 * and brackets are dropped; `00` becomes `+`; a UAE local number (`05x…`, `04…`) gets `+971`.
 * 7–15 digits after the `+` (E.164 length).
 */
export function normalisePhone(input: string): string | null {
  let s = input.trim().replace(/[\s().-]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  else if (/^0\d{8,9}$/.test(s)) s = `+971${s.slice(1)}`;
  return /^\+[1-9]\d{6,14}$/.test(s) ? s : null;
}
