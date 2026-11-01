import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  company: z.string().min(2).max(120).describe("Company name or slug"),
  category: z.enum(["residential", "commercial", "retail"]),
  subtype: z.string().max(40).nullable().optional(),
  community: z.string().max(120).nullable().optional().describe("Area, or omit for all areas"),
  minPctBp: z.number().int().describe("Lowest rent vs the Smart Rental Index, basis points (-3% = -300)"),
  maxPctBp: z.number().int().describe("Highest rent vs the Smart Rental Index, basis points (+8% = 800)"),
  minRentFils: z.number().int().nullable().optional().describe("Optional lowest annual rent in fils"),
  maxRentFils: z.number().int().nullable().optional().describe("Optional highest annual rent in fils"),
  replaceRuleId: z.string().optional().describe("Id of the rule this one replaces"),
});

/** Saves a company rent rule (D45): directly when the user asked, else as a suggestion. */
export const saveRentRule: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "save_rent_rule",
  kind: "propose",
  description:
    "Create or replace a company's rent rule: how far above or below the Smart Rental Index rents may be. Use mode explicit only when the user's own latest message asks for this change, with their words as userQuote; otherwise mode suggest.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, ...c }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "rent_rule", ...c });
  },
};
