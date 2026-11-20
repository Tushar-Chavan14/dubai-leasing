import Link from "next/link";
import { stageLabel } from "../../../lib/stage-label";
import { ActivityItem, ActivityList } from "../../../components/activity-item";
import { Pill } from "../../../components/ui/pill";
import { RecordStepper } from "../../../components/ui/stepper";
import { Section } from "../../../components/ui/record";
import { get } from "../../../lib/engine";
import { actorLabel, eventLabel, logStamp, milestoneLabel } from "../../../lib/format";
import { type LogEntry, type RecordRow, STAGES } from "../../../lib/types";
import { DraftReplyButton } from "./draft-reply-button";
import { EmailButton } from "./email-button";
import { EntryActions } from "./entry-actions";
import { type WorkQuery, workHref } from "./url";

/** Newest entries shown at first; the rest sit behind "Show earlier". */
const SHOWN = 4;
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

/** The record's name, where it stands and what is next, with its stage tracker. */
export function RecordHead({
  record,
  query,
  proactiveDrafts = false,
}: {
  record: RecordRow;
  query: WorkQuery;
  /** The company switched on suggested drafts and the user may use the copilot's draft tool. */
  proactiveDrafts?: boolean;
}) {
  const CHIP =
    "inline-flex items-center rounded-full border border-line bg-raised px-2.5 py-1 text-xs leading-none text-muted";
  return (
    // Sticky: the name, tags and stage tracker stay in view while the record scrolls under them.
    <header className="sticky -top-6 z-20 grid gap-3 rounded-card border border-line bg-page px-5 pt-4 pb-4 shadow-card @[900px]:-top-6">
      <Link
        href={workHref(query, { kind: record.kind, id: undefined, entry: undefined, pane: undefined })}
        className="w-fit text-[12.5px] text-muted! underline-offset-2 hover:underline @[760px]:hidden"
      >
        All records
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-sans text-[26px] font-bold leading-tight tracking-[-0.02em] text-ink">
            {record.title}
          </h2>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Pill tone="accent">{stageLabel(record.stage, record.emirate)}</Pill>
            {record.waitingForMe && <Pill tone="waiting">Needs you</Pill>}
            <span className={`${CHIP} font-mono`}>{record.ref}</span>
            <span className={CHIP}>{record.unitCode}</span>
            <span className={CHIP}>{record.kind === "lease" ? "Lease" : "Application"}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {proactiveDrafts && record.waitingOnReply && <DraftReplyButton record={record} />}
          <EmailButton who={record.kind === "lease" ? "tenant" : "applicant"} />
        </div>
      </div>
      <div className="border-t border-line pt-4">
        <RecordStepper
          stages={STAGES}
          current={record.stage}
          labels={{ Viewing: stageLabel("Viewing"), Ejari: stageLabel("Ejari", record.emirate) }}
        />
      </div>
    </header>
  );
}

/**
 * The record's log, newest first, in the same rows as Home's activity: each opens to its facts and a link to the
 * full entry. Waiting entries are pinned on top with their buttons always visible.
 */
const TOGGLE =
  "rounded-full px-2.5 py-1 font-sans text-xs font-semibold no-underline text-muted! hover:text-ink! aria-[current=true]:bg-accent aria-[current=true]:text-on-accent! focus-visible:outline-2 focus-visible:outline-primary";

interface AuditEvent {
  id: string;
  type: string;
  actor: string;
  at: string;
  toState?: string | null;
  payload?: Record<string, unknown> | null;
}

/** One recorded event as a sentence: what, the new state or step, and who (the audit trail's wording). */
function auditText(e: AuditEvent): string {
  const p = e.payload ?? {};
  return [
    eventLabel(e.type),
    e.toState ? `to ${e.toState.toLowerCase().replaceAll("_", " ")}` : "",
    typeof p.milestone === "string" ? milestoneLabel(p.milestone).toLowerCase() : "",
    typeof p.title === "string" ? p.title : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/** Every recorded event on the record, newest first, append-only (rule 4): the audit trail inside Activity. */
async function AllEvents({ record, today }: { record: RecordRow; today: string }) {
  const detail = await get<{ events?: AuditEvent[] }>(
    `/api/${record.kind === "lease" ? "leases" : "applications"}/${record.id}`,
  );
  const events = (detail?.events ?? []).toSorted((a, b) => b.at.localeCompare(a.at));
  if (events.length === 0) return <p className="m-0 text-sm text-muted">No events recorded yet.</p>;
  return (
    <div className="-mt-3 -mb-5">
      <ul className="-mx-5 m-0 grid list-none divide-y divide-line p-0">
        {events.map((e) => (
          <li key={e.id} className="flex items-center gap-3 px-5 py-2.5 text-[13px] text-ink">
            <time dateTime={e.at} className="w-[96px] flex-none whitespace-nowrap font-mono text-[12px] text-muted">
              {logStamp(today, e.at)}
            </time>
            <span className="min-w-0 flex-1">{auditText(e)}</span>
            <span className="hidden flex-none text-xs text-muted sm:inline">{actorLabel(e.actor)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ActivityLog({
  record,
  entries,
  query,
  today,
  meName,
  gateId,
  inCardId,
}: {
  record: RecordRow;
  entries: LogEntry[];
  query: WorkQuery;
  today: string;
  meName: string;
  /** The approval shown as the gate panel above; its buttons live there, not here. */
  gateId?: string | undefined;
  /** The waiting task shown in the Next step card; its buttons live there, not here. */
  inCardId?: string | undefined;
}) {
  const pending = entries.filter((e) => e.pending).toSorted(byTime);
  const rest = entries.filter((e) => !e.pending).toSorted(byTime);
  const item = (e: LogEntry) => {
    const href = workHref(query, { kind: record.kind, id: record.id, entry: e.refId, pane: undefined });
    return (
      <ActivityItem
        key={`${e.source}:${e.refId}`}
        entry={e}
        stamp={logStamp(today, e.at)}
        note={actorChip(e, meName)}
        strong={e.pending}
        footer={
          <Link
            href={href}
            className="w-fit text-[13px] font-semibold text-primary! underline-offset-2 hover:underline"
          >
            Open the full entry →
          </Link>
        }
        below={
          e.pending && e.refId === gateId ? (
            <Pill tone="waiting">Waiting for approval, see above</Pill>
          ) : e.pending && e.refId === inCardId ? (
            <Pill tone="waiting">In Next step, above</Pill>
          ) : e.pending && e.actions.length > 0 ? (
            <EntryActions
              actions={e.actions}
              source={e.source}
              entryId={e.refId}
              recordId={record.id}
              editHref={href}
            />
          ) : undefined
        }
      />
    );
  };
  const all = query.log === "all";
  const toggle = (
    <nav aria-label="Activity view" className="flex gap-1">
      <Link href={workHref(query, { log: undefined })} className={TOGGLE} aria-current={!all ? "true" : undefined}>
        Activity
      </Link>
      <Link
        href={workHref(query, { log: "all" })}
        className={TOGGLE}
        aria-current={all ? "true" : undefined}
        title="Every recorded event, append-only: the audit trail"
      >
        All events
      </Link>
    </nav>
  );
  return (
    <Section
      id="activity-h"
      title="Activity"
      hint={all ? "every recorded event, append-only" : "newest first"}
      action={toggle}
    >
      {all ? (
        <AllEvents record={record} today={today} />
      ) : entries.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing has happened on this record yet.</p>
      ) : (
        <div className="-mt-3 -mb-5">
          <ActivityList>
            {pending.map(item)}
            {rest.slice(0, SHOWN).map(item)}
          </ActivityList>
          {rest.length > SHOWN && (
            <details className="group/more">
              <summary className="-mx-5 cursor-pointer list-none border-t border-line px-5 py-3 text-center text-[13px] font-semibold text-primary hover:bg-raised group-open/more:hidden [&::-webkit-details-marker]:hidden">
                Show {rest.length - SHOWN} earlier
              </summary>
              <ActivityList className="border-t border-line">{rest.slice(SHOWN).map(item)}</ActivityList>
            </details>
          )}
        </div>
      )}
    </Section>
  );
}
