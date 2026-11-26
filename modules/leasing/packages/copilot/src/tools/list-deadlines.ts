import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { milestoneName } from "./shared.ts";

const Input = z.object({
  daysAhead: z.number().int().min(1).max(120).default(7).describe("Window in days from today (7 = this week)"),
});
const Output = z.object({
  today: z.string(),
  deadlines: z.array(
    z.object({
      dueOn: z.string(),
      milestone: z.string(),
      overdue: z.boolean(),
      leaseId: z.string(),
      leaseRef: z.string(),
      unitCode: z.string(),
      leaseState: z.string(),
    }),
  ),
});

interface Row {
  dueOn: string;
  milestone: string;
  leaseId: string;
  leaseRef: string;
  unitCode: string;
  leaseState: string;
}

export const listDeadlines: CopilotTool<typeof Input, typeof Output> = {
  name: "list_deadlines",
  kind: "read",
  description:
    "Pending lease deadlines due within the next N days, plus any overdue, oldest first. Use it for 'what's due this week' questions.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ daysAhead }, { engine, today }) {
    const rows = await engine.get<Row[]>(`/api/deadlines?days=${daysAhead}`);
    return {
      today,
      deadlines: rows.slice(0, 25).map((r) => ({
        dueOn: r.dueOn,
        milestone: milestoneName(r.milestone),
        overdue: r.dueOn < today,
        leaseId: r.leaseId,
        leaseRef: r.leaseRef,
        unitCode: r.unitCode,
        leaseState: r.leaseState,
      })),
    };
  },
};
