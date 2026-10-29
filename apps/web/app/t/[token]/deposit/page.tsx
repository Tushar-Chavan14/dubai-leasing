import { notFound } from "next/navigation";
import { TENANCY_OPS } from "../../../../lib/env";
import { formatAed } from "@leasing/core";
import { publicGet } from "../../../../lib/engine";
import type { MoveOutPortalView } from "../../../../lib/portal";
import { DepositResponseForm } from "../tenancy-forms";

/** Step 10: the deposit statement; accept with refund details or dispute (single-use link). */
export default async function DepositPage({ params }: { params: Promise<{ token: string }> }) {
  if (!TENANCY_OPS) notFound();
  const { token } = await params;
  const v = await publicGet<MoveOutPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  const s = v?.tenancy?.moveOut?.statement;
  if (!v || v.purpose !== "deposit_response" || !s) {
    return (
      <section className="panel panel-pad">
        <p className="muted">This link has expired or the statement was replaced. Open the newest email from us.</p>
      </section>
    );
  }
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Your deposit statement</h1>
        <p className="muted">
          {v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your home"}. Statement {s.revision}.
        </p>
      </div>
      <section className="panel panel-pad stack">
        {s.items.length ? (
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {s.items.map((i, n) => (
              <li key={n}>
                {i.room ? `${i.room}: ` : ""}
                {i.label} × {i.quantity}: {formatAed(i.amountFils)}
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ margin: 0 }}>No damage was found beyond normal wear and tear.</p>
        )}
        <dl className="facts">
          <dt>Security deposit</dt>
          <dd>{formatAed(s.depositFils)}</dd>
          <dt>Deductions</dt>
          <dd>{formatAed(s.deductionsFils)}</dd>
          <dt>Refund to you</dt>
          <dd>
            <b>{formatAed(s.refundFils)}</b>
          </dd>
        </dl>
      </section>
      <section className="panel panel-pad">
        {v.tenancy.moveOut.canRespondToStatement ? (
          <DepositResponseForm token={token} revision={s.revision} />
        ) : (
          <p className="muted">
            {v.linkUsed
              ? "You already answered this statement. Thank you."
              : "This statement can no longer be answered."}
          </p>
        )}
      </section>
    </div>
  );
}
