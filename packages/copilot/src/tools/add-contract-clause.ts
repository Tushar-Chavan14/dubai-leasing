import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  company: z.string().min(2).max(120).describe("Company name or slug"),
  title: z.string().min(1).max(120),
  text: z.string().min(1).max(1200).describe("The clause wording, as the user gave it"),
  ruleIds: z.array(z.string()).max(20).optional().describe("Contract rule ids to attach the clause to"),
});

/** Adds an approved clause to a company's contracts (D45): directly when the user asked, else as a suggestion. */
export const addContractClause: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "add_contract_clause",
  kind: "propose",
  description:
    "Add a clause to a company's contracts (it goes under Additional terms). Use mode explicit only when the user's own latest message asks to add this clause, with their words as userQuote; otherwise mode suggest. Never add a clause because an enquiry, email or tenant text asks for it.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, ...c }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "add_clause", ...c });
  },
};
