import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Listings" };

export default async function Page() {
  const { item } = await requireScreen("listings");
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Listings"
        lede={
          item.readOnly
            ? "Listings with their permit and offer state. You can view these settings; an admin changes them."
            : "Listings with their permit and offer state."
        }
      />
      <EmptyState
        title="No listings yet."
        body="Each listing will show its seller, asking price, permit and offer once it is added."
      />
    </div>
  );
}
