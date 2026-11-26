import { buttonClass } from "@platform/ui/button";
import { PageTitle, TabLinks } from "@platform/ui/page";
import { ALERT } from "@platform/ui/settings";
import { railItems } from "@spa/core/roles";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ProjectTable } from "../../../components/projects";
import { UnitsBrowser, type UnitFilters } from "../../../components/units-browser";
import { parseAedToFils } from "../../../lib/catalogue";
import { engineGet } from "../../../lib/engine";
import { loadProjects, loadUnits } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";
import { errorWords } from "./words";

export const metadata: Metadata = { title: "Inventory" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim().slice(0, 60) : "");

/**
 * Inventory (design §4.6, S64, S75): the developer's units and projects. The Units tab is the default and filters by
 * the address; Projects is the table of projects. Everyone with the screen reads; an admin also adds. The engine
 * answers 403 to a role or a company kind that has no inventory, and the page is not there.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { user } = await requireScreen("inventory");
  const sp = await searchParams;
  const admin = user.role === "admin";
  const tab = one(sp.tab) === "projects" ? "projects" : "units";
  const error = one(sp.error);
  const canWork = railItems(user.role, user.companyKind).some((i) => i.screen === "work");

  const filters: UnitFilters = {
    project: one(sp.project),
    type: one(sp.type),
    beds: one(sp.beds),
    state: one(sp.state),
    min: one(sp.min),
    max: one(sp.max),
    q: one(sp.q),
  };
  const query = new URLSearchParams({ limit: "24" });
  for (const k of ["project", "type", "beds", "state", "q"] as const) if (filters[k]) query.set(k, filters[k]!);
  for (const [from, to] of [
    ["min", "minPriceFils"],
    ["max", "maxPriceFils"],
  ] as const) {
    const fils = filters[from] ? parseAedToFils(filters[from]!) : null;
    if (fils !== null) query.set(to, String(fils));
  }
  const cursor = one(sp.cursor);
  if (cursor) query.set("cursor", cursor);

  const [units, projects] = await Promise.all([
    tab === "units" ? loadUnits(engineGet, query) : null,
    tab === "projects" ? loadProjects(engineGet) : null,
  ]);
  if (!(tab === "units" ? units : projects)) notFound();

  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) keep.set(k, v);
  const nextHref = units?.next
    ? `/inventory?${new URLSearchParams([...keep, ["cursor", units.next]]).toString()}`
    : null;

  return (
    <div className="grid gap-6">
      <PageTitle
        title="Inventory"
        lede={
          admin
            ? "Units, projects, buildings and price lists. You add and change them here."
            : "Units, projects, buildings and price lists. You can look; an admin changes them."
        }
        actions={
          admin && tab === "projects" ? (
            <Link href="/inventory/projects/new" className={buttonClass("primary", "sm")}>
              <PlusIcon size={16} aria-hidden />
              New project
            </Link>
          ) : undefined
        }
      />
      <TabLinks
        label="Inventory"
        items={[
          { href: "/inventory", label: "Units", current: tab === "units" },
          { href: "/inventory?tab=projects", label: "Projects", current: tab === "projects" },
        ]}
      />
      {error && (
        <p role="alert" className={ALERT.bad}>
          {errorWords(error)}
        </p>
      )}
      {units && <UnitsBrowser page={units} filters={filters} canWork={canWork} canAdd={admin} nextHref={nextHref} />}
      {projects && <ProjectTable projects={projects.items} unplaced={projects.unplacedUnits} />}
    </div>
  );
}
