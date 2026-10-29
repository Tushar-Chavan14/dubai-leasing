import type { Metadata } from "next";
import Link from "next/link";
import { Due, Empty, PageHead, Status } from "../../../components/ui";
import { get, publicGet } from "../../../lib/engine";
import { aedShort, longDate, milestoneLabel, shortDate } from "../../../lib/format";
import { IconKey } from "../../../lib/icons";
import type { LeaseRow } from "../../../lib/types";

export const metadata: Metadata = { title: "Leases" };

const FILTERS = [
  { key: "live", label: "Live", test: (s: string) => s !== "CLOSED" },
  { key: "renewal", label: "In renewal", test: (s: string) => s === "RENEWAL" },
  { key: "starting", label: "Starting", test: (s: string) => ["CONTRACT", "REGISTRATION", "MOVE_IN"].includes(s) },
  { key: "all", label: "All", test: () => true },
] as const;

export default async function LeasesPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const [leases, health] = await Promise.all([get<LeaseRow[]>("/api/leases"), publicGet<{ today: string }>("/health")]);
  const all = leases ?? [];
  const rows = all.filter((l) => filter.test(l.state));
  const today = health?.today ?? "";

  return (
    <>
      <PageHead
        title="Leases"
        lede="Sorted by end date. The next deadline is the earliest milestone still to come, in Dubai calendar days."
        actions={
          <Link href="/settings/import" className="btn">
            Import leases
          </Link>
        }
      />
      <nav className="tabs" aria-label="Filter leases">
        {FILTERS.map((f) => (
          <Link key={f.key} href={`/leases?show=${f.key}`} aria-current={f.key === filter.key ? "page" : undefined}>
            {f.label}
            <span className="n">{all.filter((l) => f.test(l.state)).length}</span>
          </Link>
        ))}
      </nav>
      <section className="panel">
        {rows.length === 0 ? (
          <Empty
            icon={<IconKey />}
            title={all.length ? "No leases match this filter" : "No leases yet"}
            action={
              all.length ? undefined : (
                <Link href="/settings/import" className="btn primary">
                  Import existing leases
                </Link>
              )
            }
          >
            {all.length
              ? undefined
              : "Import a CSV of current leases and their renewal deadlines are scheduled straight away."}
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Unit and tenant</th>
                  <th>State</th>
                  <th>Term</th>
                  <th className="num">Annual rent</th>
                  <th>Next deadline</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.id}>
                    <td>
                      <Link href={`/work?kind=lease&id=${l.id}`} className="row-title">
                        {l.unitCode}
                      </Link>
                      <div className="row-sub">{l.tenantName ?? "No tenant on record"}</div>
                    </td>
                    <td>
                      <Status value={l.state} />
                    </td>
                    <td className="nowrap">
                      {longDate(l.startOn)}
                      <div className="row-sub">to {longDate(l.endOn)}</div>
                    </td>
                    <td className="num">{aedShort(l.annualRentFils)}</td>
                    <td>
                      {l.nextDeadline ? (
                        <>
                          <div>{milestoneLabel(l.nextDeadline.milestone)}</div>
                          <div className="row-sub">
                            {shortDate(l.nextDeadline.dueOn)},{" "}
                            {today && <Due today={today} on={l.nextDeadline.dueOn} />}
                          </div>
                        </>
                      ) : (
                        <span className="muted">None scheduled</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
