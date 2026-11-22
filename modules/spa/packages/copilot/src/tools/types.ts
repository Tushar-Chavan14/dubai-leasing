import type { SpaRole } from "@spa/core";
import type { z } from "zod";
import type { EngineClient } from "../client.ts";

export type ToolKind = "read" | "draft" | "propose";

/**
 * One copilot tool (C36, S68): Zod input and output, a `kind` and the `roles` that are offered it (the engine checks
 * again, so a role not listed gets a refusal from the route too). A tool reaches the engine only through the client.
 */
export interface CopilotTool<I extends z.ZodType = z.ZodType, O extends z.ZodType = z.ZodType> {
  name: string;
  description: string;
  kind: ToolKind;
  roles: readonly SpaRole[];
  input: I;
  output: O;
  run(client: EngineClient, args: z.output<I>): Promise<z.output<O>>;
  /** Text written by code that ends the turn when the tool did its job; the model does not reword it. */
  final?(out: z.output<O>): string | null;
}
