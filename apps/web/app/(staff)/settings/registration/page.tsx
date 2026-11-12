import type { Metadata } from "next";
import { AskAiMenu } from "../../../../components/ask-ai";
import { SetPage } from "../../../../components/ui/settings";
import { askPrompts } from "../../../../lib/ask-ai/prompts";
import { get } from "../../../../lib/engine";
import type { Me } from "../../../../lib/types";
import { type DocumentOption, FeePayerForm, type RegistrationRow, RegistrationForm } from "./registration-form";

export const metadata: Metadata = { title: "Registration" };

export default async function RegistrationSettingsPage() {
  const [all, options, me, policy] = await Promise.all([
    get<Record<string, RegistrationRow>>("/api/registration-settings"),
    get<DocumentOption[]>("/api/registration-settings/document-options"),
    get<Me>("/api/me"),
    get<{ registrationFeePaidBy: "tenant" | "landlord" }>("/api/policy"),
  ]);
  const isAdmin = me?.role === "admin";
  return (
    <SetPage
      title="Registration"
      lede="How a tenancy contract is registered in each emirate: the portal, what to bring and what the reference looks like. Online registration needs a connection to the registry; without one, staff register by hand and record the result."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage("Registration")} />}
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
        />
      ))}
      {!isAdmin && <p className="m-0 text-[13px] text-muted">Only admins can change registration settings.</p>}
    </SetPage>
  );
}
