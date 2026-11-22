import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import { railItems } from "@spa/core/roles";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProjectView } from "../../../../components/projects";
import { engineGet } from "../../../../lib/engine";
import { loadProject } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";
import { addBuilding, addUnit, createPriceList, publishPriceList } from "../actions";
import { errorWords, savedWords } from "../words";

export const metadata: Metadata = { title: "Project" };

/** One project (design §4.6). Read only for everyone but an admin, who gets the add forms. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const { user } = await requireScreen("inventory");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const project = await loadProject(engineGet, id.data);
  if (!project) notFound();
  const { error, saved } = await searchParams;
  const canWork = railItems(user.role, user.companyKind).some((i) => i.screen === "work");
  const note = saved ? savedWords(saved) : null;
  return (
    <div className="grid gap-6">
      <PageTitle back={{ href: "/inventory", label: "Inventory" }} title={`${project.code} · ${project.name}`} />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {errorWords(error)}
        </p>
      )}
      {note && !error && (
        <p role="status" className={ALERT.good}>
          {note}
        </p>
      )}
      <ProjectView
        project={project}
        viewer={user.role}
        canWork={canWork}
        actions={{ addBuilding, addUnit, createPriceList, publishPriceList }}
      />
    </div>
  );
}
