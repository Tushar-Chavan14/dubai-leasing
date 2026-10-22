import type { StaffRole } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Due, Empty, PageHead, Status } from "../../components/ui";
import { get, publicGet } from "../../lib/engine";
import {
  aedShort,
  canDecideApproval,
  daysUntil,
  milestoneLabel,
  roleLabel,
  shortDate,
  weekdayDate,
} from "../../lib/format";
import { IconCheck, IconInbox } from "../../lib/icons";
import type { ApprovalRow, DeadlineRow, LeaseRow, Me, TaskRow, UnitRow } from "../../lib/types";

export const metadata: Metadata = { title: "Overview" };

const LEASE_MIX: { state: string; label: string; color: string }[] = [
  { state: "ACTIVE", label: "Active", color: "var(--accent)" },
  { state: "RENEWAL", label: "In renewal", color: "var(--warn)" },
  { state: "MOVE_IN", label: "Moving in", color: "color-mix(in srgb, var(--accent) 45%, var(--surface-3))" },
  { state: "REGISTRATION", label: "Registering", color: "color-mix(in srgb, var(--accent) 25%, var(--surface-3))" },
  { state: "MOVE_OUT", label: "Moving out", color: "color-mix(in srgb, var(--warn) 50%, var(--surface-3))" },
  { state: "DISPUTE", label: "Dispute", color: "var(--bad)" },
];

export default async function OverviewPage() {
  const [me, health, approvals, deadlines, leases, units, tasks] = await Promise.all([
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
    get<ApprovalRow[]>("/api/approvals?status=pending"),
    get<DeadlineRow[]>("/api/deadlines?days=60"),
    get<LeaseRow[]>("/api/leases"),
    get<UnitRow[]>("/api/units"),
    get<TaskRow[]>("/api/tasks"),
  ]);
  const today = health?.today ?? "";
  const role = (me?.role ?? "") as StaffRole;
  const pending = approvals ?? [];
  const mine = pending.filter((a) => canDecideApproval(a, me));
  const others = pending.length - mine.length;
  const live = (leases ?? []).filter((l) => l.state !== "CLOSED");
  const soon = (deadlines ?? []).slice(0, 8);
  const unitList = units ?? [];
  const vacant = unitList.filter((u) => u.state !== "OCCUPIED").length;
  const legalSoon = (deadlines ?? []).filter(
    (d) => d.milestone.startsWith("notice_deadline") && daysUntil(today, d.dueOn) <= 30,
  ).length;

  return (
    <>
      <PageHead
        title="Overview"
        lede={
          today
            ? `${weekdayDate(today)} in Dubai. ${mine.length ? `${mine.length} ${mine.length === 1 ? "decision is" : "decisions are"} waiting for you.` : "Nothing is waiting for your decision."}`
            : undefined
        }
      />

      <div className="figure-row fade-in">
        <Link href="/inbox" className="figure" {...(mine.length ? { "data-tone": "good" } : {})}>
          <b>{mine.length}</b>
          <span>For your decision</span>
        </Link>
        <Link href="/leases" className="figure" {...(legalSoon ? { "data-tone": "warn" } : {})}>
          <b>{legalSoon}</b>
          <span>Legal notice deadlines in 30 days</span>
        </Link>
        <Link href="/tasks" className="figure">
          <b>{tasks?.length ?? 0}</b>
          <span>Open tasks</span>
        </Link>
        <Link href="/units" className="figure">
          <b>
            {vacant}
            <span className="muted" style={{ fontSize: 18 }}>
              {" "}
              / {unitList.length}
            </span>
          </b>
          <span>Units not occupied</span>
        </Link>
      </div>

      <div className="overview-grid">
        <div className="stack">
          <section className="panel" aria-labelledby="decide-h">
            <div className="panel-head">
              <h2 id="decide-h">Waiting for your decision</h2>
              <span className="hint">
                {roleLabel(role)}
                {others > 0 ? `, ${others} more waiting for other roles` : ""}
              </span>
            </div>
            {mine.length === 0 ? (
              <Empty compact icon={<IconCheck />} title="You're clear">
                New proposals land here when a deadline or a rule needs a person to decide.
              </Empty>
            ) : (
              <ul className="list">
                {mine.slice(0, 6).map((a) => {
                  const deadline = typeof a.proposal.legalDeadline === "string" ? a.proposal.legalDeadline : null;
                  return (
                    <li key={a.id}>
                      <Link href={`/inbox/${a.id}`} className="list-row">
                        <div>
                          <div className="title">{a.title}</div>
                          <div className="meta">
                            <span>{a.gateLabel}</span>
                            <span>Proposed {shortDate(a.createdAt.slice(0, 10))}</span>
                          </div>
                        </div>
                        <div className="side">
                          {deadline && today ? (
                            <>
                              <Due today={today} on={deadline} warnWithin={30} />
                              <span className="row-sub">legal deadline</span>
                            </>
                          ) : (
                            <Status value="pending" />
                          )}
                        </div>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel panel-pad" aria-labelledby="mix-h">
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12 }}>
              <h2 id="mix-h" className="section-title" style={{ margin: 0 }}>
                Leases
              </h2>
              <Link className="link" href="/leases">
                {live.length} live {live.length === 1 ? "lease" : "leases"}
              </Link>
            </div>
            {live.length ? (
              <>
                <div className="mix" role="img" aria-label="Leases by state">
                  {LEASE_MIX.map((m) => {
                    const n = live.filter((l) => l.state === m.state).length;
                    return n ? (
                      <i key={m.state} style={{ flex: n, background: m.color }} title={`${m.label}: ${n}`} />
                    ) : null;
                  })}
                </div>
                <div className="legend">
                  {LEASE_MIX.map((m) => {
                    const n = live.filter((l) => l.state === m.state).length;
                    return n ? (
                      <span key={m.state}>
                        <i style={{ background: m.color }} />
                        {m.label} <b className="num">{n}</b>
                      </span>
                    ) : null;
                  })}
                </div>
              </>
            ) : (
              <p className="muted" style={{ marginTop: 10 }}>
                No leases yet.{" "}
                <Link className="link" href="/import">
                  Import existing leases
                </Link>{" "}
                to start tracking their deadlines.
              </p>
            )}
            {live.length > 0 && (
              <>
                <div className="divider" />
                <table className="data bleed">
                  <thead>
                    <tr>
                      <th>Lease</th>
                      <th>Ends</th>
                      <th className="num">Annual rent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {live.slice(0, 4).map((l) => (
                      <tr key={l.id}>
                        <td>
                          <Link href={`/leases/${l.id}`} className="row-title">
                            {l.unitCode}
                          </Link>{" "}
                          <span className="row-sub">{l.tenantName}</span>
                        </td>
                        <td className="nowrap">
                          {shortDate(l.endOn)} {today && <Due today={today} on={l.endOn} warnWithin={100} />}
                        </td>
                        <td className="num">{aedShort(l.annualRentFils)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </section>
        </div>

        <aside className="panel" aria-labelledby="soon-h">
          <div className="panel-head">
            <h2 id="soon-h">Coming up</h2>
            <span className="hint">next 60 days</span>
          </div>
          {soon.length === 0 ? (
            <Empty compact icon={<IconInbox />} title="No deadlines in the next 60 days" />
          ) : (
            <ul className="rail">
              {soon.map((d) => {
                const n = today ? daysUntil(today, d.dueOn) : 99;
                const tone = n < 0 ? "bad" : n <= 14 ? "warn" : undefined;
                const [day, mon] = shortDate(d.dueOn).split(" ");
                return (
                  <li key={d.id} {...(tone ? { "data-tone": tone } : {})}>
                    <Link href={`/leases/${d.leaseId}`}>
                      <span className="day">
                        <b>{day}</b>
                        <span>{mon}</span>
                      </span>
                      <span className="what">
                        <strong>{milestoneLabel(d.milestone)}</strong>
                        <span>
                          {d.unitCode}, {today ? <Due today={today} on={d.dueOn} /> : null}
                        </span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>
      </div>
    </>
  );
}
