import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { TemplateRecordView } from "../../../../../components/templates";
import { engineGet } from "../../../../../lib/engine";
import { loadTemplate } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";
import { settingsError, settingsSaved } from "../../../../../lib/settings-forms";
import { uploadSample } from "../actions";

export const metadata: Metadata = { title: "Template" };

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { user } = await requireScreen("settings");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const t = await loadTemplate(engineGet, id.data);
  if (!t) notFound();
  const { error, saved } = await searchParams;
  const note = saved ? settingsSaved(saved) : null;
  return (
    <div className="grid gap-6">
      <PageTitle back={{ href: "/settings/templates", label: "Templates" }} title={t.name} />
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
      <TemplateRecordView t={t} canWrite={user.role === "admin"} upload={uploadSample} />
    </div>
  );
}
