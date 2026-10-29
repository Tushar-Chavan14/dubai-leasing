import { z } from "zod";
import { resolveApplication, resolveLeaseId } from "../resolve.ts";
import type { CopilotTool } from "../types.ts";
import { LeaseArg } from "./shared.ts";

const Input = z
  .object({
    lease: LeaseArg.optional().describe("To the tenant of this lease: id, reference, unit code or tenant name"),
    application: z
      .string()
      .min(2)
      .max(80)
      .optional()
      .describe("To the applicant of this application: reference (A-7KQ2MX), unit code or applicant name"),
    subject: z.string().min(3).max(160),
    body: z.string().min(10).max(5000).describe("The email body, without greeting or sign-off"),
  })
  .refine((v) => Boolean(v.lease) !== Boolean(v.application), "give a lease or an application, not both");
const Output = z.object({
  draftId: z.string(),
  to: z.enum(["tenant", "applicant"]),
  /** Where the user opens the email form, a path in the staff app. */
  href: z.string(),
  next: z.string(),
});

/**
 * Drafts an email to a tenant (lease) or an applicant (application) (D26, D42). Saved only: the user
 * opens it in the email form on that record and sends it.
 */
export const draftEmail: CopilotTool<typeof Input, typeof Output> = {
  name: "draft_email",
  kind: "draft",
  description:
    "Draft an email when the user asks for one: to a lease's tenant (lease) or to an application's applicant (application, for example a viewing reminder or a document chase). It is only saved: the user reviews it, edits it and sends it from the record's email form. Never promise money, dates or legal outcomes in it, and never say it was sent.",
  input: Input,
  output: Output,
  roles: ["leasing_officer", "leasing_manager", "finance"],
  async run({ lease, application, subject, body }, { engine }) {
    if (application) {
      const app = await resolveApplication(engine, application);
      const d = await engine.propose<{ id: string }>("/api/copilot/drafts", {
        kind: "email",
        applicationId: app.id,
        subject,
        body,
      });
      const href = `/work?kind=application&id=${app.id}&draft=${d.id}#email`;
      return {
        draftId: d.id,
        to: "applicant" as const,
        href,
        next: `Saved as a draft to the applicant of ${app.ref}. The user reviews and sends it from the Email the applicant form on the application record in the Workspace (${href}). Nothing was sent.`,
      };
    }
    const leaseId = await resolveLeaseId(engine, lease!);
    const d = await engine.propose<{ id: string }>("/api/copilot/drafts", { kind: "email", leaseId, subject, body });
    const href = `/work?kind=lease&id=${leaseId}&draft=${d.id}#email`;
    return {
      draftId: d.id,
      to: "tenant" as const,
      href,
      next: `Saved as a draft for the user to review and send from the lease page (${href}). Nothing was sent.`,
    };
  },
};
