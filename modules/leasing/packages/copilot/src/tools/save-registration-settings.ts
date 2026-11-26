import { Emirate, RequiredDocument } from "@leasing/core";
import { z } from "zod";
import type { CopilotTool } from "../types.ts";
import { ConfigChangeOutput, ModeArgs, runConfigChange } from "./config-change.ts";

const Input = z.object({
  ...ModeArgs,
  emirate: Emirate,
  registrationMode: z
    .enum(["online", "manual"])
    .optional()
    .describe("online only where the engine has a registry connection"),
  portalName: z.string().min(1).max(120).optional(),
  portalUrl: z.string().max(500).nullable().optional().describe("https address of the portal"),
  instructions: z
    .string()
    .max(2000)
    .optional()
    .describe("Plain-text steps for the officer, exactly as the user gave them"),
  requiredDocuments: z
    .array(RequiredDocument)
    .min(1)
    .max(40)
    .optional()
    .describe(
      "The whole checklist, as keys from get_emirate_setup documentOptions (kyc:passport, kyc:other:<field>, answer:<field>, title_deed, …). Keep the current items the user didn't ask to remove.",
    ),
  referenceExample: z.string().max(60).optional(),
  referencePattern: z.string().max(200).optional().describe("Anchored regular expression ^...$"),
});

/** "uaq.gov.ae" → "https://uaq.gov.ae": the scheme is added in code, never left to the model. */
export function withHttps(url: string | null): string | null {
  if (url === null) return null;
  const v = url.trim();
  return v === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(v) ? v : `https://${v}`;
}

/** Changes an emirate's registration settings (D45): directly when the user asked, else as a suggestion. */
export const saveRegistrationSettings: CopilotTool<typeof Input, typeof ConfigChangeOutput> = {
  name: "save_registration_settings",
  kind: "propose",
  description:
    "Change an emirate's registration settings: online or by hand, portal name and address, instructions, required documents, reference example and pattern. Pass only the fields to change; the rest stay. Copy values as the user wrote them; a portal address must start with https://, so add it if the user left it out (the user still counts as having said it). Saved settings take effect at once: there is no draft and nothing to publish. Use mode explicit only when the user's own latest message asks for this change and gives the values, with their words as userQuote; otherwise mode suggest.",
  input: Input,
  output: ConfigChangeOutput,
  roles: ["admin"],
  async run({ mode, userQuote, registrationMode, portalUrl, ...c }, ctx) {
    return runConfigChange(
      ctx,
      { mode, userQuote },
      {
        kind: "registration_settings",
        ...c,
        ...(portalUrl !== undefined ? { portalUrl: withHttps(portalUrl) } : {}),
        ...(registrationMode ? { mode: registrationMode } : {}),
      },
    );
  },
};
