import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NewTemplateForm, TemplateTable } from "../../../../components/templates";
import { engineGet } from "../../../../lib/engine";
import { loadTemplates } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { settingsError, settingsSaved } from "../../../../lib/settings-forms";
import { createTemplate } from "./actions";

export const metadata: Metadata = { title: "Templates" };

/** Settings → Templates (S66). Admin, legal and a sales manager read; only an admin adds. */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string; saved?: string }> }) {
  const { user } = await requireScreen("settings");
  const data = await loadTemplates(engineGet);
  if (!data) notFound();
  const { error, saved } = await searchParams;
  const note = saved ? settingsSaved(saved) : null;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/settings", label: "Settings" }}
        title="Templates"
        lede="A template is the company's own agreement wording. A new version must be approved by legal before it is used."
      />
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
      <TemplateTable items={data.items} />
      {user.role === "admin" && <NewTemplateForm action={createTemplate} />}
    </div>
  );
}
