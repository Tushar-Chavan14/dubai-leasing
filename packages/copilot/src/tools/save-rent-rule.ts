import { Emirate } from "@leasing/core";
import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  company: z.string().min(2).max(120).describe("Company name or slug"),
  category: z.enum(["residential", "commercial", "retail"]),
  subtype: z.string().max(40).nullable().optional(),
  emirate: Emirate.optional().describe("Emirate the rule applies to; omit for Dubai"),
  community: z.string().max(120).nullable().optional().describe("Area, or omit for all areas"),
  minPctBp: z.number().int().describe("Lowest rent vs the Smart Rental Index, basis points (-3% = -300)"),
  maxPctBp: z.number().int().describe("Highest rent vs the Smart Rental Index, basis points (+8% = 800)"),
  minRentFils: z.number().int().nullable().optional().describe("Optional lowest annual rent in fils"),
  maxRentFils: z.number().int().nullable().optional().describe("Optional highest annual rent in fils"),
  maxOfferDiscountPct: z
    .number()
    .int()
    .min(0)
    .max(50)
    .nullable()
    .optional()
    .describe(
      "Whole percent an offer or counter on units of this rule may go below the asking rent without a manager (0 = none); null or omitted = the company default",
    ),
  replaceRuleId: z.string().optional().describe("Id of the rule this one replaces"),
});

/** Saves a company rent rule (D45): directly when the user asked, else as a suggestion. */
export const saveRentRule: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "save_rent_rule",
  kind: "propose",
  description:
    "Create or replace a company's rent rule (for one emirate; Dubai when emirate is omitted): how far above or below the Smart Rental Index rents may be, and how far below the asking rent an offer or a tenant's counter may go without a manager (maxOfferDiscountPct). When replacing a rule, copy its other values from get_company_settings. Use mode explicit only when the user's own latest message asks for this change, with their words as userQuote; otherwise mode suggest.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, ...c }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "rent_rule", ...c });
  },
};
