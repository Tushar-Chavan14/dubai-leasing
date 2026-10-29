import Link from "next/link";
import { ApplicationDetail } from "../../../components/application-detail";
import { ApprovalDetail } from "../../../components/approval-detail";
import { LeaseDetail } from "../../../components/lease-detail";
import { Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { actorLabel, dateTime, eventLabel, humanise, proposalValue } from "../../../lib/format";
import { IconClose } from "../../../lib/icons";
import type { LogEntry, RecordRow } from "../../../lib/types";
import { type WorkQuery, workHref } from "./url";

/** Fields that can carry personal data are never printed in the pane (rule 8). */
const PERSONAL = /emirates|passport|visa|phone|mobile|idno|eid/i;
const SKIP = new Set(["id", "previewUrl", "leaseId", "applicationId", "unitId"]);

function Facts({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== undefined && v !== "");
  if (rows.length === 0) return <p className="muted">No further details were recorded.</p>;
  return (
    <dl className="facts">
      {rows.map(([k, v]) => (
        <div key={k} className="wk-fact">
          <dt>{humanise(k)}</dt>
          <dd className={/sha256|messageId/i.test(k) ? "ref" : undefined}>
            {PERSONAL.test(k)
              ? "Hidden (personal data)"
              : Array.isArray(v)
                ? v.join(", ") || "None"
                : proposalValue(k, v)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

interface Rows {
  events?: { id: string; type: string; actor: string; at: string; payload?: Record<string, unknown> }[];
  outbound?: ({ id: string; previewUrl?: string | null } & Record<string, unknown>)[];
  tasks?: ({ id: string } & Record<string, unknown>)[];
}

async function EntryDetail({ record, entry }: { record: RecordRow; entry: LogEntry }) {
  const detail = await get<Rows>(`/api/${record.kind === "lease" ? "leases" : "applications"}/${record.id}`);
  const event = entry.source === "event" ? detail?.events?.find((e) => e.id === entry.refId) : undefined;
  const mail = entry.source === "email" ? detail?.outbound?.find((o) => o.id === entry.refId) : undefined;
  const task = entry.source === "task" ? detail?.tasks?.find((t) => t.id === entry.refId) : undefined;
  return (
    <div className="stack">
      <section aria-labelledby="entry-h">
        <h2 id="entry-h" className="section-title">
          {event ? eventLabel(event.type) : mail ? "Email evidence" : task ? "Task" : "Entry"}
        </h2>
        <p>{entry.text}</p>
        {event && (
          <p className="muted">
            {actorLabel(event.actor)}, {dateTime(event.at)}
          </p>
        )}
      </section>
      {event && (
        <section aria-labelledby="payload-h">
          <h2 id="payload-h" className="section-title">
            What was recorded
          </h2>
          <Facts data={event.payload ?? {}} />
        </section>
      )}
      {mail && (
        <section aria-labelledby="mail-h">
          <h2 id="mail-h" className="section-title">
            Stored with the message
          </h2>
          <Facts data={mail} />
          {typeof mail.previewUrl === "string" && (
            <a className="btn small" href={mail.previewUrl} target="_blank" rel="noreferrer">
              View in test inbox
            </a>
          )}
        </section>
      )}
      {task && (
        <section aria-labelledby="task-h">
          <h2 id="task-h" className="section-title">
            Task details
          </h2>
          <Facts data={task} />
        </section>
      )}
      {!event && !mail && !task && <p className="muted">No further details for this entry.</p>}
    </div>
  );
}

/** Right pane: the selected entry's details, or the whole record when nothing is selected. */
export async function DetailPane({
  query,
  record,
  entry,
  approvalId,
}: {
  query: WorkQuery;
  record: RecordRow | null;
  entry: LogEntry | null;
  /** An approval that has no record in the Workspace (for example one on a unit). */
  approvalId?: string | undefined;
}) {
  const closed = query.pane === "closed";
  if (closed || (!record && !approvalId)) return null;
  const clear = workHref(query, { entry: undefined });
  const title = entry
    ? entry.source === "approval"
      ? "Approval"
      : "Details"
    : approvalId
      ? "Approval"
      : record
        ? "Record"
        : "Details";
  return (
    <aside
      className="wk-detail"
      data-sheet={query.pane === "open" ? "true" : undefined}
      data-wide={query.wide ? "true" : undefined}
      aria-label="Details"
    >
      <header className="wk-detail-head">
        <h2>
          {title}{" "}
          {entry && (
            <Status value={entry.pending ? "pending" : "done"} label={entry.pending ? "Waiting" : "Recorded"} />
          )}
        </h2>
        <div className="btn-row">
          {entry && (
            <Link href={clear} className="btn small ghost">
              Whole record
            </Link>
          )}
          <Link href={workHref(query, { wide: !query.wide })} className="btn small ghost wk-wide-toggle">
            {query.wide ? "Narrower" : "Wider"}
          </Link>
          <Link
            href={workHref(query, { pane: "closed" })}
            className="btn small ghost icon"
            aria-label="Close the details"
          >
            <IconClose size={16} />
          </Link>
        </div>
      </header>
      <div className="wk-detail-body">
        {approvalId && !record ? (
          <ApprovalDetail id={approvalId} draftId={query.draft} />
        ) : !record ? (
          <p className="wk-empty">Pick a record to see its activity.</p>
        ) : entry?.source === "approval" ? (
          <ApprovalDetail id={entry.refId} draftId={query.draft} />
        ) : entry ? (
          <EntryDetail record={record} entry={entry} />
        ) : record.kind === "application" ? (
          <ApplicationDetail id={record.id} draftId={query.draft} />
        ) : (
          <LeaseDetail id={record.id} draftId={query.draft} />
        )}
      </div>
    </aside>
  );
}
