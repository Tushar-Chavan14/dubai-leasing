import { PageTitle } from "@platform/ui/page";
import { buttonClass } from "@platform/ui/button";
import { ALERT } from "@platform/ui/settings";
import { railItems } from "@spa/core/roles";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ProjectView } from "../../../../../components/projects";
import { UnitsBrowser, type UnitFilters } from "../../../../../components/units-browser";
import { parseAedToFils } from "../../../../../lib/catalogue";
import { engineGet } from "../../../../../lib/engine";
import { loadProject, loadUnits } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";
import { addBuilding, addUnit, createPriceList, publishPriceList } from "../../actions";
import { errorWords, savedWords } from "../../words";

export const metadata: Metadata = { title: "Project" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim().slice(0, 60) : "");

/** One project (design §4.6, S75): overview, photos, buildings, its units, price lists and activity. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Params>;
}) {
  const { user } = await requireScreen("inventory");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const sp = await searchParams;
  const project = await loadProject(engineGet, id.data);
  if (!project) notFound();

  const filters: UnitFilters = {
    type: one(sp.type),
    beds: one(sp.beds),
    state: one(sp.state),
    min: one(sp.min),
    max: one(sp.max),
    q: one(sp.q),
  };
  const query = new URLSearchParams({ limit: "24", project: project.id });
  for (const k of ["type", "beds", "state", "q"] as const) if (filters[k]) query.set(k, filters[k]!);
  for (const [from, to] of [
    ["min", "minPriceFils"],
    ["max", "maxPriceFils"],
  ] as const) {
    const fils = filters[from] ? parseAedToFils(filters[from]!) : null;
    if (fils !== null) query.set(to, String(fils));
  }
  if (one(sp.cursor)) query.set("cursor", one(sp.cursor));
  const units = await loadUnits(engineGet, query);
  if (!units) notFound();

  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) keep.set(k, v);
  const here = `/inventory/projects/${project.id}`;
  const nextHref = units.next
    ? `${here}?${new URLSearchParams([...keep, ["cursor", units.next]]).toString()}#units`
    : null;
  const canWork = railItems(user.role, user.companyKind).some((i) => i.screen === "work");
  const admin = user.role === "admin";
  const error = one(sp.error);
  const note = one(sp.saved) ? savedWords(one(sp.saved)) : null;
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/inventory", label: "Inventory" },
          { href: "/inventory?tab=projects", label: "Projects" },
        ]}
        title={project.name}
        lede={`Project ${project.code}`}
        actions={
          admin ? (
            <Link href={`${here}/edit`} className={buttonClass("ghost", "sm")}>
              <PencilSimpleIcon size={15} aria-hidden />
              Edit project
            </Link>
          ) : undefined
        }
      />
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
        actions={{ addBuilding, addUnit, createPriceList, publishPriceList }}
        units={
          <UnitsBrowser
            page={units}
            filters={filters}
            canWork={canWork}
            canAdd={false}
            nextHref={nextHref}
            scope={{ projectId: project.id, action: `${here}#units` }}
          />
        }
      />
    </div>
  );
}
