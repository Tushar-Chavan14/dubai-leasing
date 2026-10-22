import { publicGet } from "../../../../lib/engine";
import { MoveInAckForm } from "../tenancy-forms";

interface View {
  purpose: string;
  linkUsed: boolean;
  tenantFirstName: string;
  unit: { label: string; community: string } | null;
  tenancy: { moveIn: { checked: string[]; rooms: string[] } | null };
}

/** Step 7: the tenant confirms the move-in condition report (single-use link, policy days). */
export default async function MoveInPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<View>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v || v.purpose !== "move_in_ack" || !v.tenancy.moveIn) {
    return (
      <section className="panel panel-pad">
        <p className="muted">This link has expired. Open the newest email from us, or contact the leasing team.</p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Your move-in report</h1>
        <p className="muted">{v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}</p>
      </div>
      <section className="panel panel-pad stack">
        <p style={{ margin: 0 }}>At move-in we checked: {v.tenancy.moveIn.checked.join("; ") || "—"}.</p>
        <p style={{ margin: 0 }}>We photographed every room: {v.tenancy.moveIn.rooms.join(", ")}.</p>
        <p className="muted" style={{ margin: 0 }}>
          If you find damage or something missing, tell us now and add your own photos. This protects you at move-out.
        </p>
      </section>
      <section className="panel panel-pad">
        {v.linkUsed ? (
          <p className="muted">You already confirmed the report. Thank you.</p>
        ) : (
          <MoveInAckForm token={token} />
        )}
      </section>
    </div>
  );
}
