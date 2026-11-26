import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrustedDeep } from "../untrusted.ts";
import { dubaiDay } from "./shared.ts";

const Input = z.object({
  helperRunId: z.string().uuid().describe("A helperRunId from a lease, approval or tenant reply"),
});
const Output = z.object({
  helper: z.string(),
  status: z.string(),
  ranOn: z.string().nullable(),
  model: z.string().nullable(),
  confidence: z.number().nullable(),
  attempts: z.number(),
  data: z.unknown(),
  reasons: z.array(z.string()),
});

interface Run {
  helper: string;
  status: string;
  output: { data?: unknown; reasons?: string[] } | null;
  model: string | null;
  confidence: number | null;
  attempt: number;
  at: string;
}

export const getHelperRun: CopilotTool<typeof Input, typeof Output> = {
  name: "get_helper_run",
  kind: "read",
  description:
    "What a helper (renewal, reply classifier, …) decided in one run and why: its result, reasons and confidence.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ helperRunId }, { engine }) {
    const r = await engine.get<Run>(`/api/helper-runs/${helperRunId}`);
    return {
      helper: r.helper,
      status: r.status,
      ranOn: dubaiDay(r.at),
      model: r.model,
      confidence: r.confidence,
      attempts: r.attempt,
      // Helper output may quote what it read (comments, extracted document fields): data only.
      data: untrustedDeep(r.output?.data ?? null),
      reasons: (r.output?.reasons ?? []).map((x) => untrustedDeep(x) as string),
    };
  },
};
