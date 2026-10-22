import { createHash } from "node:crypto";
import { type Helper, HelperOutput, type HelperInput, type HelperResult } from "@leasing/core";
import type { z } from "zod";

export interface RunRecord<D> {
  result: HelperResult<D>;
  /** How many times the helper ran (1, or 2 after one retry). */
  attempts: number;
  latencyMs: number;
  inputHash: string;
  /** Last validation or runtime error, if the result is a forced needs_human. */
  error?: string;
}

/**
 * Wraps every helper (architecture §5): validate input → run → validate output → retry once →
 * otherwise `needs_human`. The caller (the engine) stores the record in `helper_runs`.
 * Nothing advances on an unparsed answer (AGENTS.md rule 6).
 */
export async function runHelper<C, D>(
  helper: Helper<C, D>,
  input: HelperInput<C>,
  schemas: { context: z.ZodType<C>; data: z.ZodType<D> },
  timer: () => number,
): Promise<RunRecord<D>> {
  const inputHash = createHash("sha256")
    .update(JSON.stringify({ helper: helper.name, context: input.context, rulesVersion: input.rulesVersion }))
    .digest("hex");
  const started = timer();
  const ctx = schemas.context.safeParse(input.context);
  if (!ctx.success) {
    return {
      result: {
        status: "failed",
        reasons: ["helper input is invalid", ...ctx.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`)],
        sourceDocIds: [],
      },
      attempts: 0,
      latencyMs: 0,
      inputHash,
      error: "invalid input",
    };
  }
  const outputSchema = HelperOutput(schemas.data);
  let lastError = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const raw = await helper.run({ ...input, context: ctx.data });
      const parsed = outputSchema.safeParse(raw);
      if (parsed.success) {
        return { result: parsed.data as HelperResult<D>, attempts: attempt, latencyMs: timer() - started, inputHash };
      }
      lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return {
    result: {
      status: "needs_human",
      reasons: [`${helper.name} gave no valid answer after a retry; a person needs to look`],
      sourceDocIds: [],
    },
    attempts: 2,
    latencyMs: timer() - started,
    inputHash,
    error: lastError,
  };
}
