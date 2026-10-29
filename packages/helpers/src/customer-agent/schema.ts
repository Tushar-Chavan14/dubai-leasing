import { ChannelButton, ChatFilters, ChatStatus, ChoiceCard, EnquiryFlow, SizeBand, UnitCard } from "@leasing/core";
import { PropertyCategory } from "@leasing/core";
import { z } from "zod";

/**
 * Customer agent (decision D36): the public web chat's free-text assistant. A chat model with
 * tools. Tools are thin, code-validated wrappers over the Manager; the model never supplies an
 * email, party, application or lease id, and every amount and date it may state comes from a tool.
 */

export const AGENT_TOOL_NAMES = [
  "search_units",
  "unit_details",
  "viewing_slots",
  "book_viewing",
  "apply_now",
  "my_status",
  "start_status_check",
  "offer_choices",
  "handoff",
  /** Only offered when the company allows it (switch `agent_sri_answers`). */
  "area_rent_index",
] as const;
export type AgentToolName = (typeof AGENT_TOOL_NAMES)[number];

const unitId = z.string().min(1).max(64).describe("A unit id returned by search_units or unit_details.");

export const SearchUnitsInput = z.object({
  community: z
    .string()
    .max(120)
    .optional()
    .describe("Only if the visitor named an area: a name from the list of areas."),
  company: z
    .string()
    .max(80)
    .optional()
    .describe("Only if the visitor named a developer, realty company or owner: its name."),
  category: PropertyCategory.optional().describe("Only if the visitor said home, office or shop."),
  bedrooms: z
    .number()
    .int()
    .min(0)
    .max(4)
    .optional()
    .describe("Only if the visitor said how many bedrooms. 0 = studio, 4 = four or more."),
  sizeBand: SizeBand.optional().describe("Commercial and retail only: small, medium or large."),
  maxRentAed: z
    .number()
    .int()
    .min(1000)
    .max(100_000_000)
    .optional()
    .describe("Only if the visitor gave a budget: the yearly rent ceiling in AED."),
  reset: z.boolean().optional().describe("true = ignore the filters from earlier searches."),
  similarTo: z
    .string()
    .max(64)
    .optional()
    .describe("A unit id the visitor was shown that is no longer available: also look for similar units."),
});
export const AreaRentIndexInput = z.object({
  community: z.string().min(1).max(120).describe("An area name from the list of areas."),
  bedrooms: z.number().int().min(0).max(4).optional().describe("0 = studio, 4 = four or more."),
  category: PropertyCategory.optional(),
});
export const UnitDetailsInput = z.object({ unitId });
export const ViewingSlotsInput = z.object({
  unitId,
  day: z.enum(["today", "tomorrow"]).optional(),
  part: z.enum(["morning", "afternoon", "evening"]).optional(),
});
export const BookViewingInput = z.object({
  unitId,
  slot: z.string().min(1).max(40).describe("A slot value returned by viewing_slots."),
});
export const ApplyNowInput = z.object({ unitId });
export const EmptyInput = z.object({});
export const OfferChoicesInput = z.object({
  question: z.string().min(1).max(300),
  options: z
    .array(
      z.object({
        label: z.string().max(80).optional(),
        value: z.string().min(1).max(120).describe("A choice value copied exactly from a tool result."),
      }),
    )
    .min(2)
    .max(4),
});
export const HandoffInput = z.object({ reason: z.enum(["existing_tenant", "talk_to_person", "other"]) });

export const AgentEffects = z.object({
  cards: z.array(UnitCard).max(5).optional(),
  choices: ChoiceCard.optional(),
  /** Personal details: shown once, never stored in history or in the run log. */
  status: ChatStatus.optional(),
  input: z.literal("code").optional(),
  buttons: z.array(ChannelButton).max(10).optional(),
  /** The conversation's next flow, applied if the customer's flow hasn't moved on meanwhile. */
  flow: EnquiryFlow.optional(),
  /** Stored on the outbound message ("booked", "ask_name", ...). */
  kind: z.string().max(40).optional(),
});
export type AgentEffects = z.infer<typeof AgentEffects>;

export const AgentContext = z.object({
  /** One message from the visitor, untrusted. PII already masked. */
  text: z.string().min(1).max(1000),
  language: z.enum(["en", "ar"]),
  /** Today in Dubai, only so "tomorrow" can be understood. The model may not state dates itself. */
  today: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekday: z.string().max(12),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(600) })).max(10),
  /** Areas with bookable units: the values `search_units.community` and `area:` choices accept. */
  communities: z.array(z.string().min(1).max(120)).max(25),
  filters: ChatFilters.partial(),
  /** The units the visitor was last shown (cards), in order: "the first one" is the first of these. */
  shown: z
    .array(
      z.object({
        unitId: z.string(),
        code: z.string(),
        building: z.string(),
        community: z.string(),
        bedrooms: z.number().int().nullable(),
      }),
    )
    .max(5)
    .default([]),
  step: EnquiryFlow.shape.step,
  unit: z.object({ code: z.string(), building: z.string(), community: z.string() }).nullable(),
  /** The visitor's email is on file (the chat asks for it first). */
  emailKnown: z.boolean(),
  statusVerified: z.boolean(),
  applyEnabled: z.boolean(),
  /** The company lets the agent quote the average rent of an area (`agent_sri_answers`). */
  sriEnabled: z.boolean().optional(),
});
export type AgentContext = z.infer<typeof AgentContext>;

export const AgentToolLog = z.object({
  name: z.string(),
  /** Masked arguments. */
  args: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  resultSha256: z.string(),
});

export const AgentData = z.object({
  /** The reply text. Empty when `kind` is "fallback" (the engine writes the fixed line). */
  text: z.string().max(4000),
  /** answer: the model's text, value-checked. final: written by code after a tool. fallback: the engine says a fixed line. */
  kind: z.enum(["answer", "final", "fallback"]),
  fallback: z.enum(["model_error", "value_check", "empty", "timeout"]).optional(),
  effects: AgentEffects,
  tools: z.array(AgentToolLog).max(12),
  /** Amounts, dates or claims the check rejected (kept for the audit, never shown). */
  unverified: z.array(z.string()).max(20),
  language: z.enum(["en", "ar"]),
});
export type AgentData = z.infer<typeof AgentData>;

export const CustomerAgentSchemas = { context: AgentContext, data: AgentData };
