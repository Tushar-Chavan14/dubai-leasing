import { ALERT } from "@platform/ui/settings";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { AlertList } from "../../../components/alert-list";
import { engineGet } from "../../../lib/engine";
import { loadAlerts } from "../../../lib/loaders";
import { me } from "../../../lib/session";
import { markAlertRead } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

/** The signed-in user's alerts (C23, S62). Every role has this page; it lists only the user's own. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await me();
  const data = await loadAlerts(engineGet);
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Alerts"
        lede="Things that have waited for you longer than they should. Open the deal to act; marking an alert read only hides it from your count."
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          That alert couldn&apos;t be marked read. Try again.
        </p>
      )}
      <AlertList items={data?.items ?? []} markAction={markAlertRead} />
    </div>
  );
}
