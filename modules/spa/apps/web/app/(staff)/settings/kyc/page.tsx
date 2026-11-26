import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { KycIndexTable } from "../../../../components/kyc-settings";
import { engineGet } from "../../../../lib/engine";
import { loadKycIndex } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { settingsError } from "../../../../lib/settings-forms";

export const metadata: Metadata = { title: "KYC forms" };

/** Settings → KYC forms (S66): an admin edits, a sales manager reads; every other role gets the page that isn't there. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  await requireScreen("settings");
  const data = await loadKycIndex(engineGet);
  if (!data) notFound();
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/settings", label: "Settings" }}
        title="KYC forms"
        lede="What each kind of party fills in and uploads. A deal type can have its own form; without one it uses the general form."
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {settingsError(error)}
        </p>
      )}
      <KycIndexTable items={data.items} />
    </div>
  );
}
