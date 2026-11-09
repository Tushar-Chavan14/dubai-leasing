import { formatAed } from "@leasing/core";
import { notFound } from "next/navigation";
import { PAGE, PortalTitle } from "../../../../../components/ui/portal";
import { portalView } from "../../../../../lib/engine";
import { TENANCY_OPS } from "../../../../../lib/env";
import { longDate } from "../../../../../lib/format";
import { LinkGone } from "../../link-gone";
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
  if (!TENANCY_OPS) notFound();
  const { token, paymentId } = await params;
  const v = await portalView<View>(token);
  const p = v?.tenancy.openPayments.find((x) => x.id === paymentId);
  if (!v || !p) {
    return (
      <LinkGone message="There's nothing to reply about for this payment now (it may already be confirmed). Thank you." />
    );
  }
  return (
    <div className={PAGE}>
      <PortalTitle
        title={`Payment ${p.seq}`}
        sub={`${formatAed(p.amountFils)}, due ${longDate(p.dueOn)}${p.status === "bounced" ? " · the bank returned the cheque" : ""}`}
      />
      <PaymentReplyForm token={token} paymentId={p.id} today={v.tenancy.today} maxDate={v.tenancy.latestPayBy} />
    </div>
  );
}
