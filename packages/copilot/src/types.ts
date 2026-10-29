import type { StaffRole, StaffUser } from "@leasing/core";
import type { z } from "zod";

/**
 * How copilot tools reach the system: the engine HTTP API, as the signed-in user, so the same
 * routes and role checks apply as in the staff UI (architecture §8b). `get` reads allowlisted
 * routes; `propose` can only store a proposal (`POST /api/copilot/proposals`), which does nothing
 * until the user clicks Confirm in the chat (D25). No method can approve, send, confirm or change
 * anything.
 */
export interface EngineClient {
  get<T = unknown>(path: string): Promise<T>;
  propose<T = unknown>(path: string, body: unknown): Promise<T>;
}

export class EngineError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ToolContext {
  engine: EngineClient;
  user: StaffUser;
  /** Asia/Dubai calendar date from the engine's Clock. */
  today: string;
  /**
   * Values tools returned earlier in this turn, each with the page it opens (or null). The graph
   * fills it; `offer_choices` accepts only these.
   */
  issued?: ReadonlyMap<string, string | null>;
  /** The engine's TENANCY_OPS (the graph fills it). While off, tools stay on the Contract AI pipeline. */
  tenancyOps?: boolean;
}

export type ToolKind = "read" | "draft" | "propose";

export interface CopilotTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  /** snake_case verb_noun. */
  name: string;
  /** `propose` tools only store a proposal; the user's Confirm click in the chat carries it out (D25). */
  kind: ToolKind;
  /** Shown to the model: when to use it and what it returns. */
  description: string;
  input: I;
  output: O;
  /** Who may use it. Only hides the tool from the model; the engine checks the role again. */
  roles: readonly StaffRole[];
  run(args: z.infer<I>, ctx: ToolContext): Promise<z.infer<O>>;
}

export const ALL_STAFF: readonly StaffRole[] = ["leasing_officer", "leasing_manager", "finance", "admin"];
