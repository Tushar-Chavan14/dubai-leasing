import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ListingForm } from "../../../../components/listing-form";
import { engineGet } from "../../../../lib/engine";
import { canWriteListings } from "../../../../lib/listing-roles";
import { loadListingAgents } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "New listing" };

/** Add a listing with its sellers (sales roles only; anyone else finds no such page). Photos are added on the record. */
export default async function Page() {
  const { user } = await requireScreen("listings");
  if (!canWriteListings(user.role)) notFound();
  const agents = await loadListingAgents(engineGet);
  if (!agents) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/listings", label: "Listings" }}
        title="New listing"
        lede="Add the property, its sellers, price and permit. Photos and documents are added on the listing once it is saved."
      />
      <ListingForm mode="new" agents={agents} />
    </div>
  );
}
