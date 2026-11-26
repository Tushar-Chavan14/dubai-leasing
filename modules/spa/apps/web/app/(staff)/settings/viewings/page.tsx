import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notices, ViewingsForm } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadViewingSettings } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { saveViewings } from "./actions";

export const metadata: Metadata = { title: "Viewings" };

/** Settings -> Viewings (S79): the times visitors can book, in Dubai time. A manager can look; an admin changes them. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  const data = await loadViewingSettings(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage
      title="Viewings"
      lede="When visitors can book a viewing of a home, and how many enquiries one email may send."
    >
      <Notices error={error} saved={saved} savedText={`Saved, version ${data.version}`} />
      <ViewingsForm data={data} canEdit={user.role === "admin"} action={saveViewings} />
    </SetPage>
  );
}
