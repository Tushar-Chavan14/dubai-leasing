import { z } from "zod";
import { COMPLIANCE, DealIdInput, SALES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Output = z.object({
  plan: z.array(
    z.object({
      seq: z.number().int(),
      label: z.string(),
      dueOn: z.string().nullable(),
      milestone: z.string().nullable(),
      amountFils: z.number().int(),
    }),
  ),
  payments: z.array(
    z.object({
      seq: z.number().int().nullable(),
      status: z.string(),
      amountFils: z.number().int().nullable(),
      paidOn: z.string().nullable(),
      intoEscrow: z.boolean().nullable(),
      note: z.string().nullable(),
    }),
  ),
});
const RawDeal = z.object({
  sections: z
    .object({
      payment_plan: z
        .array(
          z.object({
            seq: z.number().int(),
            label: z.string(),
            dueOn: z.string().nullable().optional(),
            milestone: z.string().nullable().optional(),
            amountFils: z.number().int(),
          }),
        )
        .optional(),
    })
    .partial(),
});
const RawPayments = z.array(
  z.object({
    seq: z.number().int().nullable().optional(),
    status: z.string(),
    amountFils: z.number().int().nullable().optional(),
    paidOn: z.string().nullable().optional(),
    intoEscrow: z.boolean().nullable().optional(),
    note: z.string().nullable().optional(),
  }),
);

export const getPaymentPlan: CopilotTool<typeof DealIdInput, typeof Output> = {
  name: "get_payment_plan",
  description:
    "A deal's instalment plan (label, due date, milestone, amount) and the payments recorded against it. Amounts are in fils; quote them only as returned.",
  kind: "read",
  roles: [...SALES, "finance", ...COMPLIANCE],
  input: DealIdInput,
  output: Output,
  async run(client, a) {
    const deal = RawDeal.parse(await client.get(`/api/deals/${a.dealId}`));
    const paid = RawPayments.parse(await client.get(`/api/deals/${a.dealId}/payments`));
    return Output.parse({
      plan: (deal.sections.payment_plan ?? []).map((p) => ({
        seq: p.seq,
        label: p.label,
        dueOn: p.dueOn ?? null,
        milestone: p.milestone ?? null,
        amountFils: p.amountFils,
      })),
      payments: paid.map((p) => ({
        seq: p.seq ?? null,
        status: p.status,
        amountFils: p.amountFils ?? null,
        paidOn: p.paidOn ?? null,
        intoEscrow: p.intoEscrow ?? null,
        note: p.note ?? null,
      })),
    });
  },
};
