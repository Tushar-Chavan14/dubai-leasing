import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Notices, PlansForm } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadPlans } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { savePlans } from "./actions";

export const metadata: Metadata = { title: "Plans" };

/** Settings → Plans (S72): discount, deposit, hold and offer days, commission and instalment reminders. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  const data = await loadPlans(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage
      title="Plans"
      lede="The company's own choices for prices, deposits and reminders. Legal fees are on the Fees page."
    >
      <Notices error={error} saved={saved} savedText={`Saved, version ${data.version}`} />
      <PlansForm data={data} canEdit={user.role === "admin"} action={savePlans} />
    </SetPage>
  );
}
