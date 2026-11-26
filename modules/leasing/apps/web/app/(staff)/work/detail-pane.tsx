import Link from "next/link";
import type { ReactNode } from "react";
import { ApplicationDetail } from "../../../components/application-detail";
import { ApprovalDetail } from "../../../components/approval-detail";
import { LeaseDetail } from "../../../components/lease-detail";
import { Status } from "../../../components/ui";
import { buttonClass } from "@platform/ui/button";
import { FactList, FactKey, FactVal, Section } from "@platform/ui/record";
import { get } from "../../../lib/engine";
import { actorLabel, dateTime, eventLabel, humanise, proposalValue } from "../../../lib/format";
import type { LogEntry, RecordRow } from "../../../lib/types";
import { EntryActions } from "./entry-actions";
import { type WorkQuery, workHref } from "./url";

/** Fields that can carry personal data are never printed in the pane (rule 8). */
const PERSONAL = /emirates|passport|visa|phone|mobile|idno|eid/i;
// `model`: the model tag is an internal detail (helper_runs keeps it for audit); people see "the leasing agent".
const SKIP = new Set(["id", "previewUrl", "leaseId", "applicationId", "unitId", "model"]);

function Facts({ data }: { data: Record<string, unknown> }) {
  const rows = Object.entries(data).filter(([k, v]) => !SKIP.has(k) && v !== null && v !== undefined && v !== "");
  if (rows.length === 0) return <p className="m-0 text-sm text-muted">No further details were recorded.</p>;
  return (
    <FactList>
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <FactKey>{humanise(k)}</FactKey>
          <FactVal className={/sha256|messageId/i.test(k) ? "font-mono text-xs" : ""}>
            {PERSONAL.test(k)
              ? "Hidden (personal data)"
              : Array.isArray(v)
                ? v.join(", ") || "None"
                : proposalValue(k, v)}
          </FactVal>
        </div>
      ))}
    </FactList>
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
    <div className="grid gap-4">
      <Section
        id="entry-h"
        title={event ? eventLabel(event.type) : mail ? "Email evidence" : task ? "Task" : "Entry"}
        hint={event ? `${actorLabel(event.actor)}, ${dateTime(event.at)}` : undefined}
      >
        <p className="m-0 text-sm">{entry.text}</p>
      </Section>
      {event && (
        <Section id="payload-h" title="What was recorded">
          <Facts data={event.payload ?? {}} />
        </Section>
      )}
      {mail && (
        <Section id="mail-h" title="Stored with the message">
          <Facts data={mail} />
          {typeof mail.previewUrl === "string" && (
            <div>
              <a className={buttonClass("ghost", "sm")} href={mail.previewUrl} target="_blank" rel="noreferrer">
                View in test inbox
              </a>
            </div>
          )}
        </Section>
      )}
      {task && (
        <Section id="task-h" title="Task details">
          <Facts data={task} />
        </Section>
      )}
      {!event && !mail && !task && <p className="m-0 text-sm text-muted">No further details for this entry.</p>}
    </div>
  );
}

/** The record's body under its header: the waiting gate and the whole record, or the one entry (or approval) that was opened. */
export async function RecordBody({
  query,
  record,
  entry,
  gate = null,
  approvalId,
  activity,
  nextEntry = null,
  viewingPassed = false,
}: {
  /** The waiting task the Next step card carries, with its own buttons. */
  nextEntry?: LogEntry | null;
  /** The site visit time has passed: the no-show option may show. */
  viewingPassed?: boolean;
  /** The record's activity, shown right under the gate (or the entry) and above the details. */
  activity?: ReactNode;
  /** The record's first approval that waits on a person; pinned at the top of the record. */
  gate?: LogEntry | null;
  query: WorkQuery;
  record: RecordRow | null;
  entry: LogEntry | null;
  /** An approval that has no record in the Workspace (for example one on a unit). */
  approvalId?: string | undefined;
}) {
  if (!record && approvalId) {
    return <ApprovalDetail id={approvalId} draftId={query.draft} />;
  }
  if (!record) return null;
  if (entry) {
    return (
      <div className="grid gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={workHref(query, { entry: undefined })} className={buttonClass("ghost", "sm")}>
            Whole record
          </Link>
          <Status value={entry.pending ? "pending" : "done"} label={entry.pending ? "Waiting" : "Recorded"} />
        </div>
        {entry.source === "approval" ? (
          <ApprovalDetail id={entry.refId} draftId={query.draft} after={activity} />
        ) : (
          <>
            <EntryDetail record={record} entry={entry} />
            {activity}
          </>
        )}
      </div>
    );
  }
  const editHref = (e: LogEntry) =>
    workHref(query, { kind: record.kind, id: record.id, entry: e.refId, pane: undefined });
  const pendingAction = nextEntry ? (
    <div className="grid gap-2.5">
      <p className="m-0 text-sm font-semibold">{nextEntry.text}</p>
      <EntryActions
        actions={nextEntry.actions}
        source={nextEntry.source}
        entryId={nextEntry.refId}
        recordId={record.id}
        editHref={editHref(nextEntry)}
      />
    </div>
  ) : undefined;
  return (
    <div className="grid gap-4">
      {gate && <ApprovalDetail id={gate.refId} draftId={query.draft} compact />}
      {/* Every stage has a Next step card: an approval waiting on you is its own card above; otherwise this one. */}
      {!gate && record.kind === "lease" && (record.nextStep || pendingAction) && (
        <Section id="next-h" title="Next step" highlight>
          {record.nextStep && <p className="m-0 text-sm">{record.nextStep}</p>}
          {pendingAction}
        </Section>
      )}
      {/* The activity log comes last, after the record's details and documents. */}
      {record.kind === "application" ? (
        <ApplicationDetail
          id={record.id}
          draftId={query.draft}
          activity={activity}
          pendingAction={gate ? undefined : pendingAction}
          nextStep={gate ? undefined : record.nextStep}
          viewingPassed={viewingPassed}
        />
      ) : (
        <LeaseDetail id={record.id} draftId={query.draft} activity={activity} />
      )}
    </div>
  );
}
