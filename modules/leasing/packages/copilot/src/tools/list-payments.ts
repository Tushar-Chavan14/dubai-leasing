import { z } from "zod";
import { resolveLeaseId } from "../resolve.ts";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { aed, LeaseArg, Money } from "./shared.ts";

const Input = z.object({ lease: LeaseArg });
const Output = z.object({
  leaseId: z.string(),
  instalments: z.array(
    z.object({
      paymentId: z.string(),
      instalment: z.number(),
      dueOn: z.string(),
      amount: Money,
      status: z.string(),
      paidOn: z.string().nullable(),
      bouncedOn: z.string().nullable(),
      friendlyReminders: z.number(),
      formalReminderSentOn: z.string().nullable(),
      /** Formal reminder date + the rulebook's days (the lease's pinned version); computed by the engine. */
      waitingPeriodEndsOn: z.string().nullable(),
    }),
  ),
});

interface Row {
  id: string;
  seq: number;
  dueOn: string;
  amountFils: number;
  status: string;
  paidOn: string | null;
  bouncedOn: string | null;
  friendlyCount: number;
  formalReminderSentOn: string | null;
  evictionEligibleOn: string | null;
}

export const listPayments: CopilotTool<typeof Input, typeof Output> = {
  name: "list_payments",
  kind: "read",
  description:
    "A lease's rent instalments: due date, amount, status (scheduled, paid, overdue, bounced), reminders sent, and the formal reminder date and the end of the waiting period after it. Use it for rent and collections questions.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  async run({ lease }, { engine }) {
    const leaseId = await resolveLeaseId(engine, lease);
    const rows = await engine.get<Row[]>(`/api/leases/${leaseId}/payments`);
    return {
      leaseId,
      instalments: rows.map((r) => ({
        paymentId: r.id,
        instalment: r.seq,
        dueOn: r.dueOn,
        amount: aed(r.amountFils),
        status: r.status,
        paidOn: r.paidOn,
        bouncedOn: r.bouncedOn,
        friendlyReminders: r.friendlyCount,
        formalReminderSentOn: r.formalReminderSentOn,
        waitingPeriodEndsOn: r.evictionEligibleOn,
      })),
    };
  },
};
