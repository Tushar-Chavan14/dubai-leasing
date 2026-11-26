import { formatAed } from "@leasing/core";
import { notFound } from "next/navigation";
import { Note, PAGE, PortalTitle, Rows, Section, Tiles } from "../../../../components/ui/portal";
import { portalView } from "../../../../lib/engine";
import { TENANCY_OPS } from "../../../../lib/env";
import type { MoveOutPortalView } from "../../../../lib/portal";
import { LinkGone } from "../link-gone";
import { DepositResponseForm } from "../tenancy-forms";

/** Step 10: the deposit statement; accept with refund details or dispute (single-use link). */
export default async function DepositPage({ params }: { params: Promise<{ token: string }> }) {
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await portalView<MoveOutPortalView>(token);
  const s = v?.tenancy?.moveOut?.statement;
  if (!v || v.purpose !== "deposit_response" || !s) {
    return <LinkGone message="This link has expired or the statement was replaced. Open the newest email from us." />;
  }
  return (
    <div className={PAGE}>
      <PortalTitle
        title="Your deposit statement"
        sub={`${v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}. Statement ${s.revision}.`}
      />
      <Tiles
        label="Deposit"
        items={[
          { label: "Security deposit", value: formatAed(s.depositFils) },
          { label: "Deductions", value: formatAed(s.deductionsFils) },
          { label: "Refund to you", value: formatAed(s.refundFils), wide: true },
        ]}
      />
      {s.items.length ? (
        <Rows
          label="Deductions"
          rows={s.items.map((i, n) => ({
            label: `${i.room ? `${i.room}: ` : ""}${i.label} × ${i.quantity}`,
            value: formatAed(i.amountFils),
            key: n,
          }))}
        />
      ) : (
        <Section>
          <p className="m-0">No damage was found beyond normal wear and tear.</p>
        </Section>
      )}
      {v.tenancy.moveOut.canRespondToStatement ? (
        <DepositResponseForm token={token} revision={s.revision} />
      ) : (
        <Note>
          {v.linkUsed ? "You already answered this statement. Thank you." : "This statement can no longer be answered."}
        </Note>
      )}
    </div>
  );
}
