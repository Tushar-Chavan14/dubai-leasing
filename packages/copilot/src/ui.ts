import { UnitCard } from "@leasing/core";
import { z } from "zod";

/**
 * What the chat shows besides the answer text: record and unit cards, and one choice card.
 * Tools return these under `ui`; the graph strips them from what the model sees and streams them
 * to the client. They link into the staff app; a card's quick actions only send a prompt or open a page: a card or a
 * choice can't approve, send or change anything (AGENTS.md rule 11).
 */
/**
 * A quick action on a record card. `prompt` sends that text into the chat as the user's own message,
 * so the model calls the propose or draft tool and the usual Confirm card appears; the button itself
 * runs nothing. `link` opens a page. Computed in code from the record's state, never by the model.
 */
export const RecordAction = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("prompt"),
    key: z.string(),
    label: z.string(),
    prompt: z.string(),
    /** Set when the user's role can't run it: the button shows disabled with this reason. */
    blocked: z.string().optional(),
  }),
  z.object({ type: z.literal("link"), key: z.string(), label: z.string(), href: z.string() }),
]);
export type RecordAction = z.infer<typeof RecordAction>;

export const RecordCard = z.object({
  kind: z.literal("record"),
  recordKind: z.enum(["application", "lease"]),
  id: z.string(),
  ref: z.string(),
  name: z.string(),
  unit: z.string(),
  stage: z.string(),
  nextStep: z.string(),
  /** The Workspace, `/work?kind=…&id=…`. */
  href: z.string(),
  /** Stage-based quick actions (the Workspace link comes last). */
  actions: z.array(RecordAction).default([]),
});
export type RecordCard = z.infer<typeof RecordCard>;

export const UnitCardItem = z.object({
  kind: z.literal("unit"),
  card: UnitCard,
  /** The unit page in the staff app, `/units/<id>`. */
  href: z.string(),
});
export type UnitCardItem = z.infer<typeof UnitCardItem>;

export const CopilotCard = z.discriminatedUnion("kind", [RecordCard, UnitCardItem]);
export type CopilotCard = z.infer<typeof CopilotCard>;

export const ChoiceOption = z.object({
  label: z.string().min(1).max(40),
  /** A value a tool returned earlier in the turn (record ref, unit id or code, area, company…). */
  value: z.string().min(1).max(80),
  /** What a tap sends as the user's next message when the option doesn't open a page. */
  say: z.string(),
  /** Navigation choices open this page in the app instead of sending a message. */
  href: z.string().optional(),
});
export const Choices = z.object({
  question: z.string().min(1).max(300),
  options: z.array(ChoiceOption).min(2).max(4),
});
export type Choices = z.infer<typeof Choices>;

export const ToolUi = z.object({
  cards: z.array(CopilotCard).max(10).optional(),
  choices: Choices.optional(),
});
export type ToolUi = z.infer<typeof ToolUi>;

export const workHref = (kind: "application" | "lease", id: string) => `/work?kind=${kind}&id=${id}`;
export const unitHref = (unitId: string) => `/units/${unitId}`;
