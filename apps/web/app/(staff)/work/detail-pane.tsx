import Link from "next/link";
import type { ReactNode } from "react";
import { AskAi } from "../../../components/ask-ai";
import { ApplicationDetail } from "../../../components/application-detail";
import { ApprovalDetail } from "../../../components/approval-detail";
import { LeaseDetail } from "../../../components/lease-detail";
import { Status } from "../../../components/ui";
import { buttonClass } from "../../../components/ui/button";
import { FactList, FactKey, FactVal, Section } from "../../../components/ui/record";
import { askPrompts } from "../../../lib/ask-ai/prompts";
import { get } from "../../../lib/engine";
import { actorLabel, dateTime, eventLabel, humanise, proposalValue } from "../../../lib/format";
import type { LogEntry, RecordRow } from "../../../lib/types";
import { type WorkQuery, workHref } from "./url";

/** Fields that can carry personal data are never printed in the pane (rule 8). */
const PERSONAL = /emirates|passport|visa|phone|mobile|idno|eid/i;
const SKIP = new Set(["id", "previewUrl", "leaseId", "applicationId", "unitId"]);

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
    <div className="grid gap-6">
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
}: {
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
    return (
      <ApprovalDetail
        id={approvalId}
        draftId={query.draft}
        ask={
          <AskAi
            onAccent
            compact
            prompt={askPrompts.gate("approval request", "this request")[0]!.prompt}
            label="Ask AI"
            page={{ kind: "approval", id: approvalId }}
          />
        }
      />
    );
  }
  if (!record) return null;
  const gateAsk = (id: string) => {
    const ask = askPrompts.gate("approval request", `${record.kind} ${record.ref} (${record.title})`)[0]!;
    return <AskAi onAccent compact prompt={ask.prompt} label={ask.label} page={{ kind: "approval", id }} />;
  };
  if (entry) {
    return (
      <div className="grid gap-5">
        <div className="flex flex-wrap items-center gap-3">
          <Link href={workHref(query, { entry: undefined })} className={buttonClass("ghost", "sm")}>
            Whole record
          </Link>
          <Status value={entry.pending ? "pending" : "done"} label={entry.pending ? "Waiting" : "Recorded"} />
        </div>
        {entry.source === "approval" ? (
          <ApprovalDetail
            id={entry.refId}
            draftId={query.draft}
            ask={entry.pending ? gateAsk(entry.refId) : undefined}
            after={activity}
          />
        ) : (
          <>
            <EntryDetail record={record} entry={entry} />
            {activity}
          </>
        )}
      </div>
    );
  }
  return (
    <div className="grid gap-8">
      {gate ? (
        <ApprovalDetail id={gate.refId} draftId={query.draft} ask={gateAsk(gate.refId)} compact after={activity} />
      ) : (
        activity
      )}
      {record.kind === "application" ? (
        <ApplicationDetail id={record.id} draftId={query.draft} />
      ) : (
        <LeaseDetail id={record.id} draftId={query.draft} />
      )}
    </div>
  );
}
