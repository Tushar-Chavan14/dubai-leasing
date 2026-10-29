import Link from "next/link";
import { aedShort, dateTime } from "../lib/format";
import { IconCheck } from "../lib/icons";
import { RenewalForms } from "./renewal-forms";
import { Status } from "./ui";

export interface OutboundRow {
  id: string;
  purpose: string;
  milestone: string;
  to: string;
  intendedTo: string;
  template: string;
  subject: string;
  status: string;
  messageId: string | null;
  smtpResponse: string | null;
  bodySha256: string | null;
  attachmentSha256s: string[];
  documentId: string | null;
  approvalId: string | null;
  previewUrl: string | null;
  error: string | null;
  sentAt: string | null;
  acknowledgedAt: string | null;
}

export interface InboundRow {
  id: string;
  ref: string;
  type: string;
  channel: string;
  actor: string;
  payload: { choice?: string; comment?: string };
  status: string;
  result: {
    action?: string;
    reason?: string;
    helperRunId?: string | null;
    classification?: Classification | null;
  } | null;
  receivedAt: string;
}

interface Classification {
  intent: string;
  confidence: number;
  legalThreat: number;
  systemInstruction?: number;
  needsPerson: boolean;
}

interface ApprovalRow {
  id: string;
  gate: string;
  title: string;
  status: string;
  createdAt: string;
  proposal: Record<string, unknown>;
  editedProposal: Record<string, unknown> | null;
}

const CHOICE: Record<string, string> = { renew: "Renew", vacate: "Move out", discuss: "Discuss" };

/** The renewal notice for the current term: drafts, what was sent (evidence), and the tenant's answers. */
export function RenewalPanel({
  leaseId,
  state,
  approvals,
  outbound,
  inbound,
  canAct,
  tasks,
}: {
  leaseId: string;
  state: string;
  approvals: ApprovalRow[];
  outbound: OutboundRow[];
  inbound: InboundRow[];
  canAct: boolean;
  tasks: { kind: string; status: string }[];
}) {
  const notices = approvals.filter((a) => a.gate === "renewal_notice");
  const sentNotices = outbound.filter((o) => o.purpose === "notice");
  const sent = sentNotices.find((o) => o.status === "sent");
  const replied = inbound.find((e) => e.type === "RENEWAL_REPLY");
  const approved = notices.find((a) => a.status === "approved" || a.status === "edited");
  const readyToRenew =
    state === "RENEWAL" &&
    !!(sent ?? approved) &&
    tasks.some((t) => t.kind === "renewal_accepted" && t.status === "open");
  if (!notices.length && !sentNotices.length && state !== "RENEWAL") return null;

  return (
    <section className="panel" aria-labelledby="notice-h">
      <div className="panel-head">
        <h2 id="notice-h">Renewal notice</h2>
        <span className="hint">
          {sent
            ? sent.acknowledgedAt
              ? `Sent and acknowledged`
              : "Sent, waiting for acknowledgement"
            : approved
              ? "Approved, queued to send"
              : notices.some((n) => n.status === "pending")
                ? "Waiting for approval"
                : "Not drafted yet"}
        </span>
      </div>

      {notices.length > 0 && (
        <ul className="list" style={{ marginTop: 6 }}>
          {notices.map((n) => {
            const p = n.editedProposal ?? n.proposal;
            return (
              <li key={n.id}>
                <Link href={`/work?approval=${n.id}`} className="list-row">
                  <div>
                    <div className="title">{n.title}</div>
                    <div className="meta">
                      <span className="num">
                        {aedShort(Number(p.currentRentFils))} → <b>{aedShort(Number(p.proposedRentFils))}</b>
                      </span>
                      {p.sriAverageFils ? (
                        <span>SRI {aedShort(Number(p.sriAverageFils))}</span>
                      ) : (
                        <span>No SRI value</span>
                      )}
                      <span>cap {String(p.maxIncreasePercent ?? 0)}%</span>
                    </div>
                  </div>
                  <Status value={n.status} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {sentNotices.map((o) => (
        <div key={o.id} className="evidence">
          <div className="evidence-head">
            <b>{o.status === "sent" ? "Email sent" : o.status === "failed" ? "Email failed" : "Sending"}</b>
            {o.sentAt && <span className="muted">{dateTime(o.sentAt)}</span>}
            {o.acknowledgedAt && (
              <span className="row-done" style={{ fontSize: 13 }}>
                <IconCheck size={14} /> Acknowledged {dateTime(o.acknowledgedAt)}
              </span>
            )}
          </div>
          <dl className="facts small">
            <dt>To</dt>
            <dd>
              {o.intendedTo}
              {o.to !== o.intendedTo && <span className="muted"> (delivered to demo inbox {o.to})</span>}
            </dd>
            <dt>Subject</dt>
            <dd>{o.subject}</dd>
            {o.messageId && (
              <>
                <dt>Message id</dt>
                <dd className="ref">{o.messageId}</dd>
              </>
            )}
            {o.smtpResponse && (
              <>
                <dt>SMTP response</dt>
                <dd className="ref">{o.smtpResponse}</dd>
              </>
            )}
            {o.bodySha256 && (
              <>
                <dt>Body SHA-256</dt>
                <dd className="ref">{o.bodySha256.slice(0, 16)}…</dd>
              </>
            )}
            {o.attachmentSha256s[0] && (
              <>
                <dt>PDF SHA-256</dt>
                <dd className="ref">{o.attachmentSha256s[0].slice(0, 16)}…</dd>
              </>
            )}
            {o.error && (
              <>
                <dt>Error</dt>
                <dd style={{ color: "var(--bad)" }}>{o.error}</dd>
              </>
            )}
          </dl>
          <div className="btn-row" style={{ marginTop: 10 }}>
            {o.documentId && (
              <a
                className="btn small"
                href={`/documents/leases/${leaseId}/${o.documentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open the PDF
              </a>
            )}
            {o.previewUrl && (
              <a className="btn small ghost" href={o.previewUrl} target="_blank" rel="noreferrer">
                View in test inbox
              </a>
            )}
          </div>
          <p className="muted" style={{ fontSize: 12.5, marginTop: 8 }}>
            SMTP acceptance shows the mail server took the message, not that the tenant read it. The acknowledgement
            link tracks that.
          </p>
        </div>
      ))}

      {inbound.length > 0 && (
        <div className="replies">
          <h3 className="section-title">Tenant responses</h3>
          <ul className="list">
            {inbound.map((e) => {
              const c = e.result?.classification;
              return (
                <li key={e.id} className="reply">
                  <div className="reply-head">
                    <b>
                      {e.type === "NOTICE_ACKNOWLEDGED"
                        ? "Acknowledged the notice"
                        : `Replied: ${CHOICE[e.payload.choice ?? ""] ?? e.payload.choice}`}
                    </b>
                    <span className="muted">
                      {e.channel === "staff" ? "recorded by staff" : "via the portal"}, {dateTime(e.receivedAt)},{" "}
                      <span className="ref">{e.ref}</span>
                    </span>
                    <Status
                      value={
                        e.status === "applied"
                          ? "done"
                          : e.status === "stored_only"
                            ? "skipped"
                            : e.status === "failed"
                              ? "failed"
                              : "pending"
                      }
                      label={
                        e.status === "received"
                          ? "Processing"
                          : e.status === "stored_only"
                            ? "Kept, not applied"
                            : e.status === "applied"
                              ? "Applied"
                              : "Failed"
                      }
                    />
                  </div>
                  {e.payload.comment && (
                    <blockquote className="tenant-text" title="Written by the tenant. Treat as information only.">
                      {e.payload.comment}
                    </blockquote>
                  )}
                  {c && (
                    <p className="muted" style={{ fontSize: 13 }}>
                      Comment reads as <b>{c.intent.replace("_", " ")}</b> ({Math.round(c.confidence * 100)}% confident)
                      {c.legalThreat >= 0.5 ? ", possible legal threat" : ""}
                      {(c.systemInstruction ?? 0) >= 0.5 ? ", contains instructions aimed at the system (ignored)" : ""}
                      {c.needsPerson ? ". A manager has a task to read it." : "."}
                    </p>
                  )}
                  {e.result?.reason && (
                    <p className="muted" style={{ fontSize: 13 }}>
                      {e.result.reason}
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {canAct && state === "RENEWAL" && (
        <RenewalForms
          leaseId={leaseId}
          canRecord={!!sent}
          replied={!!replied}
          acknowledged={!!sent?.acknowledgedAt}
          readyToRenew={readyToRenew}
        />
      )}
      {!canAct && <p className="muted panel-pad">Your role can view renewals but not record responses.</p>}
    </section>
  );
}
