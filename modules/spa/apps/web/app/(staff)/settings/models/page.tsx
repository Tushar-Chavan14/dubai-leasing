import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { StatusList } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadModels } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "AI models" };

/** Settings → AI models (S72): read-only. The tags come from the engine's own setup; a model is never changed here. */
export default async function Page() {
  await requireScreen("settings");
  const data = await loadModels(engineGet);
  if (!data) notFound();
  return (
    <SetPage
      title="AI models"
      lede="Which model does which job. They run on the company's own machine and are set up by whoever runs the engine."
    >
      <StatusList items={data.items} />
    </SetPage>
  );
}
