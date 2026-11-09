import Link from "next/link";
import { Status } from "../../../components/ui";
import { ROW_CARD } from "../../../components/ui/record";
import { LINK, LIST, META } from "../../../components/ui/tenancy";
import { TicketActions } from "./ticket-actions";

export interface BoardRow {
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

export function TicketList({ rows, canAct }: { rows: BoardRow[]; canAct: boolean }) {
  return (
    <ul className={LIST}>
      {rows.map(({ ticket: t, leaseRef, complaintRef, complaintText, late }) => (
        <li key={t.id} className={`${ROW_CARD} grid gap-2.5 px-4 py-3`}>
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
            <div className="grid min-w-0 gap-0.5">
              <div className="text-sm font-semibold [overflow-wrap:anywhere]" dir="auto">
                {complaintText.slice(0, 140)}
              </div>
              <div className={META}>
                <span className="font-mono">{t.ref}</span>
                <span>{t.category}</span>
                <span>{URGENCY[t.urgency]}</span>
                <span className={late ? "font-semibold text-danger" : undefined}>
                  due{" "}
                  {new Date(t.dueBy).toLocaleString("en-GB", {
                    timeZone: "Asia/Dubai",
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {late ? " (late)" : ""}
                </span>
                <Link className={LINK} href={`/work?kind=lease&id=${t.leaseId}`}>
                  {leaseRef}
                </Link>
                {complaintRef && <span>report {complaintRef}</span>}
              </div>
            </div>
            <Status value={t.status} />
          </div>
          {canAct && <TicketActions ticketId={t.id} status={t.status} />}
        </li>
      ))}
    </ul>
  );
}
