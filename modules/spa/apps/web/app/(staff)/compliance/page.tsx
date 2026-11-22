import { EmptyState } from "@platform/ui/empty-state";
import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { requireScreen } from "../../../lib/session";

export const metadata: Metadata = { title: "Compliance" };

export default async function Page() {
  const { item } = await requireScreen("compliance");
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Compliance"
        lede={
          item.readOnly
            ? "AML cases, enhanced due diligence and reports. You can view these settings; an admin changes them."
            : "AML cases, enhanced due diligence and reports."
        }
      />
      <EmptyState title="No cases yet." body="Screening cases that need a compliance decision will appear here." />
    </div>
  );
}
