import type { Metadata } from "next";
import Link from "next/link";
import { get, publicGet } from "../../../lib/engine";
import type { Me, LogEntry, RecordRow, SavedView } from "../../../lib/types";
import { LiveRefresh } from "../../../components/live/live-refresh";
import { ActivityLog } from "./activity-log";
import { DetailPane } from "./detail-pane";
import { RecordList } from "./record-list";
import { parseQuery, UUID_RE, type WorkQuery } from "./url";

export const metadata: Metadata = { title: "Workspace" };

export default async function WorkPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { approval, ...parsed } = parseQuery(await searchParams);
  const query: WorkQuery = { ...parsed };

  // Old inbox links name an approval; open the record that owns it with that entry selected.
  let approvalOnly: string | undefined;
  if (approval && !(query.kind && query.id)) {
    const a = await get<{ entity: { kind: string; id: string } | null }>(`/api/approvals/${approval}`);
    if (a?.entity && (a.entity.kind === "application" || a.entity.kind === "lease")) {
      query.kind = a.entity.kind;
      query.id = a.entity.id;
      query.entry = approval;
    } else if (a) approvalOnly = approval;
    query.pane = query.pane ?? "open";
  }

  const params = new URLSearchParams();
  if (query.view === "waiting") params.set("mine", "1");
  else if (query.view && UUID_RE.test(query.view)) params.set("view", query.view);
  if (query.q) params.set("q", query.q);
  if (query.stage) params.set("stage", query.stage);

  const [me, health, rows, views, policy] = await Promise.all([
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
    get<RecordRow[]>(`/api/records?${params}`),
    get<SavedView[]>("/api/views"),
    get<{ autopilot?: { copilot_proactive_drafts?: boolean } }>("/api/policy"),
  ]);
  const list = rows ?? [];

  let record = list.find((r) => r.kind === query.kind && r.id === query.id) ?? null;
  if (!record && query.kind && query.id) {
    const all = await get<RecordRow[]>("/api/records");
    record = (all ?? []).find((r) => r.kind === query.kind && r.id === query.id) ?? null;
  }
  const entries = record ? ((await get<LogEntry[]>(`/api/records/${record.kind}/${record.id}/log`)) ?? []) : [];
  const entry = query.entry ? (entries.find((e) => e.refId === query.entry) ?? null) : null;

  return (
    <div
      className="wk"
      data-pane={query.pane === "closed" ? "closed" : "open"}
      data-wide={query.wide ? "true" : undefined}
    >
      <LiveRefresh record={record ? { kind: record.kind, id: record.id } : null} />
      <RecordList rows={list} views={views ?? []} query={query} mine={query.view === "waiting"} />
      <div className="wk-centre">
        {record ? (
          <ActivityLog
            record={record}
            entries={entries}
            query={query}
            today={health?.today ?? ""}
            meName={me?.name ?? ""}
            proactiveDrafts={
              policy?.autopilot?.copilot_proactive_drafts === true &&
              ["leasing_officer", "leasing_manager", "finance"].includes(me?.role ?? "")
            }
          />
        ) : query.kind && query.id ? (
          <p className="wk-empty wk-empty-centre">
            This record is no longer on the pipeline. <Link href="/work">Back to the Workspace</Link>
          </p>
        ) : (
          <p className="wk-empty wk-empty-centre">Pick a record to see its activity.</p>
        )}
      </div>
      <DetailPane query={query} record={record} entry={entry} approvalId={approvalOnly} />
    </div>
  );
}
