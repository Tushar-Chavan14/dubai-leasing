import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TemplateVersionPage } from "../../../../../../components/templates";
import { engineGet } from "../../../../../../lib/engine";
import { loadTemplateVersion } from "../../../../../../lib/loaders";
import { requireScreen } from "../../../../../../lib/session";
import { settingsError, settingsSaved } from "../../../../../../lib/settings-forms";
import { remapBlank } from "../../actions";

export const metadata: Metadata = { title: "Template version" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { user } = await requireScreen("settings");
  const id = z.uuid().safeParse((await params).versionId);
  if (!id.success) notFound();
  const v = await loadTemplateVersion(engineGet, id.data);
  if (!v) notFound();
  const { error, saved } = await searchParams;
  const note = saved ? settingsSaved(saved) : null;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: `/settings/templates/${v.templateId}`, label: v.templateName }}
        title={`${v.templateName}, version ${v.version}`}
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
      <TemplateVersionPage v={v} viewer={user.role} remap={remapBlank} />
    </div>
  );
}
