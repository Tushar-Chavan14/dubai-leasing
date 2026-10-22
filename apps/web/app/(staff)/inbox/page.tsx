import type { StaffRole } from "@leasing/core";
import type { Metadata } from "next";
import Link from "next/link";
import { Due, Empty, PageHead, Status } from "../../../components/ui";
import { get, publicGet } from "../../../lib/engine";
import { actorLabel, canDecideApproval, roleLabel, shortDate } from "../../../lib/format";
import { IconInbox } from "../../../lib/icons";
import type { ApprovalRow, Me } from "../../../lib/types";

export const metadata: Metadata = { title: "Approvals" };

const TABS = [
  { key: "mine", label: "For me" },
  { key: "pending", label: "All waiting" },
  { key: "decided", label: "Decided" },
] as const;

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  const { view: raw } = await searchParams;
  const view = TABS.some((t) => t.key === raw) ? (raw as (typeof TABS)[number]["key"]) : "mine";
  const [me, health, pending, decided] = await Promise.all([
    get<Me>("/api/me"),
    publicGet<{ today: string }>("/health"),
    get<ApprovalRow[]>("/api/approvals?status=pending"),
    view === "decided" ? get<ApprovalRow[]>("/api/approvals?status=decided") : Promise.resolve([]),
  ]);
  const role = (me?.role ?? "") as StaffRole;
  const mine = (pending ?? []).filter((a) => canDecideApproval(a, me));
  const rows = view === "mine" ? mine : view === "pending" ? (pending ?? []) : (decided ?? []);
  const counts = { mine: mine.length, pending: pending?.length ?? 0, decided: undefined };
  const today = health?.today ?? "";

  return (
    <>
      <PageHead
        title="Approvals"
        lede="Every legal or money commitment waits here for a person. Proposals show their sources and the rule version they used."
      />
      <nav className="tabs" aria-label="Filter approvals">
        {TABS.map((t) => (
          <Link key={t.key} href={`/inbox?view=${t.key}`} aria-current={t.key === view ? "page" : undefined}>
            {t.label}
            {counts[t.key] !== undefined && <span className="n">{counts[t.key]}</span>}
          </Link>
        ))}
      </nav>
      <section className="panel">
        {rows.length === 0 ? (
          <Empty icon={<IconInbox />} title={view === "decided" ? "Nothing decided yet" : "Nothing waiting"}>
            {view === "mine"
              ? `Proposals that a ${roleLabel(role).toLowerCase()} can decide will appear here.`
              : "Proposals appear when a milestone, rule or helper needs a person."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Proposal</th>
                  <th>Approver</th>
                  <th>Proposed</th>
                  <th>{view === "decided" ? "Outcome" : "Deadline"}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const deadline = typeof a.proposal.legalDeadline === "string" ? a.proposal.legalDeadline : null;
                  return (
                    <tr key={a.id}>
                      <td>
                        <Link href={`/inbox/${a.id}`} className="row-title">
                          {a.title}
                        </Link>
                        <div className="row-sub">{a.gateLabel}</div>
                      </td>
                      <td className="nowrap">{roleLabel(a.approverRole)}</td>
                      <td className="nowrap">
                        {shortDate(a.createdAt.slice(0, 10))}
                        <div className="row-sub">{actorLabel(a.proposedBy)}</div>
                      </td>
                      <td className="nowrap">
                        {view === "decided" ? (
                          <Status value={a.status} />
                        ) : deadline && today ? (
                          <>
                            {shortDate(deadline)} <Due today={today} on={deadline} warnWithin={30} />
                          </>
                        ) : (
                          <span className="muted">None set</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
