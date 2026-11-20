import type { Metadata } from "next";
import { SetPage } from "../../../../components/ui/settings";
import { get } from "../../../../lib/engine";
import { operatedEmirates } from "../../../../lib/portfolio";
import type { CompanyRow, Me } from "../../../../lib/types";
import { type DocumentOption, FeePayerForm, type RegistrationRow, RegistrationForm } from "./registration-form";

export const metadata: Metadata = { title: "Registration" };

export default async function RegistrationSettingsPage() {
  const [all, options, me, policy, companies] = await Promise.all([
    get<Record<string, RegistrationRow>>("/api/registration-settings"),
    get<DocumentOption[]>("/api/registration-settings/document-options"),
    get<Me>("/api/me"),
    get<{ registrationFeePaidBy: "tenant" | "landlord" }>("/api/policy"),
    get<CompanyRow[]>("/api/companies"),
  ]);
  const isAdmin = me?.role === "admin";
  const operated = operatedEmirates(companies);
  return (
    <SetPage
      title="Registration"
      lede="How a tenancy contract is registered in each emirate: the portal, what to bring and what the reference looks like. Online registration needs a connection to the registry; without one, staff register by hand and record the result."
    >
      <FeePayerForm
        key={policy?.registrationFeePaidBy}
        value={policy?.registrationFeePaidBy ?? "tenant"}
        canEdit={isAdmin}
      />
      {Object.entries(all ?? {}).map(([emirate, row]) => (
        <RegistrationForm
          key={`${emirate}:${JSON.stringify(row)}`}
          emirate={emirate}
          row={row}
          options={options ?? []}
          canEdit={isAdmin}
          operated={(operated as string[]).includes(emirate)}
        />
      ))}
      {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can change registration settings.</p>}
    </SetPage>
  );
}
