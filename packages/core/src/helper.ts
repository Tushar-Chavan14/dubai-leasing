import { z } from "zod";

/** Helper contract (docs/architecture.md §5). Helpers return data; only the Manager writes state. */
export const EntityKind = z.enum(["unit", "application", "lease", "rulebook", "conversation", "company"]);
export type EntityKind = z.infer<typeof EntityKind>;

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface HelperInput<C> {
  runId: string;
  entity: EntityRef;
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

export interface Helper<C, D> {
  name: string;
  run(input: HelperInput<C>): Promise<HelperResult<D>>;
}
