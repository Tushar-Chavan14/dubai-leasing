import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { DemoHandoff } from "../../../../components/demo-handoff";
import { ListingView } from "../../../../components/listings";
import { webEnv } from "../../../../lib/env";
import { engineGet } from "../../../../lib/engine";
import { loadListing, loadOffers } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Listing" };

/** One listing (S77): the page reads it as the signed-in user; the engine sends sellers and files to sales roles only. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireScreen("listings");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const listing = await loadListing(engineGet, id.data);
  if (!listing) notFound();
  const offers = await loadOffers(engineGet, id.data);
  return (
    <ListingView
      listing={listing}
      offers={offers}
      viewer={user.role}
      handoff={<DemoHandoff role="sales_manager" demo={webEnv().SPA_DEMO_MODE} />}
    />
  );
}
