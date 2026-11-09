import { notFound } from "next/navigation";
import { PAGE, PortalTitle } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { TENANCY_OPS } from "../../../../lib/env";
import { LinkGone } from "../link-gone";
import { ReportIssueForm } from "../tenancy-forms";

interface View {
  purpose: string;
  unit: { label: string; community: string } | null;
  tenancy: { canReportIssue: boolean };
}

/** Step 8: report an issue with the home (triaged; "someone is at risk" goes to a person at once). */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await portalView<View>(token);
  if (!v || v.purpose !== "tenancy" || !v.tenancy.canReportIssue) {
    return (
      <LinkGone
        message={'This link can\'t be used to report an issue. Open "My tenancy" from your newest email from us.'}
      />
    );
  }
  return (
    <div className={PAGE}>
      <PortalTitle title="Report an issue" sub={v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"} />
      <ReportIssueForm token={token} />
    </div>
  );
}
