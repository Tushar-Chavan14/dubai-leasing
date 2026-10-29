import Link from "next/link";
import { relativeTime } from "../../../lib/format";
import type { LogEntry, RecordRow } from "../../../lib/types";
import { DraftReplyButton } from "./draft-reply-button";
import { EntryActions } from "./entry-actions";
import { type WorkQuery, workHref } from "./url";

const byTime = (a: LogEntry, b: LogEntry) => b.at.localeCompare(a.at);

export function actorChip(e: LogEntry, meName: string): string {
  switch (e.actor.kind) {
    case "agent":
    case "system":
      return "Agent";
    case "applicant":
      return "Applicant";
    case "tenant":
      return "Tenant";
    default:
      return e.actor.name === meName ? "You" : e.actor.name;
  }
}

/** Centre pane: the record header, then its log. Pending entries are pinned on top with their buttons. */
export function ActivityLog({
  record,
  entries,
  query,
  today,
  meName,
  proactiveDrafts = false,
}: {
  /** The company switched on suggested drafts and the user may use the copilot's draft tool. */
  proactiveDrafts?: boolean;
  record: RecordRow;
  entries: LogEntry[];
  query: WorkQuery;
  today: string;
  meName: string;
}) {
  const pending = entries.filter((e) => e.pending).toSorted(byTime);
  const rest = entries.filter((e) => !e.pending).toSorted(byTime);
  const item = (e: LogEntry) => {
    const href = workHref(query, { kind: record.kind, id: record.id, entry: e.refId, pane: "open" });
    const selected = query.entry === e.refId;
    return (
      <li
        key={`${e.source}:${e.refId}`}
        className="wk-entry"
        data-pending={e.pending ? "true" : undefined}
        data-selected={selected ? "true" : undefined}
      >
        <Link href={href} className="wk-entry-main" aria-current={selected ? "true" : undefined}>
          <span className="wk-actor" data-kind={e.actor.kind === "system" ? "agent" : e.actor.kind}>
            {actorChip(e, meName)}
          </span>
          <span className="wk-text">{e.text}</span>
          <time dateTime={e.at}>{relativeTime(today, e.at)}</time>
        </Link>
        {e.pending && e.actions.length > 0 && (
          <EntryActions actions={e.actions} source={e.source} entryId={e.refId} recordId={record.id} editHref={href} />
        )}
      </li>
    );
  };
  return (
    <section className="wk-log" aria-label="Activity">
      <header className="wk-record-head">
        <div>
          <h1>
            <span className="ref">{record.ref}</span> {record.title}
          </h1>
          <p>
            {record.unitCode}, <span className="wk-stage">{record.stage}</span>. {record.nextStep}
          </p>
        </div>
        {proactiveDrafts && record.waitingOnReply && <DraftReplyButton record={record} />}
        <Link
          href={workHref(query, { pane: "open", entry: undefined })}
          className="btn small wk-show-detail"
          data-closed={query.pane === "closed" ? "true" : undefined}
        >
          Details
        </Link>
      </header>
      {entries.length === 0 ? (
        <p className="wk-empty">Nothing has happened on this record yet.</p>
      ) : (
        <ol className="wk-entries">
          {pending.length > 0 && (
            <li className="wk-pinned" aria-label="Waiting on a person">
              <ol>{pending.map(item)}</ol>
            </li>
          )}
          {rest.map(item)}
        </ol>
      )}
    </section>
  );
}
