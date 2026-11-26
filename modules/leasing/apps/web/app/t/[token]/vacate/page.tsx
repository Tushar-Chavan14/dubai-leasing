import { notFound } from "next/navigation";
import { Note, PAGE, PortalTitle } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { TENANCY_OPS } from "../../../../lib/env";
import type { MoveOutPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { VacateNoticeForm } from "../tenancy-forms";

/** Step 10: the tenant gives notice to move out at the lease end (tenancy link). */
export default async function VacatePage({ params }: { params: Promise<{ token: string }> }) {
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await portalView<MoveOutPortalView>(token);
  if (!v?.tenancy?.moveOut || v.purpose !== "tenancy") {
    return <LinkGone message="This link has expired. Open the newest email from us, or contact the leasing team." />;
  }
  return (
    <div className={PAGE}>
      <PortalTitle
        title="Give notice to move out"
        sub={v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}
      />
      {v.tenancy.moveOut.canGiveNotice ? (
        <VacateNoticeForm token={token} leaseEndOn={v.tenancy.moveOut.leaseEndOn} />
      ) : (
        <Note>We already have your answer for this lease term. Contact the leasing team to change it.</Note>
      )}
    </div>
  );
}
