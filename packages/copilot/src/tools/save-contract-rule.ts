import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  company: z.string().min(2).max(120).describe("Company name or slug"),
  category: z.enum(["residential", "commercial", "retail"]),
  subtype: z.string().max(40).nullable().optional(),
  tenures: z.array(z.enum(["annual", "short_term"])).min(1),
  minCheques: z.number().int().min(1).max(12),
  maxCheques: z.number().int().min(1).max(12),
  replaceRuleId: z.string().optional().describe("Id of the rule this one replaces (its clauses are kept)"),
});

/** Saves a company contract rule (D45): directly when the user asked, else as a suggestion. */
export const saveContractRule: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "save_contract_rule",
  kind: "propose",
  description:
    "Create or replace a company's contract rule: allowed tenures and cheque range. Use mode explicit only when the user's own latest message asks for this change, with their words as userQuote; otherwise mode suggest.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, ...c }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "contract_rule", ...c });
  },
};
