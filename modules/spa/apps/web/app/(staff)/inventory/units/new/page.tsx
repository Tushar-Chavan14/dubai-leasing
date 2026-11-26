import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { UnitForm } from "../../../../../components/unit-form";
import { engineGet } from "../../../../../lib/engine";
import { loadProject, loadProjects } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";

export const metadata: Metadata = { title: "New unit" };

/** Add a unit to a building of a project (admin only; anyone else finds no such page). */
export default async function Page({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { user } = await requireScreen("inventory");
  if (user.role !== "admin") notFound();
  const { project } = await searchParams;
  const list = await loadProjects(engineGet);
  if (!list) notFound();
  const projects = (await Promise.all(list.items.map((p) => loadProject(engineGet, p.id))))
    .filter((p) => p !== null)
    .map((p) => ({
      id: p.id,
      name: p.name,
      buildings: p.buildings.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    }));
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/inventory", label: "Inventory" }}
        title="New unit"
        lede="A unit belongs to a building of a project. Photos are added from Edit once it is saved."
      />
      <UnitForm mode="create" projects={projects} projectId={project} />
    </div>
  );
}
