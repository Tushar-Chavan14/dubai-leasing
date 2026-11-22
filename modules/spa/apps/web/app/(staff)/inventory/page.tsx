import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectForm, ProjectTable } from "../../../components/projects";
import { engineGet } from "../../../lib/engine";
import { loadProjects } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";
import { errorWords } from "./words";
import { createProject } from "./actions";

export const metadata: Metadata = { title: "Inventory" };

/**
 * Inventory (design §4.6, S64): the developer's projects. Everyone with the screen reads; an admin also gets the form
 * to add a project. The engine answers 403 to a role or a company kind that has no inventory, and the page is not there.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await requireScreen("inventory");
  const data = await loadProjects(engineGet);
  if (!data) notFound();
  const { error } = await searchParams;
  const admin = user.role === "admin";
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Inventory"
        lede={
          admin
            ? "Projects, buildings, units and price lists. You add and change them here."
            : "Projects, buildings, units and price lists. You can look; an admin changes them."
        }
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {errorWords(error)}
        </p>
      )}
      <ProjectTable projects={data.items} unplaced={data.unplacedUnits} />
      {admin && <ProjectForm action={createProject} />}
    </div>
  );
}
