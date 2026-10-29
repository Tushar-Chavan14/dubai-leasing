import { z } from "zod";
import {
  AGENT_TOOL_NAMES,
  type AgentContext,
  type AgentEffects,
  type AgentToolName,
  ApplyNowInput,
  AreaRentIndexInput,
  BookViewingInput,
  EmptyInput,
  HandoffInput,
  OfferChoicesInput,
  SearchUnitsInput,
  UnitDetailsInput,
  ViewingSlotsInput,
} from "./schema.ts";

/**
 * What a tool run gives back. `result` is what the model sees (never an email, id of a party,
 * application or lease). `effects` shape the reply the visitor gets. `final` is text written by
 * code that ends the turn (a confirmation, a question the system asks, a fixed refusal): the model
 * does not get to reword it. `modelAuthored` marks a `final` the model wrote (a choice question),
 * which still goes through the value check.
 */
export interface ToolOutcome {
  result: Record<string, unknown>;
  effects?: Partial<AgentEffects>;
  final?: string;
  modelAuthored?: boolean;
}

/**
 * The engine's side of the tools. Each method acts as the conversation (its own contact email,
 * its own chat), validates every id and slot against what tools issued, and re-checks toggles and
 * limits in code. Methods return data or throw; they never need the model to be right.
 */
export interface AgentBackend {
  search_units(a: z.infer<typeof SearchUnitsInput>): Promise<ToolOutcome>;
  unit_details(a: z.infer<typeof UnitDetailsInput>): Promise<ToolOutcome>;
  viewing_slots(a: z.infer<typeof ViewingSlotsInput>): Promise<ToolOutcome>;
  book_viewing(a: z.infer<typeof BookViewingInput>): Promise<ToolOutcome>;
  apply_now(a: z.infer<typeof ApplyNowInput>): Promise<ToolOutcome>;
  my_status(a: z.infer<typeof EmptyInput>): Promise<ToolOutcome>;
  start_status_check(a: z.infer<typeof EmptyInput>): Promise<ToolOutcome>;
  offer_choices(a: z.infer<typeof OfferChoicesInput>): Promise<ToolOutcome>;
  handoff(a: z.infer<typeof HandoffInput>): Promise<ToolOutcome>;
  area_rent_index(a: z.infer<typeof AreaRentIndexInput>): Promise<ToolOutcome>;
}

export interface AgentTool {
  name: AgentToolName;
  description: string;
  input: z.ZodType<Record<string, unknown>>;
}

const tool = (name: AgentToolName, description: string, input: z.ZodTypeAny): AgentTool => ({
  name,
  description,
  input: input as AgentTool["input"],
});

export const AGENT_TOOLS: Record<AgentToolName, AgentTool> = {
  search_units: tool(
    "search_units",
    'Find up to 5 bookable units to show, and `total`, how many bookable units match (use it for "how many" questions). Can filter by area, company (developer, realty company or owner name), type, bedrooms, size and budget. Filters add to the earlier ones unless reset is true. Returns each unit with its rent as text and a choice value. Cards are shown to the visitor automatically.',
    SearchUnitsInput,
  ),
  unit_details: tool(
    "unit_details",
    "Facts about one unit the visitor was shown: size, rooms, floor, parking, furnished, rent as text, description.",
    UnitDetailsInput,
  ),
  viewing_slots: tool(
    "viewing_slots",
    "Free viewing times for one unit, up to 6, optionally for today or tomorrow and a part of the day. Returns each time as text with a slot value and a choice value.",
    ViewingSlotsInput,
  ),
  book_viewing: tool(
    "book_viewing",
    "Book one viewing for this visitor. The slot must be a slot value from viewing_slots in this turn. If the visitor's name is missing the system asks for it. The system writes the confirmation.",
    BookViewingInput,
  ),
  apply_now: tool(
    "apply_now",
    "Apply for a unit without a viewing. The system asks for a name (and a company name for business units) and writes the confirmation.",
    ApplyNowInput,
  ),
  my_status: tool(
    "my_status",
    "Show this visitor's applications and leases (verified visitors only). The tracker is shown automatically; summarise it in plain words.",
    EmptyInput,
  ),
  start_status_check: tool(
    "start_status_check",
    "Send a 6-digit code to the visitor's email so they can see their applications. The system writes the reply.",
    EmptyInput,
  ),
  offer_choices: tool(
    "offer_choices",
    "Show a multiple-choice card: a short question and 2 to 4 options. Values must be copied exactly from tool results (slot, unit, area, category or bedrooms choice values). Ends your turn.",
    OfferChoicesInput,
  ),
  handoff: tool(
    "handoff",
    "Use when you cannot help: a tenant with a lease, payment or repair question (existing_tenant), a request for a person (talk_to_person), anything else out of scope (other). The system writes the reply.",
    HandoffInput,
  ),
  area_rent_index: tool(
    "area_rent_index",
    "The Smart Rental Index average yearly rent for an area (and bedroom count or property type), as text. Use only when the visitor asks what rents are typical. Quote it as returned, and say it is an index average, not an offer or a price for a unit.",
    AreaRentIndexInput,
  ),
};

/** The tools the model is offered this turn. The backend re-checks every condition when a tool runs. */
export function toolsFor(
  c: Pick<AgentContext, "applyEnabled" | "statusVerified" | "emailKnown"> & Partial<Pick<AgentContext, "sriEnabled">>,
): AgentTool[] {
  return AGENT_TOOL_NAMES.filter((n) => {
    if (n === "area_rent_index") return c.sriEnabled === true;
    if (n === "apply_now") return c.applyEnabled;
    if (n === "my_status") return c.statusVerified;
    if (n === "start_status_check") return !c.statusVerified && c.emailKnown;
    return true;
  }).map((n) => AGENT_TOOLS[n]);
}
