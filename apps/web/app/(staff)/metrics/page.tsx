import type { Metadata } from "next";
import { Status } from "../../../components/ui";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageTitle, TableFrame } from "../../../components/ui/page";
import { TABLE, TD, TH } from "../../../components/ui/settings";
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

function Tile({ label, value, sub, filled = false }: { label: string; value: string; sub: string; filled?: boolean }) {
  return (
    <div
      className={`grid content-start gap-1 rounded-card border p-4 ${filled ? "border-transparent bg-accent text-on-accent" : "border-line bg-page text-ink"}`}
    >
      <div className={`text-[12.5px] font-medium ${filled ? "text-on-accent/70" : "text-muted"}`}>{label}</div>
      <div className="font-sans text-[28px] font-semibold leading-tight tracking-tight tabular-nums">{value}</div>
      <div className={`text-[12.5px] ${filled ? "text-on-accent/70" : "text-muted"}`}>{sub}</div>
    </div>
  );
}

/** The five KPIs from the leasing guide (docs/specs.md §8), from records only, with the rows behind each. */
export default async function MetricsPage() {
  const m = await get<Metrics>("/api/metrics");
  if (!m) return <EmptyState title="Metrics unavailable" />;
  const e = m.enquiryToRegistered;
  const r = m.ejariRejectionRate;
  const n = m.noticesOnTime;
  const o = m.rentOverdue;
  const d = m.depositReturn;
  return (
    <div className="grid gap-6">
      <PageTitle
        title="Metrics"
        lede={
          <>
            The five measures from the leasing guide, as of {shortDate(m.today)}. Every figure links to its rows below.
          </>
        }
      />
      <div className="grid grid-cols-[repeat(auto-fill,minmax(160px,1fr))] gap-3">
        <Tile
          filled
          label="Enquiry → registered lease"
          value={days(e.medianDays)}
          sub={`median, ${e.count} lease(s)`}
        />
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
            <th className={TH}>Lease</th>
            <th className={TH}>Instalment</th>
            <th className={TH}>Due</th>
            <th className={TH}>Amount</th>
            <th className={TH}>Status</th>
            <th className={TH}>Days overdue</th>
          </tr>
        </thead>
        <tbody>
          {o.rows.map((p) => (
            <tr className="group" key={`${p.lease}-${p.seq}`}>
              <td className={TD}>{p.lease}</td>
              <td className={TD}>{p.seq}</td>
              <td className={TD}>{shortDate(p.dueOn)}</td>
              <td className={TD}>{aedShort(p.amountFils)}</td>
              <td className={TD}>
                <Status value={p.status} />
              </td>
              <td className={TD}>{p.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Renewal notices" empty={!n.rows.length}>
        <thead>
          <tr>
            <th className={TH}>Lease</th>
            <th className={TH}>Term ends</th>
            <th className={TH}>Send by (T−100)</th>
            <th className={TH}>Sent</th>
            <th className={TH}>On time</th>
          </tr>
        </thead>
        <tbody>
          {n.rows.map((x) => (
            <tr className="group" key={`${x.lease}-${x.termEnd}`}>
              <td className={TD}>{x.lease}</td>
              <td className={TD}>{shortDate(x.termEnd)}</td>
              <td className={TD}>{shortDate(x.sendBy)}</td>
              <td className={TD}>{x.sentOn ? shortDate(x.sentOn) : "not sent"}</td>
              <td className={TD}>{x.onTime ? "Yes" : "No"}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Ejari submissions" empty={!r.rows.length}>
        <thead>
          <tr>
            <th className={TH}>Lease</th>
            <th className={TH}>Answers</th>
            <th className={TH}>Rejected</th>
          </tr>
        </thead>
        <tbody>
          {r.rows.map((x) => (
            <tr className="group" key={x.lease}>
              <td className={TD}>{x.lease}</td>
              <td className={TD}>{x.submissions}</td>
              <td className={TD}>{x.rejected}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Enquiry to registered lease" empty={!e.rows.length}>
        <thead>
          <tr>
            <th className={TH}>Lease</th>
            <th className={TH}>From</th>
            <th className={TH}>Started</th>
            <th className={TH}>Ejari issued</th>
            <th className={TH}>Days</th>
          </tr>
        </thead>
        <tbody>
          {e.rows.map((x) => (
            <tr className="group" key={x.lease}>
              <td className={TD}>{x.lease}</td>
              <td className={TD}>{x.from}</td>
              <td className={TD}>{shortDate(x.startedOn)}</td>
              <td className={TD}>{shortDate(x.ejariIssuedOn)}</td>
              <td className={TD}>{x.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>

      <Section title="Deposit returns" empty={!d.rows.length}>
        <thead>
          <tr>
            <th className={TH}>Lease</th>
            <th className={TH}>Inspected</th>
            <th className={TH}>Refund paid</th>
            <th className={TH}>Days</th>
          </tr>
        </thead>
        <tbody>
          {d.rows.map((x) => (
            <tr className="group" key={x.lease}>
              <td className={TD}>{x.lease}</td>
              <td className={TD}>{shortDate(x.inspectedOn)}</td>
              <td className={TD}>{shortDate(x.paidOn)}</td>
              <td className={TD}>{x.days}</td>
            </tr>
          ))}
        </tbody>
      </Section>
    </div>
  );
}

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="grid gap-3">
      <h2 className="m-0 font-sans text-[15px] font-semibold tracking-tight text-ink">{title}</h2>
      {empty ? (
        <p className="m-0 text-sm text-muted">Nothing to show yet.</p>
      ) : (
        <TableFrame>
          <table className={TABLE}>{children}</table>
        </TableFrame>
      )}
    </section>
  );
}
