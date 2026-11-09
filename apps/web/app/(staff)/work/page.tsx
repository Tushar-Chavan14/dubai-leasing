import type { Metadata } from "next";
import Link from "next/link";
import { get, publicGet } from "../../../lib/engine";
import type { Me, LogEntry, RecordRow, SavedView } from "../../../lib/types";
import type { UnitRow } from "../../../lib/types";
import { aedShort, bedroomsLabel } from "../../../lib/format";
import { LiveRefresh } from "../../../components/live/live-refresh";
import { ActivityLog, RecordHead } from "./activity-log";
import { RecordBody } from "./detail-pane";
import { NewApplicationSheet } from "./new-application-sheet";
import { RecordList } from "./record-list";
import { parseQuery, UUID_RE, workHref, type WorkQuery } from "./url";

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
  const units = query.new
    ? ((await get<UnitRow[]>("/api/units")) ?? []).filter((u) => u.state === "LISTED" && u.askingRentFils)
    : [];
  const entries = record ? ((await get<LogEntry[]>(`/api/records/${record.kind}/${record.id}/log`)) ?? []) : [];
  const gate = entries.find((e) => e.source === "approval" && e.pending) ?? null;
  const entry = query.entry ? (entries.find((e) => e.refId === query.entry) ?? null) : null;

  const apps = list.filter((r) => r.kind === "application").length;
  const leases = list.length - apps;
  const tab: "application" | "lease" = query.kind ?? (apps === 0 && leases > 0 ? "lease" : "application");
  const shown = list.filter((r) => r.kind === tab);
  const proactiveDrafts =
    policy?.autopilot?.copilot_proactive_drafts === true &&
    ["leasing_officer", "leasing_manager", "finance"].includes(me?.role ?? "");
  const today = health?.today ?? "";
  const hasRecord = !!record || !!approvalOnly || !!(query.kind && query.id);
  return (
    // One container for the whole screen: the columns collapse by the width left beside the rail and the dock,
    // so it works with the agent open or closed.
    <div className="group/wk @container h-dvh" data-has={hasRecord ? "true" : "false"} data-wk>
      <LiveRefresh record={record ? { kind: record.kind, id: record.id } : null} />
      <div className="grid h-full grid-cols-1 @[760px]:grid-cols-[320px_minmax(0,1fr)]">
        <RecordList
          rows={shown}
          views={views ?? []}
          query={query}
          tab={tab}
          mine={query.view === "waiting"}
          counts={{ application: apps, lease: leases }}
        />
        <section
          aria-label="Record"
          className="min-h-0 overflow-y-auto overscroll-contain px-5 py-6 @[900px]:px-7 @max-[759px]:group-data-[has=false]/wk:hidden"
        >
          {record ? (
            <div className="mx-auto grid max-w-[860px] gap-7">
              <RecordHead record={record} query={query} proactiveDrafts={proactiveDrafts} />
              <RecordBody
                query={query}
                record={record}
                entry={entry}
                gate={gate}
                approvalId={approvalOnly}
                activity={
                  <ActivityLog
                    record={record}
                    entries={entries}
                    query={query}
                    today={today}
                    meName={me?.name ?? ""}
                    // "See above" only when the gate panel is above: not when another entry is open.
                    gateId={!entry || entry.refId === gate?.refId ? gate?.refId : undefined}
                  />
                }
              />
            </div>
          ) : approvalOnly ? (
            <div className="mx-auto grid max-w-[860px] gap-7">
              <RecordBody query={query} record={null} entry={null} approvalId={approvalOnly} />
            </div>
          ) : query.kind && query.id ? (
            <p className="m-0 text-sm text-muted">
              This record is no longer on the pipeline.{" "}
              <Link href="/work" className="font-semibold text-ink! underline">
                Back to the Workspace
              </Link>
            </p>
          ) : (
            <p className="m-0 text-sm text-muted">Pick a record to see its activity.</p>
          )}
        </section>
      </div>
      <NewApplicationSheet
        open={query.new === true}
        closeHref={workHref(query, { new: undefined })}
        today={today}
        units={units.map((u) => ({
          id: u.id,
          label: `${u.code}, ${u.building} · ${bedroomsLabel(u.bedrooms)} · ${aedShort(u.askingRentFils)} a year`,
        }))}
      />
    </div>
  );
}
