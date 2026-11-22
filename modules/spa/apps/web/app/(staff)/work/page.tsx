import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Work" };

export default async function Page() {
  const { item } = await requireScreen("work");
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Work"
        lede={
          item.readOnly
            ? "Everything open for your role. You can view these settings; an admin changes them."
            : "Everything open for your role."
        }
      />
      <EmptyState
        title="Nothing is open for your role."
        body="Approvals, deals, listings and tasks that need you will be listed here."
      />
    </div>
  );
}
