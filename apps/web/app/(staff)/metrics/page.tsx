import type { Metadata } from "next";
import { Empty, PageHead, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { aedShort, shortDate } from "../../../lib/format";

export const metadata: Metadata = { title: "Metrics" };

interface Metrics {
  today: string;
  enquiryToRegistered: {
    medianDays: number | null;
    count: number;
    rows: { lease: string; from: string; startedOn: string; ejariIssuedOn: string; days: number }[];
  };
  ejariRejectionRate: {
    percent: number | null;
    rejected: number;
    submissions: number;
    rows: { lease: string; submissions: number; rejected: number }[];
  };
  noticesOnTime: {
    percent: number | null;
    onTime: number;
    due: number;
    rows: { lease: string; termEnd: string; sendBy: string; sentOn: string | null; onTime: boolean }[];
  };
  rentOverdue: {
    open: number;
    maxDays: number | null;
    totalFils: number;
    rows: { lease: string; seq: number; dueOn: string; amountFils: number; status: string; days: number }[];
  };
  depositReturn: {
    medianDays: number | null;
    count: number;
    rows: { lease: string; inspectedOn: string; paidOn: string; days: number }[];
  };
}

const days = (n: number | null) => (n === null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);
const pct = (n: number | null) => (n === null ? "—" : `${n}%`);

function Tile({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="panel kpi">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="muted" style={{ fontSize: 12.5 }}>
        {sub}
      </div>
    </div>
  );
}

/** The five KPIs from the leasing guide (docs/specs.md §8), from records only, with the rows behind each. */
export default async function MetricsPage() {
  const m = await get<Metrics>("/api/metrics");
  if (!m) return <Empty title="Metrics unavailable" />;
  const e = m.enquiryToRegistered;
  const r = m.ejariRejectionRate;
  const n = m.noticesOnTime;
  const o = m.rentOverdue;
  const d = m.depositReturn;
  return (
    <>
      <PageHead
        title="Metrics"
        lede={
          <>
            The five measures from the leasing guide, as of {shortDate(m.today)}. Every figure links to its rows below.
          </>
        }
      />
      <div className="kpi-grid section">
        <Tile label="Enquiry → registered lease" value={days(e.medianDays)} sub={`median, ${e.count} lease(s)`} />
        <Tile label="Ejari rejection rate" value={pct(r.percent)} sub={`${r.rejected} of ${r.submissions} answers`} />
        <Tile label="Notices on time (T−100)" value={pct(n.percent)} sub={`${n.onTime} of ${n.due} due`} />
        <Tile
          label="Rent overdue"
          value={o.open ? days(o.maxDays) : "None"}
          sub={o.open ? `longest; ${o.open} open, ${aedShort(o.totalFils)}` : "no overdue or bounced instalments"}
        />
        <Tile label="Deposit return time" value={days(d.medianDays)} sub={`median, ${d.count} refund(s)`} />
      </div>

      <Section title="Rent overdue" empty={!o.rows.length}>
        <thead>
          <tr>
            <th>Lease</th>
            <th>Instalment</th>
            <th>Due</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Days overdue</th>
          </tr>
        </thead>
        <tbody>
          {o.rows.map((p) => (
            <tr key={`${p.lease}-${p.seq}`}>
              <td>{p.lease}</td>
              <td>{p.seq}</td>
              <td>{shortDate(p.dueOn)}</td>
              <td>{aedShort(p.amountFils)}</td>
              <td>
                <Status value={p.status} />
              </td>
              <td>{p.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Renewal notices" empty={!n.rows.length}>
        <thead>
          <tr>
            <th>Lease</th>
            <th>Term ends</th>
            <th>Send by (T−100)</th>
            <th>Sent</th>
            <th>On time</th>
          </tr>
        </thead>
        <tbody>
          {n.rows.map((x) => (
            <tr key={`${x.lease}-${x.termEnd}`}>
              <td>{x.lease}</td>
              <td>{shortDate(x.termEnd)}</td>
              <td>{shortDate(x.sendBy)}</td>
              <td>{x.sentOn ? shortDate(x.sentOn) : "not sent"}</td>
              <td>{x.onTime ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Ejari submissions" empty={!r.rows.length}>
        <thead>
          <tr>
            <th>Lease</th>
            <th>Answers</th>
            <th>Rejected</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr key={x.lease}>
              <td>{x.lease}</td>
              <td>{x.submissions}</td>
              <td>{x.rejected}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Enquiry to registered lease" empty={!e.rows.length}>
        <thead>
          <tr>
            <th>Lease</th>
            <th>From</th>
            <th>Started</th>
            <th>Ejari issued</th>
            <th>Days</th>
          </tr>
        </thead>
        <tbody>
          {e.rows.map((x) => (
            <tr key={x.lease}>
              <td>{x.lease}</td>
              <td>{x.from}</td>
              <td>{shortDate(x.startedOn)}</td>
              <td>{shortDate(x.ejariIssuedOn)}</td>
              <td>{x.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Deposit returns" empty={!d.rows.length}>
        <thead>
          <tr>
            <th>Lease</th>
            <th>Inspected</th>
            <th>Refund paid</th>
            <th>Days</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((x) => (
            <tr key={x.lease}>
              <td>{x.lease}</td>
              <td>{shortDate(x.inspectedOn)}</td>
              <td>{shortDate(x.paidOn)}</td>
              <td>{x.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>
    </>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section className="panel section" aria-label={title}>
      <div className="panel-head">
        <h2>{title}</h2>
      </div>
      {empty ? (
        <p className="muted panel-pad">Nothing to show yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="data">{children}</table>
        </div>
      )}
    </section>
  );
}
