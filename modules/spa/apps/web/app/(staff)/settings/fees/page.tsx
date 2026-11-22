import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FeesView } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadRulebook } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Fees and rulebook" };

/** Settings → Fees and rulebook (S72): read-only. The values come from the published rulebook; there is no form. */
export default async function Page() {
  await requireScreen("settings");
  const data = await loadRulebook(engineGet);
  if (!data) notFound();
  return (
    <SetPage
      title="Fees and rulebook"
      lede="The fees and rules in force. A value that legal has not confirmed shows as Pending."
    >
      <FeesView data={data} />
    </SetPage>
  );
}
