import { PageTitle, TabLinks } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingTable } from "../../../components/listings";
import { engineGet } from "../../../lib/engine";
import { loadListings } from "../../../lib/loaders";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Listings" };

/**
 * Listings (design §4.7, S64): ref, property, seller kind, asking price, state, permit, public page and offer. No owner
 * name and no document number are on the table. "Mine" is the listings you are the agent of.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireScreen("listings");
  const raw = await searchParams;
  const scope = raw.scope === "mine" ? "mine" : "all";
  const cursor = typeof raw.cursor === "string" && /^[\w-]{1,200}$/.test(raw.cursor) ? raw.cursor : undefined;
  const data = await loadListings(engineGet, scope, cursor);
  if (!data) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Listings"
        lede="Each listing with its seller kind, asking price, permit, public page and offer."
      />
      <TabLinks
        label="Listings"
        items={[
          { href: "/listings", label: "All listings", current: scope === "all" },
          { href: "/listings?scope=mine", label: "Mine", current: scope === "mine" },
        ]}
      />
      <ListingTable
        listings={data.items}
        next={
          data.nextCursor
            ? {
                href: `/listings?${scope === "mine" ? "scope=mine&" : ""}cursor=${encodeURIComponent(data.nextCursor)}`,
              }
            : null
        }
      />
    </div>
  );
}
