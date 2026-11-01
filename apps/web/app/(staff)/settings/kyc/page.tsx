import type { Metadata } from "next";
import { CompanySplit, pickCompany } from "../../../../components/company-split";
import { PageHead } from "../../../../components/ui";
import { get } from "../../../../lib/engine";
import type { CompanyRow, Me } from "../../../../lib/types";
import { type KycConfigView, KycEditor } from "./kyc-editor";

export const metadata: Metadata = { title: "Documents & KYC" };

export default async function KycSettingsPage({ searchParams }: { searchParams: Promise<{ company?: string }> }) {
  const sp = await searchParams;
  const [companies, me] = await Promise.all([get<CompanyRow[]>("/api/companies"), get<Me>("/api/me")]);
  const company = pickCompany(companies ?? [], sp.company);
  const config = company ? await get<KycConfigView>(`/api/companies/${company.id}/kyc-config`) : null;
  const isAdmin = me?.role === "admin";
  return (
    <>
      <PageHead
        title="Documents & KYC"
        lede="What applicants fill in and upload on their document link, and the checks their documents must pass. A failed check sends the application to a person; nothing rejects an applicant automatically."
      />
      <CompanySplit companies={companies ?? []} selected={company} base="/settings/kyc" countLabel="fields">
        {company && config && (
          <>
            <div className="co-body-head">
              <h2 className="section-title">{company.name}</h2>
              <span className="muted">
                {config.version === 0 ? "Starter form (not saved yet)" : `Version ${config.version}`}
              </span>
            </div>
            <KycEditor
              key={`${company.id}:${config.version}`}
              companyId={company.id}
              initial={config}
              canEdit={isAdmin}
            />
          </>
        )}
        {!isAdmin && <p className="muted settings-note">Only admins can change the form and rules.</p>}
      </CompanySplit>
    </>
  );
}
