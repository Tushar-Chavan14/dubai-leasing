import type { Metadata } from "next";
import { CatalogueGrid } from "../../../components/public/catalogue-grid";
import { loadCatalogue } from "../../../lib/public-catalogue";
import { fromParams, toEngineQuery } from "../../../lib/public-filters";

export const metadata: Metadata = { title: "Homes for sale" };

/** The public catalogue (S78): resale listings and developer units on sale. Filters live in the address. */
export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const filters = fromParams(await searchParams);
  // Every public home gives the choices; the filtered list comes from the engine.
  const all = await loadCatalogue("");
  const shown = all.ok ? await loadCatalogue(toEngineQuery(filters)) : all;
  return (
    <CatalogueGrid
      options={all.ok ? all.data.items : []}
      items={shown.ok ? shown.data.items : []}
      communities={all.ok ? all.data.facets.communities : []}
      types={all.ok ? all.data.facets.types : []}
      loadFailed={!all.ok || !shown.ok}
      filters={filters}
    />
  );
}
