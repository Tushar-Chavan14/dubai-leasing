import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusList } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadIntegrations } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Integrations" };

/** Settings → Integrations (S72): a status for each, never an address or a key. */
export default async function Page() {
  await requireScreen("settings");
  const data = await loadIntegrations(engineGet);
  if (!data) notFound();
  return (
    <SetPage
      title="Integrations"
      lede="What the engine is connected to. Simulated means a demo stand-in, not the real service."
    >
      <StatusList items={data.items} />
    </SetPage>
  );
}
