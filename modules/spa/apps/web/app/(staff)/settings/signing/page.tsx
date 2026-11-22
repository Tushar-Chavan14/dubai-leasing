import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notices, SigningForm } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadSigning } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { saveSigning } from "./actions";

export const metadata: Metadata = { title: "Signing" };

/** Settings → Signing (S72): how long a signing link lasts and who signs first. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  const data = await loadSigning(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage title="Signing" lede="How long a signing link lasts, and who signs first for each kind of deal.">
      <Notices error={error} saved={saved} savedText={`Saved, version ${data.version}`} />
      <SigningForm data={data} canEdit={user.role === "admin"} action={saveSigning} />
    </SetPage>
  );
}
