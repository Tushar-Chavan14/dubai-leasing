import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { OfferForm } from "../../../../../components/offer-form";
import { engineGet } from "../../../../../lib/engine";
import { canWriteListings } from "../../../../../lib/listing-roles";
import { loadLead, loadListing, loadOffers } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Make an offer" };

const OPEN_STATES = ["ACTIVE", "PUBLISHED"];

/**
 * Make an offer on a resale listing (M6, S81), optionally for a lead (`?lead=<id>`, the buyer comes filled in). A listing
 * that can't take an offer, or a lead about another home, says so instead of showing a form.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ lead?: string }>;
}) {
  const { user } = await requireScreen("listings");
  if (!canWriteListings(user.role)) notFound();
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const listing = await loadListing(engineGet, id.data);
  if (!listing) notFound();
  const offers = await loadOffers(engineGet, id.data);
  if (!offers) notFound();
  const q = await searchParams;
  let lead: { id: string; name: string; email: string } | null = null;
  if (q.lead) {
    const leadId = z.uuid().safeParse(q.lead);
    if (!leadId.success) notFound();
    const l = await loadLead(engineGet, leadId.data);
    if (!l) notFound();
    if (l.property?.kind === "unit") redirect(`/deals/new?lead=${l.id}`);
    if (l.property?.id !== listing.id) notFound();
    lead = { id: l.id, name: l.name, email: l.email };
  }
  const crumbs = [
    { href: "/listings", label: "Listings" },
    { href: `/listings/${listing.id}`, label: listing.ref },
  ];
  if (!OPEN_STATES.includes(listing.state))
    return (
      <div className="grid max-w-[620px] gap-3">
        <PageTitle back={crumbs} title="Make an offer" />
        <p className="m-0 text-sm text-muted">
          {listing.state === "UNDER_OFFER"
            ? "This home already has an open offer or a deal."
            : "This home is no longer available for an offer."}{" "}
          <Link href={`/listings/${listing.id}`} className="font-semibold text-ink! underline">
            Back to the listing
          </Link>
        </p>
      </div>
    );
  return (
    <div className="grid gap-6">
      <PageTitle
        back={crumbs}
        title="Make an offer"
        lede="Add the buyers and the price. Each seller is emailed their own link to accept or decline."
      />
      <OfferForm
        listing={{
          id: listing.id,
          ref: listing.ref,
          title: listing.title,
          askingPriceFils: listing.askingPriceFils,
          offplan: listing.ownership?.kind === "oqood",
        }}
        terms={offers.terms}
        lead={lead}
      />
    </div>
  );
}
