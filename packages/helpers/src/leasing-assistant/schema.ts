import { EnquiryFlow, PropertyCategory, SizeBand } from "@leasing/core";
import { z } from "zod";

export const ENQUIRY_INTENTS = [
  "search_units",
  "unit_question",
  "general_question",
  "book_viewing",
  "talk_to_person",
  "existing_tenant",
  "greeting",
  "none",
] as const;
export type EnquiryIntent = (typeof ENQUIRY_INTENTS)[number];

/** Listing facts for one unit, written by code from the unit record. No money: the model never sees a price. */
export const UnitFacts = z.object({
  code: z.string(),
  building: z.string(),
  community: z.string(),
  bedrooms: z.number().int().nullable(),
  bathrooms: z.number().int().nullable(),
  areaSqft: z.number().int().nullable(),
  floor: z.number().int().nullable(),
  parkingSpaces: z.number().int().nullable(),
  furnished: z.boolean().nullable(),
  description: z.string().max(2000).nullable(),
});
export type UnitFacts = z.infer<typeof UnitFacts>;

export const LeasingAssistantContext = z.object({
  /** One message from the enquirer, untrusted. */
  text: z.string().min(1).max(1000),
  step: EnquiryFlow.shape.step,
  /** The public web chat also searches commercial and retail units; Telegram stays residential. Default telegram. */
  channel: z.enum(["telegram", "web"]).optional(),
  /** Communities with listed units (the `community` question's options). */
  communities: z.array(z.string().min(1).max(120)).max(25),
  /** The unit the enquirer picked, if any: a question about it is answered from its facts. */
  unit: UnitFacts.optional(),
  /** Every unit offered now (no prices): general questions are answered from these. */
  listings: z.array(UnitFacts).max(25),
  minConfidence: z.number().min(0).max(1),
  handoffThreshold: z.number().min(0).max(1),
});
export type LeasingAssistantContext = z.infer<typeof LeasingAssistantContext>;

export const LeasingAssistantData = z.object({
  intent: z.enum(ENQUIRY_INTENTS),
  confidence: z.number().min(0).max(1),
  probabilities: z.record(z.string(), z.number()),
  language: z.enum(["en", "ar", "other"]),
  flags: z.object({
    commercial: z.number().min(0).max(1),
    vip: z.number().min(0).max(1),
    complaint: z.number().min(0).max(1),
    /** Probability the message tries to instruct the system (prompt injection). */
    injection: z.number().min(0).max(1),
  }),
  /** Search filters read from the message (bedrooms 0 = studio, 4 = four or more). */
  search: z.object({
    bedrooms: z.number().int().min(0).max(4).optional(),
    community: z.string().optional(),
    /** Web chat only. Code checks every value against what is bookable. */
    emirate: z.enum(["dubai", "abu_dhabi", "sharjah"]).optional(),
    category: PropertyCategory.optional(),
    sizeBand: SizeBand.optional(),
  }),
  /** An officer should take the conversation. */
  handoff: z.boolean(),
  /** The chat model's answer (about the picked unit, or the listings in general), after the value check. */
  answer: z.string().max(1200).optional(),
});
export type LeasingAssistantData = z.infer<typeof LeasingAssistantData>;

export const LeasingAssistantSchemas = { context: LeasingAssistantContext, data: LeasingAssistantData };
