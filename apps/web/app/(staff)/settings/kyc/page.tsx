import type { Metadata } from "next";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { AskAiMenu } from "../../../../components/ask-ai";
import { PageHead } from "../../../../components/ui";
import { possessive } from "../../../../lib/format";
import { get } from "../../../../lib/engine";
import type { CompanyRow, Me } from "../../../../lib/types";
import { type KycConfigView, KycEditor } from "./kyc-editor";

export const metadata: Metadata = { title: "Documents & KYC" };

export default async function KycSettingsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const [companies, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  const company = pickCompany(companies ?? [], sp.company);
  const config = company
    ? await get<KycConfigView & { draft: (KycConfigView & { updatedBy: string }) | null }>(
        `/api/companies/${company.id}/kyc-config`,
      )
    : null;
  // The editor works on the open draft when there is one (D50), else on a copy of the live version.
  const editing = config?.draft ?? config;
  const isAdmin = me?.role === "admin";
  return (
    <>
      <PageHead
        title="Documents & KYC"
        lede="What applicants fill in and upload on their document link, and the checks each document must pass. A warning sends the application to a person; a blocker can't be approved and can email the applicant a new upload link. Nothing rejects an applicant automatically."
      />
      <CompanySplit companies={companies ?? []} selected={company} base="/settings/kyc" countLabel="fields">
        {company && config && (
          <>
            <div className="co-body-head">
              <h2 className="section-title">{company.name}</h2>
              <span className="muted">
                {config.draft
                  ? `Draft v${config.draft.version} · ${config.version === 0 ? "starter form live" : `v${config.version} live`}`
                  : config.version === 0
                    ? "Starter form (not saved yet)"
                    : `Version ${config.version} live`}
              </span>
              {isAdmin && (
                <AskAiMenu
                  label="Ask AI"
                  prompts={[
                    {
                      label: "What does this company check?",
                      prompt: `What KYC checks does ${company.name} run on each document?`,
                    },
                    {
                      label: "Change how long a document must be valid",
                      prompt: `For ${company.name}: the passport must be valid this many days after the lease starts: `,
                    },
                    {
                      label: "Make a check a blocker",
                      prompt: `For ${company.name}: make the passport "Read clearly?" check a blocker and email the applicant`,
                    },
                    {
                      label: "Add a custom document",
                      prompt: `For ${company.name}: add a required custom document "Salary certificate", described as a letter from the employer stating the monthly salary`,
                    },
                    { label: "Add a question", prompt: `For ${company.name}: add a required question "Employer name"` },
                    {
                      label: "Add a minimum age check",
                      prompt: `For ${company.name}: add a custom check that applicants must be at least 21 years old, as a blocker`,
                    },
                    { label: "Publish the draft", prompt: `Publish ${possessive(company.name)} KYC draft` },
                  ]}
                />
              )}
            </div>
            <KycEditor
              key={`${company.id}:${config.version}:${config.draft?.version ?? "live"}:${config.draft?.updatedBy ?? ""}`}
              companyId={company.id}
              initial={editing!}
              canEdit={isAdmin}
              hasDraft={!!config.draft}
              companyName={company.name}
            />
          </>
        )}
        {!isAdmin && <p className="muted settings-note">Only admins can change the form and rules.</p>}
      </CompanySplit>
    </>
  );
}
