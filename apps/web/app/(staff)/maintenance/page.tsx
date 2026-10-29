import type { Metadata } from "next";
import Link from "next/link";
import { Empty, PageHead, Status } from "../../../components/ui";
import { get } from "../../../lib/engine";
import { IconChecklist } from "../../../lib/icons";
import type { Me } from "../../../lib/types";
import { TicketActions } from "./ticket-actions";

export const metadata: Metadata = { title: "Maintenance" };

interface BoardRow {
  ticket: {
    id: string;
    ref: string;
    leaseId: string;
    category: string;
    urgency: number;
    status: string;
    dueBy: string;
    notes: string | null;
  };
  leaseRef: string;
  complaintRef: string | null;
  complaintText: string;
  /** Past its due time by the engine's clock. */
  late: boolean;
}

const URGENCY = ["Can wait a week", "Within 48 hours", "Same day", "Emergency"];

export default async function MaintenancePage() {
  const [rows, me] = await Promise.all([get<BoardRow[]>("/api/tickets"), get<Me>("/api/me")]);
  const canAct = me?.role === "leasing_officer" || me?.role === "leasing_manager";
  return (
    <>
      <PageHead
        title="Maintenance"
        lede="Open tickets from tenants' reports, most urgent first. Due times come from company policy by urgency."
      />
      <section className="panel">
        {!rows?.length ? (
          <Empty icon={<IconChecklist />} title="No open tickets">
            Tickets appear when a tenant reports an issue and triage files it, or an officer opens one.
          </Empty>
        ) : (
          <ul className="list">
            {rows.map(({ ticket: t, leaseRef, complaintRef, complaintText, late }) => {
              return (
                <li key={t.id} className="list-row" style={{ display: "block" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <div>
                      <div className="title" dir="auto">
                        {complaintText.slice(0, 140)}
                      </div>
                      <div className="meta">
                        <span className="ref">{t.ref}</span>
                        <span>{t.category}</span>
                        <span>{URGENCY[t.urgency]}</span>
                        <span style={late ? { color: "var(--bad)" } : undefined}>
                          due{" "}
                          {new Date(t.dueBy).toLocaleString("en-GB", {
                            timeZone: "Asia/Dubai",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}
                          {late ? " (late)" : ""}
                        </span>
                        <Link className="link" href={`/work?kind=lease&id=${t.leaseId}`}>
                          {leaseRef}
                        </Link>
                        {complaintRef && <span>report {complaintRef}</span>}
                      </div>
                    </div>
                    <Status value={t.status} />
                  </div>
                  {canAct && <TicketActions ticketId={t.id} status={t.status} />}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}
