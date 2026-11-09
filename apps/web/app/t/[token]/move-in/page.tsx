import { notFound } from "next/navigation";
import { Note, PAGE, PortalTitle, Section } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { TENANCY_OPS } from "../../../../lib/env";
import { LinkGone } from "../link-gone";
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
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await portalView<View>(token);
  if (!v || v.purpose !== "move_in_ack" || !v.tenancy.moveIn) {
    return <LinkGone message="This link has expired. Open the newest email from us, or contact the leasing team." />;
  }
  return (
    <div className={PAGE}>
      <PortalTitle title="Your move-in report" sub={v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"} />
      <Section>
        <p className="m-0">At move-in we checked: {v.tenancy.moveIn.checked.join("; ") || "nothing noted"}.</p>
        <p className="m-0">We photographed every room: {v.tenancy.moveIn.rooms.join(", ")}.</p>
        <Note>
          If you find damage or something missing, tell us now and add your own photos. This protects you at move-out.
        </Note>
      </Section>
      {v.linkUsed ? <Note>You already confirmed the report. Thank you.</Note> : <MoveInAckForm token={token} />}
    </div>
  );
}
