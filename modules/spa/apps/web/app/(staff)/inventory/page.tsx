import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Inventory" };

export default async function Page() {
  const { item } = await requireScreen("inventory");
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Inventory"
        lede={
          item.readOnly
            ? "Projects, buildings, units and price lists. You can view these settings; an admin changes them."
            : "Projects, buildings, units and price lists."
        }
      />
      <EmptyState
        title="No projects yet."
        body="Projects, their buildings and units, and price lists will appear here once a project is added."
      />
    </div>
  );
}
