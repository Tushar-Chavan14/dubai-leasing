import { formatAed } from "@leasing/core";
import { redirect } from "next/navigation";
import { publicGet } from "../../../lib/engine";
import { longDate } from "../../../lib/format";
import { IconCheck, IconWarning } from "../../../lib/icons";
import type { ApplicationPortalView } from "../../../lib/portal";
import type { MoveOutView } from "../../../lib/portal";
import { ApplicationStatus } from "./application-status";
import { AcknowledgeForm, ReplyForm } from "./forms";

interface PortalView {
  purpose: "tenancy" | "notice_ack" | "move_in_ack" | "deposit_response";
  tenancy: {
    canReportIssue: boolean;
    moveOut: MoveOutView;
    openPayments: { id: string; seq: number; amountFils: number; dueOn: string; status: string }[];
    reports: {
      ref: string | null;
      status: string;
      category: string | null;
      createdAt: string;
      ticketStatus: string | null;
    }[];
  };
  tenantFirstName: string;
  lease: { state: string; startOn: string; endOn: string; annualRentFils: number; ref: string };
  unit: { label: string; community: string } | null;
  notice: {
    sentAt: string;
    acknowledgedAt: string | null;
    currentRentFils: number;
    proposedRentFils: number;
    newTermStartOn: string;
    newTermEndOn: string;
  } | null;
  reply: { ref: string; choice: string | null; receivedAt: string } | null;
  canAcknowledge: boolean;
  canReply: boolean;
}

const CHOICE_TEXT: Record<string, string> = { renew: "renew", vacate: "move out", discuss: "discuss the renewal" };

export default async function TenancyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await publicGet<PortalView | ApplicationPortalView>(`/api/portal/${encodeURIComponent(token)}`);
  if (!view) return <ExpiredLink />;
  if ("kind" in view && view.kind === "application") return <ApplicationStatus v={view} token={token} />;
  if ("kind" in view && (view as { kind: string }).kind === "sign") redirect(`/t/${token}/sign`);
  const v = view as PortalView;
  const increase = v.notice && v.notice.proposedRentFils > v.notice.currentRentFils;

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div>
        <h1 className="portal-title">Hello{v.tenantFirstName ? `, ${v.tenantFirstName}` : ""}</h1>
        <p className="muted">
          {v.unit ? `${v.unit.label}, ${v.unit.community}` : "Your tenancy"}. Tenancy until {longDate(v.lease.endOn)}.
        </p>
      </div>

      {v.purpose === "move_in_ack" && redirectTo(`/t/${token}/move-in`)}
      {v.purpose === "deposit_response" && redirectTo(`/t/${token}/deposit`)}

      {v.purpose === "tenancy" &&
        (v.tenancy.moveOut.canGiveNotice || v.tenancy.moveOut.booking || v.tenancy.moveOut.statement) && (
          <section className="panel panel-pad stack">
            <h2 className="section-title" style={{ margin: 0 }}>
              Moving out
            </h2>
            {v.tenancy.moveOut.canGiveNotice && (
              <a className="btn" style={{ width: "fit-content" }} href={`/t/${token}/vacate`}>
                Give notice to move out
              </a>
            )}
            {v.tenancy.moveOut.booking && (
              <p style={{ margin: 0 }}>
                Moving out on <b>{longDate(v.tenancy.moveOut.booking.moveOutOn)}</b>.{" "}
                {v.tenancy.moveOut.booking.done ? (
                  "The inspection is done."
                ) : (
                  <a href={`/t/${token}/inspection`}>
                    {v.tenancy.moveOut.booking.scheduledAt ? "Change the inspection time" : "Book the inspection"}
                  </a>
                )}
              </p>
            )}
            {v.tenancy.moveOut.statement && (
              <p style={{ margin: 0 }}>
                Deposit statement {v.tenancy.moveOut.statement.revision}: refund{" "}
                <b>{formatAed(v.tenancy.moveOut.statement.refundFils)}</b>
                {v.tenancy.moveOut.statement.paidOn
                  ? `, paid on ${longDate(v.tenancy.moveOut.statement.paidOn)}`
                  : ` (${v.tenancy.moveOut.statement.status})`}
                .
              </p>
            )}
          </section>
        )}

      {v.tenancy.openPayments.length > 0 && (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            Payments that need your attention
          </h2>
          <ul className="list">
            {v.tenancy.openPayments.map((p) => (
              <li key={p.id} className="list-row">
                <span>
                  Payment {p.seq}: {formatAed(p.amountFils)}, due {longDate(p.dueOn)}
                  {p.status === "bounced" ? " (cheque returned)" : ""}
                </span>
                {v.purpose === "tenancy" && (
                  <a className="btn small" href={`/t/${token}/payment/${p.id}`}>
                    Reply
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {v.tenancy.canReportIssue && v.purpose === "tenancy" && (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            Something wrong at home?
          </h2>
          <a className="btn primary" style={{ width: "fit-content" }} href={`/t/${token}/report`}>
            Report an issue
          </a>
          {v.tenancy.reports.length > 0 && (
            <ul className="list">
              {v.tenancy.reports.map((r) => (
                <li key={r.ref ?? r.createdAt} className="list-row">
                  <span>
                    <span className="ref">{r.ref}</span> {r.category ?? "being read"}
                  </span>
                  <span className="muted">
                    {r.ticketStatus ? `repair ${r.ticketStatus.replace("_", " ")}` : r.status}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {v.notice ? (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            Your renewal offer
          </h2>
          <dl className="facts">
            <dt>Current annual rent</dt>
            <dd className="num">{formatAed(v.notice.currentRentFils)}</dd>
            <dt>New annual rent</dt>
            <dd className="num">
              <b>{formatAed(v.notice.proposedRentFils)}</b> {increase ? "" : "(no change)"}
            </dd>
            <dt>New term</dt>
            <dd>
              {longDate(v.notice.newTermStartOn)} to {longDate(v.notice.newTermEndOn)}
            </dd>
          </dl>
          <a className="link" href={`/t/${token}/notice.pdf`} target="_blank" rel="noreferrer">
            Read the full notice (PDF)
          </a>
        </section>
      ) : v.tenancy.openPayments.length === 0 && !v.tenancy.canReportIssue ? (
        <section className="panel panel-pad">
          <p className="muted">There&apos;s nothing for you to do right now. We&apos;ll email you when there is.</p>
        </section>
      ) : null}

      {v.notice && (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            1. Confirm you received the notice
          </h2>
          {v.canAcknowledge ? (
            <AcknowledgeForm token={token} />
          ) : (
            <p className="row-done">
              <IconCheck size={16} /> Confirmed. Thank you.
            </p>
          )}
        </section>
      )}

      {v.notice && (
        <section className="panel panel-pad stack">
          <h2 className="section-title" style={{ margin: 0 }}>
            2. Tell us your plans
          </h2>
          {v.reply && (
            <p className="row-done">
              <IconCheck size={16} /> You told us you want to {CHOICE_TEXT[v.reply.choice ?? ""] ?? "reply"} (reference{" "}
              <span className="ref">{v.reply.ref}</span>).
            </p>
          )}
          {v.reply && v.canReply && (
            <p className="muted" style={{ margin: 0 }}>
              When you&apos;re ready, you can still tell us whether you&apos;ll renew or move out.
            </p>
          )}
          {v.reply && !v.canReply ? null : v.canReply ? (
            v.purpose === "tenancy" ? (
              <ReplyForm token={token} />
            ) : (
              <p className="muted">Use the &ldquo;Reply&rdquo; button in the notice email to answer.</p>
            )
          ) : (
            <p className="muted">This offer can no longer be answered online. Please contact the leasing team.</p>
          )}
        </section>
      )}
    </div>
  );
}

function redirectTo(path: string): never {
  redirect(path);
}

function ExpiredLink() {
  return (
    <section className="panel panel-pad stack">
      <h1 className="portal-title" style={{ fontSize: 22 }}>
        This link has expired
      </h1>
      <p className="muted">
        <IconWarning size={15} /> Links in our emails work for a limited time. Open the newest email from us, or reply
        to it and we&apos;ll send you a fresh link.
      </p>
    </section>
  );
}
