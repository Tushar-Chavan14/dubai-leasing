import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Banner } from "@platform/ui/form";
import { SetPage } from "@platform/ui/settings";
import { get } from "../../../../../lib/engine";
import type { CompanyLegalView, CompanyRow, Me } from "../../../../../lib/types";
import { EditCategoriesForm, EditEmiratesForm, EditLegalForm } from "./edit-form";

export const metadata: Metadata = { title: "Company legal details" };

export default async function CompanyLegalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [view, me, companies] = await Promise.all([
    get<CompanyLegalView>(`/api/companies/${id}/legal`),
    get<Me>("/api/me"),
    get<CompanyRow[]>("/api/companies"),
  ]);
  if (!view) notFound();
  const company = companies?.find((c) => c.id === id);
  return (
    <SetPage
      back={[
        { href: "/settings", label: "Settings" },
        { href: "/settings/companies", label: "Companies" },
      ]}
      title={view.companyName}
      lede="Legal (landlord) details and the authorised signatory. A contract can't be prepared until they are complete."
      max="max-w-[860px]"
    >
      {view.missing.length > 0 && (
        <Banner tone="warn" role="status">
          Missing or out of date: {view.missing.join(", ")}.
        </Banner>
      )}
      {company && <EditEmiratesForm id={id} emirates={company.emirates} canEdit={me?.role === "admin"} />}
      {company && <EditCategoriesForm id={id} categories={company.categories} canEdit={me?.role === "admin"} />}
      <EditLegalForm id={id} legal={view.legal} canEdit={me?.role === "admin"} />
    </SetPage>
  );
}
