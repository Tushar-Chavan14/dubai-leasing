import { PageTitle } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProjectForm } from "../../../../../components/projects";
import { requireScreen } from "../../../../../lib/session";
import { createProject } from "../../actions";
import { errorWords } from "../../words";

export const metadata: Metadata = { title: "New project" };

/** Add a project (admin only; anyone else finds no such page). */
export default async function Page({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { user } = await requireScreen("inventory");
  if (user.role !== "admin") notFound();
  const { error } = await searchParams;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/inventory", label: "Inventory" },
          { href: "/inventory?tab=projects", label: "Projects" },
        ]}
        title="New project"
        lede="Its buildings, units and price lists come after. The code can't change once a deal exists."
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {errorWords(error)}
        </p>
      )}
      <ProjectForm action={createProject} />
    </div>
  );
}
