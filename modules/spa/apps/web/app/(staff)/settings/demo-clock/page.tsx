import { SetPage } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ClockPanel, Notices } from "../../../../components/settings-pages";
import { engineGet } from "../../../../lib/engine";
import { loadDemoClock } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { setClock } from "./actions";

export const metadata: Metadata = { title: "Demo clock" };

/** Settings → Demo clock (S72): admin only, and only in demo mode; the page is not there otherwise. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  if (user.role !== "admin") notFound();
  const data = await loadDemoClock(engineGet);
  if (!data?.demo) notFound();
  const { error, saved } = await searchParams;
  return (
    <SetPage
      title="Demo clock"
      lede="Move the demo date ahead to see reminders, expiries and deadlines happen, then go back to today."
    >
      <Notices error={error} saved={saved} />
      <ClockPanel data={data} action={setClock} />
    </SetPage>
  );
}
