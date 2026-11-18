import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Settings" };

export default async function Page() {
  const { item } = await requireScreen("settings");
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Settings"
        lede={
          item.readOnly
            ? "Company, selling, rules, checks, documents and people. You can view these settings; an admin changes them."
            : "Company, selling, rules, checks, documents and people."
        }
      />
      <EmptyState
        title="Nothing to set yet."
        body="Company details, users and roles, rules and checks will be set up here."
      />
    </div>
  );
}
