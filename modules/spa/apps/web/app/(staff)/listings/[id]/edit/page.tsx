import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { MediaManager } from "../../../../../components/inventory-photos";
import { ListingForm } from "../../../../../components/listing-form";
import { FormSection } from "../../../../../components/unit-form";
import { engineGet } from "../../../../../lib/engine";
import { canWriteListings } from "../../../../../lib/listing-roles";
import { loadListing, loadListingAgents } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Edit listing" };

const CLOSED = new Set(["UNDER_OFFER", "SOLD", "WITHDRAWN"]);

/** Edit a listing's own details (sales roles only). Its sellers can't change. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireScreen("listings");
  if (!canWriteListings(user.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const [listing, agents] = await Promise.all([loadListing(engineGet, id.data), loadListingAgents(engineGet)]);
  if (!listing || !agents || CLOSED.has(listing.state)) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/listings", label: "Listings" },
          { href: `/listings/${listing.id}`, label: listing.ref },
        ]}
        title={`Edit ${listing.ref}`}
      />
      <div className="grid max-w-[980px]">
        <div id="photos">
          <FormSection title="Photos" lede="The first photo is the cover. Changes here are saved straight away.">
            <MediaManager kind="listing" ownerId={listing.id} photos={listing.media} />
          </FormSection>
        </div>
        <ListingForm mode="edit" listing={listing} agents={agents} />
      </div>
    </div>
  );
}
