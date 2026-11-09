import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "../../../components/ui/button";
import { Due, Status } from "../../../components/ui";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageTitle, ROW_LINK, TabLinks, TableFrame } from "../../../components/ui/page";
import { get, publicGet } from "../../../lib/engine";
import { aedShort, longDate, milestoneLabel, shortDate } from "../../../lib/format";
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
    <div className="grid gap-5">
      <PageTitle
        title="Leases"
        lede="Sorted by end date. The next deadline is the earliest milestone still to come, in Dubai calendar days."
        actions={
          <Link href="/settings/import" className={buttonClass("ghost", "sm")}>
            Import leases
          </Link>
        }
      />
      <TabLinks
        label="Filter leases"
        items={FILTERS.map((f) => ({
          href: `/leases?show=${f.key}`,
          label: f.label,
          count: all.filter((l) => f.test(l.state)).length,
          current: f.key === filter.key,
        }))}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={all.length ? "No leases match this filter" : "No leases yet"}
          {...(all.length
            ? {}
            : {
                body: "Import a CSV of current leases and their renewal deadlines are scheduled straight away.",
                action: (
                  <Link href="/settings/import" className={buttonClass("primary", "sm")}>
                    Import existing leases
                  </Link>
                ),
              })}
        />
      ) : (
        <TableFrame>
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
                    <Link href={`/work?kind=lease&id=${l.id}`} className={ROW_LINK}>
                      {l.unitCode}
                    </Link>
                    <div className="text-[12.5px] text-muted">{l.tenantName ?? "No tenant on record"}</div>
                  </td>
                  <td>
                    <Status value={l.state} />
                  </td>
                  <td className="nowrap">
                    {longDate(l.startOn)}
                    <div className="text-[12.5px] text-muted">to {longDate(l.endOn)}</div>
                  </td>
                  <td className="num">{aedShort(l.annualRentFils)}</td>
                  <td>
                    {l.nextDeadline ? (
                      <>
                        <div>{milestoneLabel(l.nextDeadline.milestone)}</div>
                        <div className="text-[12.5px] text-muted">
                          {shortDate(l.nextDeadline.dueOn)}, {today && <Due today={today} on={l.nextDeadline.dueOn} />}
                        </div>
                      </>
                    ) : (
                      <span className="text-muted">None scheduled</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
