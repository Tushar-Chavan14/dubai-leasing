import { publicGet } from "../../../../lib/engine";
import { ReportIssueForm } from "../tenancy-forms";

interface View {
  purpose: string;
  unit: { label: string; community: string } | null;
  tenancy: { canReportIssue: boolean };
}

/** Step 8: report an issue with the home (triaged; "someone is at risk" goes to a person at once). */
export default async function ReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<View>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v || v.purpose !== "tenancy" || !v.tenancy.canReportIssue) {
    return (
      <section className="panel panel-pad">
        <p className="muted">
          This link can't be used to report an issue. Open "My tenancy" from your newest email from us.
        </p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Report an issue</h1>
        <p className="muted">{v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}</p>
      </div>
      <section className="panel panel-pad">
        <ReportIssueForm token={token} />
      </section>
    </div>
  );
}
