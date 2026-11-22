import { z } from "zod";
import { DEAL_ROLES } from "./common.ts";
import type { CopilotTool } from "./types.ts";

/** The rulebook keys a person may ask about. The AML keys are listed for the compliance roles only (the route checks too). */
export const RULEBOOK_KEYS = [
  "registrationFeeBps",
  "registrationFeePayer",
  "oqoodAdminFeeFils",
  "oqoodTransferFeeFils",
  "trusteeFeeFils",
  "mortgageRegistrationBps",
  "mortgageRegistrationAdminFils",
  "minBookingBps",
  "beneficialOwnerBps",
] as const;

const Input = z.object({ key: z.enum(RULEBOOK_KEYS), dealId: z.uuid().optional() });
const Output = z.object({
  key: z.string(),
  rulesVersion: z.string(),
  status: z.enum(["confirmed", "pending confirmation"]),
  bps: z.number().int().optional(),
  percent: z.number().optional(),
  amountFils: z.number().int().optional(),
  value: z.string().optional(),
});

export const getRulebookValue: CopilotTool<typeof Input, typeof Output> = {
  name: "get_rulebook_value",
  description:
    "A legal or money value from the published sales rulebook (the registration fee rate, the minimum booking share, Oqood and trustee fees), with the rulebook version it comes from. A value not yet confirmed by legal says 'pending confirmation'. Every fee or rate you state must come from this tool.",
  kind: "read",
  roles: [...DEAL_ROLES, "admin"],
  input: Input,
  output: Output,
  async run(client, a) {
    const path = `/api/copilot/rulebook?key=${a.key}${a.dealId ? `&dealId=${a.dealId}` : ""}`;
    return Output.parse(await client.get(path));
  },
};
