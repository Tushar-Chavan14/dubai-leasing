import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MediaManager } from "../../../../../../components/inventory-photos";
import { ProjectForm } from "../../../../../../components/projects";
import { engineGet } from "../../../../../../lib/engine";
import { loadProject } from "../../../../../../lib/loaders";
import { requireScreen } from "../../../../../../lib/session";
import { updateProject } from "../../../actions";
import { errorWords } from "../../../words";

export const metadata: Metadata = { title: "Edit project" };

/** Edit a project's details and photos (admin only). */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { user } = await requireScreen("inventory");
  if (user.role !== "admin") notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const project = await loadProject(engineGet, id.data);
  if (!project) notFound();
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/inventory", label: "Inventory" },
          { href: "/inventory?tab=projects", label: "Projects" },
          { href: `/inventory/projects/${project.id}`, label: project.name },
        ]}
        title={`Edit ${project.name}`}
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {errorWords(error)}
        </p>
      )}
      <section className="grid max-w-[980px] gap-3 rounded-2xl border border-line bg-page p-5">
        <h2 className="m-0 text-[15px] font-semibold tracking-tight">Photos</h2>
        <p className="m-0 text-[13px] text-muted">
          The first photo is the cover. Changes here are saved straight away.
        </p>
        <MediaManager kind="project" ownerId={project.id} photos={project.media} />
      </section>
      <ProjectForm action={updateProject} project={project} />
    </div>
  );
}
