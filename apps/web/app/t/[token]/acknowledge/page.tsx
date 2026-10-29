import { notFound } from "next/navigation";
import { TENANCY_OPS } from "../../../../lib/env";
import { publicGet } from "../../../../lib/engine";
import { longDate } from "../../../../lib/format";
import { IconCheck } from "../../../../lib/icons";
import { AcknowledgeForm } from "../forms";

interface AckView {
  tenantFirstName: string;
  lease: { endOn: string };
  unit: { label: string } | null;
  notice: { sentAt: string } | null;
  canAcknowledge: boolean;
}

/** One-click acknowledgement page. Opening it does nothing by itself; the button records it. */
export default async function AcknowledgePage({ params }: { params: Promise<{ token: string }> }) {
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await publicGet<AckView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!v?.notice) {
    return (
      <section className="panel panel-pad">
        <h1 className="portal-title" style={{ fontSize: 22 }}>
          This link has expired
        </h1>
        <p className="muted">Open the newest email from us, or reply to it and we&apos;ll send a fresh link.</p>
      </section>
    );
  }
  return (
    <section className="panel panel-pad stack">
      <h1 className="portal-title" style={{ fontSize: 24 }}>
        Confirm you received your renewal notice
      </h1>
      <p className="muted">
        {v.unit?.label}. Your tenancy ends on {longDate(v.lease.endOn)}. Confirming only tells us the notice reached
        you; it doesn&apos;t accept or refuse anything.
      </p>
      {v.canAcknowledge ? (
        <AcknowledgeForm token={token} />
      ) : (
        <p className="row-done">
          <IconCheck size={16} /> Already confirmed. Thank you.
        </p>
      )}
      <p className="muted" style={{ fontSize: 13 }}>
        To renew, move out or discuss, use the &ldquo;Reply&rdquo; button in the same email.
      </p>
    </section>
  );
}
