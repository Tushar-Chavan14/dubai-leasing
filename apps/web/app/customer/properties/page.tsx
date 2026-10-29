import type { Metadata } from "next";
import { PropertyGrid } from "../../../components/public/property-grid";
import { fromParams, toEngineQuery } from "../../../lib/grid-filters";
import type { PublicUnitSummary } from "../../../lib/listings";
import { publicEngine } from "../../../lib/public";

export const metadata: Metadata = { title: "Properties" };

export default async function PropertiesPage({ searchParams }: PageProps<"/customer/properties">) {
  const params = await searchParams;
  // Every open listing gives the chip options; the filtered list comes from the engine.
  const all = await publicEngine<PublicUnitSummary[]>("/public/units?category=all");
  const options = all.ok ? all.data : [];
  const filters = fromParams(params, [...new Set(options.map((u) => u.community))]);
  const shown = all.ok ? await publicEngine<PublicUnitSummary[]>(`/public/units?${toEngineQuery(filters)}`) : all;
  return (
    <PropertyGrid
      options={options}
      units={shown.ok ? shown.data : []}
      loadFailed={!all.ok || !shown.ok}
      filters={filters}
    />
  );
}
