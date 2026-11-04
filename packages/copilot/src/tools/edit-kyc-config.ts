import { KycOp } from "@leasing/core";
import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  company: z.string().min(2).max(120).describe("Company name or slug"),
  ops: z
    .array(KycOp)
    .min(1)
    .max(20)
    .describe(
      'Edits in order. Name a field by its label, key or category ("passport"); "across documents" for required_documents, names_consistent, applicant_name. Checks: expired, valid_long_enough, issued_recently, readable, right_document, id_number, birth_year, mrz, mrz_matches_page, visa_number, passport_matches, name_matches. Add {"op":"publish"} only when the user asks to publish.',
    ),
});

/** Edits a company's document form and KYC checks (D50): into its draft, directly when the user asked, else a suggestion. */
export const editKycConfig: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "edit_kyc_config",
  kind: "propose",
  description:
    "Change a company's applicant document form and KYC checks: set a check to off, warning or blocker (and whether a blocker emails the applicant), change validity days, read confidence or the issue-date window, add, change or remove document and question fields (including custom documents the AI reads), add, change or remove custom checks, and publish the draft. Changes go to the draft. Use mode explicit only when the user's own latest message asks for this change, with their words as userQuote; otherwise mode suggest.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, company, ops }, ctx) {
    return runConfigChange(ctx, { mode, userQuote }, { kind: "kyc_config", company, ops });
  },
};
