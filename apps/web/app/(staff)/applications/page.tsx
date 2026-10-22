import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { aedShort, dateTime } from "../../../lib/format";
import { IconPeople } from "../../../lib/icons";

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
  if (r.state === "ENQUIRY") return "Book viewing";
  if (r.state === "VIEWING") return "Record viewing outcome";
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
    <>
      <PageHead
        title="Applicants"
        lede="People applying for listed units: ID checks, offers and reservations, up to the lease being created."
        actions={
          <Link href="/applications/new" className="btn primary">
            New application
          </Link>
        }
      />
      <nav className="tabs" aria-label="Filter applications">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={`/applications?show=${f.key}`}
            aria-current={f.key === filter.key ? "page" : undefined}
          >
            {f.label}
            <span className="n">{all.filter(f.test).length}</span>
          </Link>
        ))}
      </nav>
      <section className="panel">
        {rows.length === 0 ? (
          <Empty
            icon={<IconPeople />}
            title={all.length ? "Nothing in progress" : "No applications yet"}
            action={
              <Link href="/applications/new" className="btn primary">
                New application
              </Link>
            }
          >
            Enter an applicant for a listed unit. They get a secure link to upload their ID documents.
          </Empty>
        ) : (
          <div className="table-wrap">
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
                      <Link href={`/applications/${r.id}`} className="row-title">
                        {r.applicant}
                      </Link>
                      <div className="row-sub">
                        <span className="ref">{r.ref}</span>
                        {r.kind === "company" ? " · company" : ""}
                      </div>
                    </td>
                    <td>
                      {r.unitCode}
                      <div className="row-sub">{r.building}</div>
                    </td>
                    <td>
                      <Status value={r.state} />
                    </td>
                    <td className="num">
                      {r.offer ? aedShort(r.offer.annualRentFils) : <span className="muted">—</span>}
                      {r.offer && r.offer.revision > 1 && <div className="row-sub">revision {r.offer.revision}</div>}
                    </td>
                    <td>{next(r)}</td>
                    <td className="nowrap muted">{dateTime(r.updatedAt)}</td>
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
