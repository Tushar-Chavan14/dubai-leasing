import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CompanyForm, Notices } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadCompany } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { saveCompany } from "./actions";

export const metadata: Metadata = { title: "Company and signatories" };

/** Settings → Company (S72). An admin edits the name and kind; a sales manager reads. The signatory list is read-only. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  const data = await loadCompany(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage title="Company and signatories" lede="Who the company is, and who signs for the companies it deals with.">
      <Notices error={error} saved={saved} />
      <CompanyForm data={data} canEdit={user.role === "admin"} action={saveCompany} />
    </SetPage>
  );
}
