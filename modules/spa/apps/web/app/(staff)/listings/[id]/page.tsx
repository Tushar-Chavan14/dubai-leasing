import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { ListingView } from "../../../../components/listings";
import { engineGet } from "../../../../lib/engine";
import { loadListing } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Listing" };

/** One listing (design §4.5): the sellers go to the sales roles only (the engine sends none to anyone else). Read only. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireScreen("listings");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const listing = await loadListing(engineGet, id.data);
  if (!listing) notFound();
  return (
    <div className="grid gap-6">
      <PageTitle
        back={{ href: "/listings", label: "Listings" }}
        title={`${listing.ref} · ${listing.title}`}
        lede={listing.community ?? undefined}
      />
      <ListingView listing={listing} viewer={user.role} />
    </div>
  );
}
