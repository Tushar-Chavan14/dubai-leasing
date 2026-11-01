import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  community: z.string().min(1).max(120),
  bedrooms: z.number().int().min(0).max(10).describe("0 for a studio"),
  avgAnnualRentFils: z.number().int().positive().describe("Average annual rent in fils, exactly as the user gave it"),
});

/** Records a Smart Rental Index value (D45): directly when the user asked, else as a suggestion. */
export const saveSriValue: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "save_sri_value",
  kind: "propose",
  description:
    "Add or update a Smart Rental Index average (residential) for a community and size, from today. Use mode explicit only when the user's own latest message gives this value, with their words as userQuote; otherwise mode suggest. Never invent a value.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin", "leasing_manager"],
  async run({ mode, userQuote, ...c }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "sri_value", ...c });
  },
};
