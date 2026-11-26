import { z } from "zod";
import { DealIdInput, fence, RECORD_ROLES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Output = z.object({
  deal: z.object({ ref: z.string(), state: z.string(), priceFils: z.number().int() }),
  statement: z
    .object({
      version: z.number().int(),
      status: z.string(),
      rulesVersion: z.string(),
      priceFils: z.number().int(),
      buyerPaysFils: z.number().int(),
      sellerReceivesFils: z.number().int(),
      lines: z.array(
        z.object({
          label: z.string(),
          payer: z.string(),
          payee: z.string(),
          amountFils: z.number().int(),
          source: z.string(),
        }),
      ),
    })
    .nullable(),
  reasons: z.array(z.string()),
});
const Raw = z.object({
  deal: z.object({ ref: z.string(), state: z.string(), priceFils: z.number().int() }),
  statement: z
    .object({
      version: z.number().int(),
      status: z.string(),
      rulesVersion: z.string(),
      priceFils: z.number().int(),
      buyerPaysFils: z.number().int(),
      sellerReceivesFils: z.number().int(),
      lines: z.array(
        z.object({
          label: z.string(),
          payer: z.string(),
          payee: z.string(),
          amountFils: z.number().int(),
          source: z.string(),
        }),
      ),
    })
    .nullable(),
  reasons: z.array(z.string()).optional(),
});

export const getSettlement: CopilotTool<typeof DealIdInput, typeof Output> = {
  name: "get_settlement",
  description:
    "The transfer-day statement of a resale: each line with who pays whom, the amount and where it came from, the rulebook version, its status, or why none can be built yet.",
  kind: "read",
  roles: RECORD_ROLES,
  input: DealIdInput,
  output: Output,
  async run(client, a) {
    const r = Raw.parse(await client.get(`/api/deals/${a.dealId}/settlement`));
    return Output.parse({
      deal: r.deal,
      statement: r.statement
        ? { ...r.statement, lines: r.statement.lines.map((l) => ({ ...l, label: fence(l.label) })) }
        : null,
      reasons: (r.reasons ?? []).map(fence),
    });
  },
};
