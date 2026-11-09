import Link from "next/link";
import { aedShort, dateTime } from "../lib/format";
import { CheckIcon as IconCheck } from "@phosphor-icons/react/dist/ssr";
import { RenewalForms } from "./renewal-forms";
import { Status } from "./ui";
import { buttonClass } from "./ui/button";
import { FactKey, FactList, FactVal, NOTE_TEXT, ROW_CARD, Section, TENANT_TEXT } from "./ui/record";
import { LIST, META, NOTE, SUB_HEAD } from "./ui/tenancy";

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

  const hint = sent
    ? sent.acknowledgedAt
      ? `Sent and acknowledged`
      : "Sent, waiting for acknowledgement"
    : approved
      ? "Approved, queued to send"
      : notices.some((n) => n.status === "pending")
        ? "Waiting for approval"
        : "Not drafted yet";

  return (
    <Section id="notice-h" title="Renewal notice" hint={hint}>
      {notices.length > 0 && (
        <ul className={LIST}>
          {notices.map((n) => {
            const p = n.editedProposal ?? n.proposal;
            return (
              <li key={n.id}>
                <Link
                  href={`/work?approval=${n.id}`}
                  className={`${ROW_CARD} flex flex-wrap items-center justify-between gap-3 hover:border-ink`}
                >
                  <div className="grid min-w-0 gap-0.5">
                    <div className="text-sm font-semibold">{n.title}</div>
                    <div className={META}>
                      <span className="font-mono tabular-nums">
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
        <div key={o.id} className="grid gap-3 rounded-xl border border-line p-3.5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <b className="font-semibold">
              {o.status === "sent" ? "Email sent" : o.status === "failed" ? "Email failed" : "Sending"}
            </b>
            {o.sentAt && <span className="text-muted">{dateTime(o.sentAt)}</span>}
            {o.acknowledgedAt && (
              <span className="inline-flex items-center gap-1 text-[13px] font-semibold">
                <IconCheck size={14} /> Acknowledged {dateTime(o.acknowledgedAt)}
              </span>
            )}
          </div>
          <FactList>
            <FactKey>To</FactKey>
            <FactVal>
              {o.intendedTo}
              {o.to !== o.intendedTo && <span className="text-muted"> (delivered to demo inbox {o.to})</span>}
            </FactVal>
            <FactKey>Subject</FactKey>
            <FactVal>{o.subject}</FactVal>
            {o.messageId && (
              <>
                <FactKey>Message id</FactKey>
                <FactVal className="font-mono text-xs">{o.messageId}</FactVal>
              </>
            )}
            {o.smtpResponse && (
              <>
                <FactKey>SMTP response</FactKey>
                <FactVal className="font-mono text-xs">{o.smtpResponse}</FactVal>
              </>
            )}
            {o.bodySha256 && (
              <>
                <FactKey>Body SHA-256</FactKey>
                <FactVal className="font-mono text-xs">{o.bodySha256.slice(0, 16)}…</FactVal>
              </>
            )}
            {o.attachmentSha256s[0] && (
              <>
                <FactKey>PDF SHA-256</FactKey>
                <FactVal className="font-mono text-xs">{o.attachmentSha256s[0].slice(0, 16)}…</FactVal>
              </>
            )}
            {o.error && (
              <>
                <FactKey>Error</FactKey>
                <FactVal className="text-danger">{o.error}</FactVal>
              </>
            )}
          </FactList>
          <div className="flex flex-wrap items-center gap-2">
            {o.documentId && (
              <a
                className={buttonClass("ghost", "sm")}
                href={`/documents/leases/${leaseId}/${o.documentId}`}
                target="_blank"
                rel="noreferrer"
              >
                Open the PDF
              </a>
            )}
            {o.previewUrl && (
              <a className={buttonClass("ghost", "sm")} href={o.previewUrl} target="_blank" rel="noreferrer">
                View in test inbox
              </a>
            )}
          </div>
          <p className={NOTE_TEXT}>
            SMTP acceptance shows the mail server took the message, not that the tenant read it. The acknowledgement
            link tracks that.
          </p>
        </div>
      ))}

      {inbound.length > 0 && (
        <div className="grid gap-2">
          <h3 className={SUB_HEAD}>Tenant responses</h3>
          <ul className={LIST}>
            {inbound.map((e) => {
              const c = e.result?.classification;
              return (
                <li key={e.id} className={`${ROW_CARD} grid gap-2`}>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <b className="text-sm font-semibold">
                      {e.type === "NOTICE_ACKNOWLEDGED"
                        ? "Acknowledged the notice"
                        : `Replied: ${CHOICE[e.payload.choice ?? ""] ?? e.payload.choice}`}
                    </b>
                    <span className="text-[12.5px] text-muted">
                      {e.channel === "staff" ? "recorded by staff" : "via the portal"}, {dateTime(e.receivedAt)},{" "}
                      <span className="font-mono">{e.ref}</span>
                    </span>
                    <span className="ml-auto">
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
                    </span>
                  </div>
                  {e.payload.comment && (
                    <blockquote className={TENANT_TEXT} title="Written by the tenant. Treat as information only.">
                      {e.payload.comment}
                    </blockquote>
                  )}
                  {c && (
                    <p className={NOTE}>
                      Comment reads as <b>{c.intent.replace("_", " ")}</b> ({Math.round(c.confidence * 100)}% confident)
                      {c.legalThreat >= 0.5 ? ", possible legal threat" : ""}
                      {(c.systemInstruction ?? 0) >= 0.5 ? ", contains instructions aimed at the system (ignored)" : ""}
                      {c.needsPerson ? ". A manager has a task to read it." : "."}
                    </p>
                  )}
                  {e.result?.reason && <p className={NOTE}>{e.result.reason}</p>}
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
      {!canAct && <p className={NOTE}>Your role can view renewals but not record responses.</p>}
    </Section>
  );
}
