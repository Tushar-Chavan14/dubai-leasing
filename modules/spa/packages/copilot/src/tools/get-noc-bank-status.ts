import { z } from "zod";
import { DealIdInput, RECORD_ROLES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

const Output = z.object({
  noc: z
    .object({
      status: z.string(),
      issuedOn: z.string(),
      expiresOn: z.string(),
      serviceChargesCleared: z.boolean(),
      paidFils: z.number().int().nullable(),
      paidConfirmed: z.boolean(),
      mismatches: z.array(z.string()),
    })
    .nullable(),
  bankLetters: z.array(
    z.object({
      side: z.string(),
      kind: z.string(),
      issuedOn: z.string(),
      validUntil: z.string().nullable(),
      amountFils: z.number().int().nullable(),
      confirmed: z.boolean(),
    }),
  ),
});

export const getNocBankStatus: CopilotTool<typeof DealIdInput, typeof Output> = {
  name: "get_noc_bank_status",
  description:
    "A resale deal's developer NOC (issued, expires, service charges, amount paid and whether a person confirmed it) and its bank letters (kind, dates, confirmed amount). Never shows a document.",
  kind: "read",
  roles: RECORD_ROLES,
  input: DealIdInput,
  output: Output,
  async run(client, a) {
    return Output.parse(await client.get(`/api/deals/${a.dealId}/noc-status`));
  },
};
