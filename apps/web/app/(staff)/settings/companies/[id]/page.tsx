import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageHead } from "../../../../../components/ui";
import { get } from "../../../../../lib/engine";
import type { CompanyLegalView, Me } from "../../../../../lib/types";
import { EditLegalForm } from "./edit-form";

export const metadata: Metadata = { title: "Company legal details" };

export default async function CompanyLegalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [view, me] = await Promise.all([get<CompanyLegalView>(`/api/companies/${id}/legal`), get<Me>("/api/me")]);
  if (!view) notFound();
  return (
    <>
      <PageHead
        back={{ href: "/settings/companies", label: "Companies" }}
        title={view.companyName}
        lede="Legal (landlord) details and the authorised signatory. A contract can't be prepared until they are complete."
      />
      {view.missing.length > 0 && (
        <div className="alert" data-tone="warn" role="status">
          Missing or out of date: {view.missing.join(", ")}.
        </div>
      )}
      <EditLegalForm id={id} legal={view.legal} canEdit={me?.role === "admin"} />
    </>
  );
}
