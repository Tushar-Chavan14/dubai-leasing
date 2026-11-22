import { z } from "zod";

/**
 * Helper contract (docs/leasing/architecture.md §5), shared by every module (S4). Helpers return data; only the module's
 * Manager writes state. Each module names its own entity kinds (leasing: `EntityKind` in `@leasing/core`).
 */
export interface EntityRef<K extends string = string> {
  kind: K;
  id: string;
}

export interface HelperInput<C, K extends string = string> {
  runId: string;
  entity: EntityRef<K>;
  step: string;
  context: C;
  rulesVersion: string;
  /** From Clock, ISO instant. */
  now: string;
}

export const HelperOutput = <T extends z.ZodTypeAny>(data: T) =>
  z.object({
    status: z.enum(["ok", "needs_human", "failed"]),
    data: data.optional(),
    reasons: z.array(z.string()),
    sourceDocIds: z.array(z.string()),
    model: z.object({ name: z.string(), confidence: z.number().optional() }).optional(),
  });

export type HelperResult<D> = {
  status: "ok" | "needs_human" | "failed";
  data?: D;
  reasons: string[];
  sourceDocIds: string[];
  model?: { name: string; confidence?: number };
};

export interface Helper<C, D, K extends string = string> {
  name: string;
  run(input: HelperInput<C, K>): Promise<HelperResult<D>>;
}
