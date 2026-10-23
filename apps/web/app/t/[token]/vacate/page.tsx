import { publicGet } from "../../../../lib/engine";
import type { MoveOutPortalView } from "../../../../lib/portal";
import { VacateNoticeForm } from "../tenancy-forms";

/** Step 10: the tenant gives notice to move out at the lease end (tenancy link). */
export default async function VacatePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await publicGet<MoveOutPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v?.tenancy?.moveOut || v.purpose !== "tenancy") {
    return (
      <section className="panel panel-pad">
        <p className="muted">This link has expired. Open the newest email from us, or contact the leasing team.</p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Give notice to move out</h1>
        <p className="muted">{v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}</p>
      </div>
      <section className="panel panel-pad">
        {v.tenancy.moveOut.canGiveNotice ? (
          <VacateNoticeForm token={token} leaseEndOn={v.tenancy.moveOut.leaseEndOn} />
        ) : (
          <p className="muted">
            We already have your answer for this lease term. Contact the leasing team to change it.
          </p>
        )}
      </section>
    </div>
  );
}
