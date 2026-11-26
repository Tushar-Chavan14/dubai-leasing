import { ALERT, SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { HelperSettingsView } from "../../../../components/helper-settings";
import { engineGet } from "../../../../lib/engine";
import { loadHelperSettings } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { setHelperMode } from "./actions";

export const metadata: Metadata = { title: "AI helpers" };

export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireScreen("settings");
  const data = await loadHelperSettings(engineGet);
  // The engine answers 403 to every role but an admin and a sales manager: the page is not there for them.
  if (!data) notFound();
  const { error } = await searchParams;
  return (
    <SetPage title="AI helpers" lede="How each helper runs: on its own, with a person looking first, or not at all.">
      {error && (
        <p role="alert" className={ALERT.bad}>
          That change wasn&apos;t saved. Check you are an admin and try again.
        </p>
      )}
      <HelperSettingsView data={data} action={setHelperMode} />
    </SetPage>
  );
}
