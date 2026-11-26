import { SetPage, ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AlertSettingsForm } from "../../../../components/alert-settings";
import { engineGet } from "../../../../lib/engine";
import { loadAlertSettings } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { settingsError, settingsSaved } from "../../../../lib/settings-forms";
import { saveAlertSettings } from "./actions";

export const metadata: Metadata = { title: "Alerts" };

/** Settings → Alerts (S62, S66). An admin sets the hours; the engine refuses every other role on the write. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  // Only an admin has this page: the engine also answers a sales manager's read with 403, and legal's.
  if (user.role !== "admin") notFound();
  const data = await loadAlertSettings(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  const note = saved ? settingsSaved(saved) : null;
  return (
    <SetPage
      title="Alerts"
      lede="How many hours a waiting approval may sit before its approver is alerted, then the manager."
    >
      {error && (
        <p role="alert" className={ALERT.bad}>
          {settingsError(error)}
        </p>
      )}
      {note && !error && (
        <p role="status" className={ALERT.good}>
          {note}
        </p>
      )}
      <AlertSettingsForm items={data.items} canEdit action={saveAlertSettings} />
    </SetPage>
  );
}
