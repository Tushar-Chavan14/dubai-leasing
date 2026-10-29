import { z } from "zod";
import { PropertyCategory } from "./portfolio.ts";

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

/**
 * Public web chat: `updateId` is the client message id (UUID); `chatId` and `from.id` are the
 * visitor id (UUID), set by the web server. Only the web server, with `CHANNEL_SECRET`, posts these.
 */
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

export const ChannelButton = z.object({
  label: z.string().min(1).max(64),
  data: CallbackData,
  /** Web chat: shown but not selectable ("Coming soon"). */
  disabled: z.boolean().optional(),
});
export type ChannelButton = z.infer<typeof ChannelButton>;

/** A unit shown in the web chat. `rent` is formatted by code, never by a model. */
export const UnitCard = z.object({
  unitId: z.uuid(),
  code: z.string(),
  building: z.string(),
  community: z.string(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  areaSqft: z.number().nullable(),
  category: PropertyCategory,
  subtype: z.string().nullable(),
  furnished: z.boolean(),
  rent: z.string(),
  photoUrl: z.string().nullable(),
  /** Web chat: show "Apply now" (the `apply_without_viewing` toggle is on). */
  canApply: z.boolean().optional(),
});
export type UnitCard = z.infer<typeof UnitCard>;

/** The five stages of the visitor status tracker, in order. */
export const STATUS_STAGES = ["Viewing", "Documents", "Offer", "Contract", "Ejari"] as const;
export const StatusStageName = z.enum(STATUS_STAGES);
export type StatusStageName = z.infer<typeof StatusStageName>;

/**
 * One open application or lease in the web chat's verified status (decision D34). Read-only and
 * visitor-facing: no ID numbers, deposit or landlord details. `annualRent` is formatted by code
 * from the stored offer. Each action re-sends an existing portal link or document by email.
 */
export const StatusItem = z.object({
  kind: z.enum(["application", "lease"]),
  ref: z.string(),
  unitCode: z.string(),
  stage: StatusStageName,
  stages: z.array(z.object({ name: StatusStageName, state: z.enum(["done", "current", "todo"]) })),
  nextStep: z.string(),
  offer: z.object({ annualRentFils: z.number().int(), annualRent: z.string(), cheques: z.number().int() }).optional(),
  actions: z.array(ChannelButton),
});
export type StatusItem = z.infer<typeof StatusItem>;
export const ChatStatus = z.object({ apps: z.array(StatusItem).max(10) });
export type ChatStatus = z.infer<typeof ChatStatus>;

/**
 * A multiple-choice card from the web agent (decision D36): a question and two to four options.
 * `data` is always a `pick:<id>:<n>` button the engine resolves from its own stored choices, never a raw value.
 */
export const ChoiceCard = z.object({
  question: z.string().min(1).max(300),
  options: z
    .array(z.object({ label: z.string().min(1).max(64), data: CallbackData }))
    .min(2)
    .max(4),
});
export type ChoiceCard = z.infer<typeof ChoiceCard>;

export const ChannelReply = z.object({
  text: z.string().min(1).max(4000),
  /** Inline keyboard, one button per row. */
  buttons: z.array(ChannelButton).max(10).optional(),
  /** Web chat only. */
  cards: z.array(UnitCard).max(5).optional(),
  /** Web chat only: the verified visitor's applications and leases. Returned once, never stored in the chat history. */
  status: ChatStatus.optional(),
  /** Web chat only: the agent asks the visitor to choose; shown as large tappable options plus "Type something else". */
  choices: ChoiceCard.optional(),
  /** Web chat only: the reply asks for the emailed status code, so the UI shows a numeric code field. */
  input: z.literal("code").optional(),
});
export type ChannelReply = z.infer<typeof ChannelReply>;

export const EnquiryEmirate = z.enum(["dubai"]);
export type EnquiryEmirate = z.infer<typeof EnquiryEmirate>;
/** Size bands for commercial and retail units: up to 1,000, 1,000 to 3,000, over 3,000 sq ft. */
export const SizeBand = z.enum(["small", "medium", "large"]);
export type SizeBand = z.infer<typeof SizeBand>;
export const SIZE_BAND_LIMITS: Record<SizeBand, { min?: number; max?: number }> = {
  small: { max: 1000 },
  medium: { min: 1001, max: 3000 },
  large: { min: 3001 },
};

/** The band a floor area falls in. */
export function sizeBandOf(areaSqft: number): SizeBand {
  return areaSqft <= 1000 ? "small" : areaSqft <= 3000 ? "medium" : "large";
}

/** Search filters as the web chat reports them with every reply, so the property grid can follow. */
export const ChatFilters = z.object({
  emirate: EnquiryEmirate.nullable(),
  community: z.string().nullable(),
  category: PropertyCategory.nullable(),
  bedrooms: z.number().int().min(0).max(4).nullable(),
  sizeBand: SizeBand.nullable(),
  maxRentFils: z.number().int().nullable(),
});
export type ChatFilters = z.infer<typeof ChatFilters>;

/** One option on a stored choice card. The engine issues these; a `pick:<id>:<n>` tap is looked up here. */
export const ChoiceItem = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("slot"), unitId: z.uuid(), slot: z.iso.datetime({ offset: true }) }),
  z.object({ kind: z.literal("unit"), unitId: z.uuid() }),
  z.object({ kind: z.literal("area"), community: z.string().max(120) }),
  z.object({ kind: z.literal("category"), category: PropertyCategory }),
  z.object({ kind: z.literal("bedrooms"), bedrooms: z.number().int().min(0).max(4) }),
]);
export type ChoiceItem = z.infer<typeof ChoiceItem>;

/** Where a customer is in the booking flow. Stored per conversation; never shared between chats. */
export const EnquiryFlow = z.object({
  /** Contact first (email required, phone optional), then search, unit, slot and name. */
  step: z.enum([
    "asking_contact_email",
    "asking_contact_phone",
    "idle",
    /** Web chat only: the property-type buttons (bedrooms, then furnished). */
    "choosing_emirate",
    "choosing_community",
    "choosing_category",
    "choosing_bedrooms",
    "choosing_size",
    "choosing_budget",
    "choosing_furnished",
    "choosing_unit",
    "choosing_slot",
    "asking_name",
    "asking_email",
    /** Web chat: the 6-digit status code was emailed and is being typed (decision D34). */
    "asking_status_code",
    /** Web chat, "Apply now" for a commercial or retail unit: the company comes before the contact person. */
    "asking_company_name",
  ]),
  bedrooms: z.number().int().min(0).max(4).optional(),
  furnished: z.boolean().optional(),
  /** Web agent: a booking or application the agent started; it counts against `agent_daily_action_cap` when it completes. */
  agent: z.boolean().optional(),
  community: z.string().max(120).optional(),
  /** Web agent: only this company's units (a search filter the agent resolved from a name). */
  companyId: z.uuid().optional(),
  emirate: EnquiryEmirate.optional(),
  category: PropertyCategory.optional(),
  sizeBand: SizeBand.optional(),
  /** Budget cap, annual rent in fils (a customer's filter, never a rulebook value). */
  maxRentFils: z.number().int().positive().optional(),
  unitId: z.uuid().optional(),
  /** ISO instant of the chosen viewing slot. */
  slot: z.iso.datetime({ offset: true }).optional(),
  nameEn: z.string().max(120).optional(),
  /** Web chat: the name being asked is for an application without a viewing ("Apply now"). */
  apply: z.boolean().optional(),
  /** Commercial or retail "Apply now": the applicant company (the contact person is `nameEn`). */
  companyName: z.string().max(120).optional(),
  /** Web agent (D36): the options of the choice card last shown. Taps are `pick:<id>:<n>`, resolved only from here. */
  choiceSet: z.object({ id: z.string().regex(/^[0-9a-f]{8}$/), items: z.array(ChoiceItem).max(4) }).optional(),
  /** Web agent: the units last shown to the visitor (cards); the only unit ids the agent may act on besides `unitId`. */
  shown: z.array(z.uuid()).max(5).optional(),
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
