import type { Metadata } from "next";
import Link from "next/link";
import { buttonClass } from "../../../components/ui/button";
import { Status } from "../../../components/ui";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageTitle, ROW_LINK, TabLinks, TableFrame } from "../../../components/ui/page";
import { get } from "../../../lib/engine";
import { aedShort, dateTime } from "../../../lib/format";

export const metadata: Metadata = { title: "Applicants" };

interface Row {
  id: string;
  ref: string | null;
  state: string;
  updatedAt: string;
  unitId: string;
  unitCode: string;
  building: string;
  applicant: string;
  kind: string;
  offer: { revision: number; annualRentFils: number } | null;
  offerAcceptedAt: string | null;
}

const OPEN = new Set(["ENQUIRY", "VIEWING", "SCREENING", "OFFER", "RESERVED"]);
const FILTERS = [
  { key: "open", label: "In progress", test: (r: Row) => OPEN.has(r.state) },
  { key: "all", label: "All", test: () => true },
] as const;

/** What a person should do next, in a few words. */
function next(r: Row): string {
  if (r.state === "ENQUIRY") return "Book site visit";
  if (r.state === "VIEWING") return "Record site visit outcome";
  if (r.state === "SCREENING") return "Waiting for documents or checks";
  if (r.state === "OFFER") return r.offerAcceptedAt ? "Record the reservation" : "Waiting for the applicant";
  if (r.state === "CONVERTED") return "Lease created";
  return "";
}

export default async function ApplicationsPage({ searchParams }: { searchParams: Promise<{ show?: string }> }) {
  const { show } = await searchParams;
  const filter = FILTERS.find((f) => f.key === show) ?? FILTERS[0];
  const all = (await get<Row[]>("/api/applications")) ?? [];
  const rows = all.filter(filter.test);
  return (
    <div className="grid gap-5">
      <PageTitle
        title="Applicants"
        lede="People applying for listed units: ID checks, offers and reservations, up to the lease being created."
        actions={
          <Link href="/applications/new" className={buttonClass("primary", "sm")}>
            New application
          </Link>
        }
      />
      <TabLinks
        label="Filter applications"
        items={FILTERS.map((f) => ({
          href: `/applications?show=${f.key}`,
          label: f.label,
          count: all.filter(f.test).length,
          current: f.key === filter.key,
        }))}
      />
      {rows.length === 0 ? (
        <EmptyState
          title={all.length ? "Nothing in progress" : "No applications yet"}
          body="Enter an applicant for a listed unit. They get a secure link to upload their ID documents."
          action={
            <Link href="/applications/new" className={buttonClass("primary", "sm")}>
              New application
            </Link>
          }
        />
      ) : (
        <TableFrame>
          <table className="data">
            <thead>
              <tr>
                <th>Applicant</th>
                <th>Unit</th>
                <th>State</th>
                <th className="num">Offer</th>
                <th>Next</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link href={`/work?kind=application&id=${r.id}`} className={ROW_LINK}>
                      {r.applicant}
                    </Link>
                    <div className="text-[12.5px] text-muted">
                      <span className="font-mono text-xs">{r.ref}</span>
                      {r.kind === "company" ? " · company" : ""}
                    </div>
                  </td>
                  <td>
                    {r.unitCode}
                    <div className="text-[12.5px] text-muted">{r.building}</div>
                  </td>
                  <td>
                    <Status value={r.state} />
                  </td>
                  <td className="num">
                    {r.offer ? aedShort(r.offer.annualRentFils) : <span className="text-muted">—</span>}
                    {r.offer && r.offer.revision > 1 && (
                      <div className="text-[12.5px] text-muted">revision {r.offer.revision}</div>
                    )}
                  </td>
                  <td>{next(r)}</td>
                  <td className="nowrap text-muted">{dateTime(r.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableFrame>
      )}
    </div>
  );
}
