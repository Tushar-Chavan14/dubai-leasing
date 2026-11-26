import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingsBrowser, type ListingFilters } from "../../../components/listings-browser";
import { parseAedToFils } from "../../../lib/catalogue";
import { engineGet } from "../../../lib/engine";
import { canWriteListings } from "../../../lib/listing-roles";
import { loadListings } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Listings" };

type Params = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined): string => (typeof v === "string" ? v.trim().slice(0, 120) : "");

/**
 * Listings (design §4.5, S64, S77): the brokerage's listings as cards like the Units screen, filtered by the address.
 * "Mine" is the listings you are the agent of. The table view carries no owner name and no document number.
 */
export default async function Page({ searchParams }: { searchParams: Promise<Params> }) {
  const { user } = await requireScreen("listings");
  const sp = await searchParams;
  const scope = one(sp.scope) === "mine" ? "mine" : "all";
  const filters: ListingFilters = {
    scope: scope === "mine" ? "mine" : "",
    state: one(sp.state),
    community: one(sp.community),
    type: one(sp.type),
    beds: one(sp.beds),
    min: one(sp.min),
    max: one(sp.max),
    agent: one(sp.agent),
  };
  const query = new URLSearchParams();
  for (const k of ["state", "community", "type", "beds", "agent"] as const) if (filters[k]) query.set(k, filters[k]!);
  for (const [from, to] of [
    ["min", "minPriceFils"],
    ["max", "maxPriceFils"],
  ] as const) {
    const fils = filters[from] ? parseAedToFils(filters[from]!) : null;
    if (fils !== null) query.set(to, String(fils));
  }
  const cursor = /^[\w-]{1,200}$/.test(one(sp.cursor)) ? one(sp.cursor) : undefined;
  const data = await loadListings(engineGet, scope, cursor, query);
  if (!data) notFound();
  const keep = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) if (v) keep.set(k, v);
  const nextHref = data.nextCursor
    ? `/listings?${new URLSearchParams([...keep, ["cursor", data.nextCursor]]).toString()}`
    : null;
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Listings"
        lede="Each listing with its photos, asking price, permit and offer. Sales roles add and take them live."
      />
      <ListingsBrowser page={data} filters={filters} canAdd={canWriteListings(user.role)} nextHref={nextHref} />
    </div>
  );
}
