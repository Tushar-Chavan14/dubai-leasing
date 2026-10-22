import { formatAed } from "@leasing/core";
import { publicGet } from "../../../../../lib/engine";
import { longDate } from "../../../../../lib/format";
import { PaymentReplyForm } from "../../tenancy-forms";

interface View {
  purpose: string;
  unit: { label: string; community: string } | null;
  tenancy: {
    today: string;
    latestPayBy: string;
    openPayments: { id: string; seq: number; amountFils: number; dueOn: string; status: string }[];
  };
}

/** Step 8: the tenant replies about one overdue or bounced payment. */
export default async function PaymentPage({ params }: { params: Promise<{ token: string; paymentId: string }> }) {
  const { token, paymentId } = await params;
  const v = await publicGet<View>(`/api/portal/${encodeURIComponent(token)}`);
  const p = v?.tenancy.openPayments.find((x) => x.id === paymentId);
  if (!v || !p) {
    return (
      <section className="panel panel-pad">
        <p className="muted">
          There's nothing to reply about for this payment now (it may already be confirmed). Thank you.
        </p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Payment {p.seq}</h1>
        <p className="muted">
          {formatAed(p.amountFils)}, due {longDate(p.dueOn)}
          {p.status === "bounced" ? " · the bank returned the cheque" : ""}
        </p>
      </div>
      <section className="panel panel-pad">
        <PaymentReplyForm token={token} paymentId={p.id} today={v.tenancy.today} maxDate={v.tenancy.latestPayBy} />
      </section>
    </div>
  );
}
