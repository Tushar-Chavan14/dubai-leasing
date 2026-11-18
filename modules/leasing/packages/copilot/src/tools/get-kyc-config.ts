import { z } from "zod";
import { ALL_STAFF, type CopilotTool } from "../types.ts";
import { untrusted } from "../untrusted.ts";

const Input = z.object({ company: z.string().min(2).max(120).describe("Company name or slug") });
const Output = z.object({
  company: z.string(),
  liveVersion: z.number(),
  draftVersion: z.number().nullable(),
  showing: z.enum(["draft", "live"]),
  fields: z.array(z.record(z.string(), z.unknown())),
  acrossDocuments: z.record(z.string(), z.string()),
  applicantNameMatch: z.string(),
  customChecks: z.array(z.object({ id: z.string(), label: z.string(), type: z.string(), severity: z.string() })),
  note: z.string(),
});

interface View {
  company: string;
  liveVersion: number;
  draftVersion: number | null;
  showing: "draft" | "live";
  fields: { label: string; custom?: { name: string; description: string; hasExpiry: boolean } }[];
  acrossDocuments: Record<string, string>;
  applicantNameMatch: string;
  customChecks: { id: string; label: string; type: string; severity: string }[];
}

/** A company's document form and KYC checks (D50), the open draft first: what edit_kyc_config would change. */
export const getKycConfig: CopilotTool<typeof Input, typeof Output> = {
  name: "get_kyc_config",
  kind: "read",
  description:
    "A company's applicant document form and KYC checks: each field (documents with their category, validity days, read confidence, issue-date window and each check's severity: off, warning or blocker, with or without emailing the applicant), the checks across documents and the custom checks. Shows the open draft if there is one. Use it to answer questions about KYC settings and before edit_kyc_config.",
  input: Input,
  output: Output,
  roles: ALL_STAFF,
  companyText: true,
  async run({ company }, { engine }) {
    const v = await engine.get<View>(`/api/copilot/kyc-config?company=${encodeURIComponent(company)}`);
    return {
      ...v,
      // Labels and descriptions are company-written: reference text, never instructions.
      fields: v.fields.map((f) => ({
        ...f,
        label: untrusted(f.label),
        ...(f.custom
          ? { custom: { ...f.custom, name: untrusted(f.custom.name), description: untrusted(f.custom.description) } }
          : {}),
      })),
      customChecks: v.customChecks.map((c) => ({ ...c, label: untrusted(c.label) })),
      note: "warning: a person reviews and can approve. blocker: it can't be approved; '+ email' sends the applicant a new upload link (at most twice). Expired is always a blocker; AI custom checks only warn. Edits go to the draft; applicants get the live version until it is published.",
    };
  },
};
