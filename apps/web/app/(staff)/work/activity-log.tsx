import Link from "next/link";
import { stageLabel } from "../../../lib/stage-label";
import { AskAi, AskAiMenu } from "../../../components/ask-ai";
import { Pill } from "../../../components/ui/pill";
import { RecordStepper } from "../../../components/ui/stepper";
import { Section } from "../../../components/ui/record";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { logStamp } from "../../../lib/format";
import { type LogEntry, type RecordRow, STAGES } from "../../../lib/types";
import { DraftReplyButton } from "./draft-reply-button";
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
  return (
    <header className="grid gap-4">
      <Link
        href={workHref(query, { kind: record.kind, id: undefined, entry: undefined, pane: undefined })}
        className="w-fit text-[12.5px] text-muted! underline-offset-2 hover:underline @[760px]:hidden"
      >
        All records
      </Link>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-sans text-[26px] font-semibold leading-tight tracking-tight text-ink">
            {record.title}
          </h2>
          <p className="m-0 mt-1 text-sm text-muted">
            <span className="font-mono text-[12.5px]">{record.ref}</span> · {record.unitCode} ·{" "}
            {stageLabel(record.stage, record.emirate)}. {record.nextStep}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {proactiveDrafts && record.waitingOnReply && <DraftReplyButton record={record} />}
          <AskAiMenu
            label="Ask AI"
            prompts={
              record.kind === "lease" ? askPrompts.lease(record.ref) : askPrompts.application(record.title, record.ref)
            }
            {...(record.kind === "lease" ? { page: { kind: "lease" as const, id: record.id } } : {})}
          />
        </div>
      </div>
      <RecordStepper stages={STAGES} current={record.stage} labels={{ Ejari: stageLabel("Ejari", record.emirate) }} />
    </header>
  );
}

/** The log, newest first: a mono timestamp on the left, plain text on the right. Waiting entries are pinned on top with their buttons. */
export function ActivityLog({
  record,
  entries,
  query,
  today,
  meName,
  gateId,
}: {
  record: RecordRow;
  entries: LogEntry[];
  query: WorkQuery;
  today: string;
  meName: string;
  /** The approval shown as the gate panel above; its buttons live there, not here. */
  gateId?: string | undefined;
}) {
  const pending = entries.filter((e) => e.pending).toSorted(byTime);
  const rest = entries.filter((e) => !e.pending).toSorted(byTime);
  const item = (e: LogEntry) => {
    const href = workHref(query, { kind: record.kind, id: record.id, entry: e.refId, pane: undefined });
    const selected = query.entry === e.refId;
    const agent = e.actor.kind === "agent" || e.actor.kind === "system";
    return (
      <li
        key={`${e.source}:${e.refId}`}
        className="grid grid-cols-[88px_minmax(0,1fr)] gap-x-3 border-t border-line py-2.5 first:border-t-0"
      >
        <time dateTime={e.at} className="pt-0.5 font-mono text-xs tabular-nums text-muted">
          {logStamp(today, e.at)}
        </time>
        <div className="grid min-w-0 gap-1.5">
          <Link
            href={href}
            aria-current={selected ? "true" : undefined}
            className={`-mx-2 grid gap-0.5 rounded-lg px-2 py-0.5 no-underline hover:bg-raised aria-[current=true]:bg-raised focus-visible:outline-2 focus-visible:outline-ink ${e.pending ? "font-semibold" : ""}`}
          >
            <span className="leading-snug">{e.text}</span>
            <span className="text-xs font-normal text-muted">{actorChip(e, meName)}</span>
          </Link>
          {(e.pending && e.refId === gateId) || (e.source === "event" && agent) ? (
            <div className="flex flex-wrap items-center gap-2">
              {e.pending && e.refId === gateId && <Pill tone="waiting">Waiting for approval, see above</Pill>}
              {e.source === "event" && agent && (
                <AskAi
                  compact
                  prompt={askPrompts.logEntry(e.text)[0]!.prompt}
                  label={askPrompts.logEntry(e.text)[0]!.label}
                  {...(record.kind === "lease" ? { page: { kind: "lease" as const, id: record.id } } : {})}
                />
              )}
            </div>
          ) : null}
          {e.pending && e.actions.length > 0 && e.refId !== gateId && (
            <EntryActions
              actions={e.actions}
              source={e.source}
              entryId={e.refId}
              recordId={record.id}
              editHref={href}
            />
          )}
        </div>
      </li>
    );
  };
  return (
    <Section id="activity-h" title="Activity" hint="newest first">
      {entries.length === 0 ? (
        <p className="m-0 text-sm text-muted">Nothing has happened on this record yet.</p>
      ) : (
        <>
          <ol className="m-0 list-none p-0">
            {pending.map(item)}
            {rest.slice(0, SHOWN).map(item)}
          </ol>
          {rest.length > SHOWN && (
            <details className="group">
              <summary className="w-fit cursor-pointer text-[13px] font-semibold text-ink underline underline-offset-2 group-open:hidden">
                Show {rest.length - SHOWN} earlier
              </summary>
              <ol className="m-0 list-none border-t border-line p-0">{rest.slice(SHOWN).map(item)}</ol>
            </details>
          )}
        </>
      )}
    </Section>
  );
}
