import { publicGet } from "../../../../lib/engine";
import { longDate } from "../../../../lib/format";
import type { MoveOutPortalView } from "../../../../lib/portal";
import { InspectionBookingForm } from "../tenancy-forms";

/** Step 10: the tenant books (or moves) the move-out inspection. */
export default async function InspectionPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<MoveOutPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  const b = v?.tenancy?.moveOut?.booking;
  if (!v || v.purpose !== "tenancy" || !b) {
    return (
      <section className="panel panel-pad">
        <p className="muted">There is no move-out inspection to book on this link. Open the newest email from us.</p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Move-out inspection</h1>
        <p className="muted">
          {v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}. Moving out on {longDate(b.moveOutOn)}.
        </p>
      </div>
      <section className="panel panel-pad stack">
        <p className="muted" style={{ margin: 0 }}>
          We check the keys and access cards and photograph each room, then compare with your move-in photos. Normal
          wear and tear is never deducted.
        </p>
        {b.done ? (
          <p>The inspection is done. We will email you the deposit statement.</p>
        ) : (
          <InspectionBookingForm token={token} slots={b.slots} current={b.scheduledAt} />
        )}
      </section>
    </div>
  );
}
