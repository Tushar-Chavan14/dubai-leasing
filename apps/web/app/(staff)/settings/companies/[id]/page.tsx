import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AskAiMenu } from "../../../../../components/ask-ai";
import { Banner } from "../../../../../components/ui/form";
import { SetPage } from "../../../../../components/ui/settings";
import { askPrompts } from "../../../../../lib/ask-ai/prompts";
import { get } from "../../../../../lib/engine";
import type { CompanyLegalView, Me } from "../../../../../lib/types";
import { EditLegalForm } from "./edit-form";

export const metadata: Metadata = { title: "Company legal details" };

export default async function CompanyLegalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [view, me] = await Promise.all([get<CompanyLegalView>(`/api/companies/${id}/legal`), get<Me>("/api/me")]);
  if (!view) notFound();
  return (
    <SetPage
      back={{ href: "/settings/companies", label: "Companies" }}
      title={view.companyName}
      lede="Legal (landlord) details and the authorised signatory. A contract can't be prepared until they are complete."
      actions={<AskAiMenu label="Ask AI" prompts={askPrompts.settingsPage(`${view.companyName} legal details`)} />}
      max="max-w-[860px]"
    >
      {view.missing.length > 0 && (
        <Banner tone="warn" role="status">
          Missing or out of date: {view.missing.join(", ")}.
        </Banner>
      )}
      <EditLegalForm id={id} legal={view.legal} canEdit={me?.role === "admin"} />
    </SetPage>
  );
}
