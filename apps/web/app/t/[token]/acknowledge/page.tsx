import { notFound } from "next/navigation";
import { CheckIcon as IconCheck } from "@phosphor-icons/react/dist/ssr";
import { Banner } from "../../../../components/ui/form";
import { Note, PAGE, PortalTitle } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { TENANCY_OPS } from "../../../../lib/env";
import { longDate } from "../../../../lib/format";
import { LinkGone } from "../link-gone";
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
  const v = await portalView<AckView>(token);
  if (!v?.notice) {
    return <LinkGone message="Open the newest email from us, or reply to it and we'll send a fresh link." />;
  }
  return (
    <div className={PAGE}>
      <PortalTitle
        title="Confirm you received your renewal notice"
        sub={`${v.unit?.label}. Your tenancy ends on ${longDate(v.lease.endOn)}. Confirming only tells us the notice reached you; it doesn't accept or refuse anything.`}
      />
      {v.canAcknowledge ? (
        <AcknowledgeForm token={token} pinned />
      ) : (
        <Banner tone="good" role="status">
          <IconCheck size={16} className="mt-0.5 shrink-0" aria-hidden />
          <span>Already confirmed. Thank you.</span>
        </Banner>
      )}
      <Note>To renew, move out or discuss, use the &ldquo;Reply&rdquo; button in the same email.</Note>
    </div>
  );
}
