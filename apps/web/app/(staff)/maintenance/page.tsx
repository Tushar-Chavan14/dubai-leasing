import type { Metadata } from "next";
import { EmptyState } from "../../../components/ui/empty-state";
import { PageTitle } from "../../../components/ui/page";
import { get } from "../../../lib/engine";
import type { Me } from "../../../lib/types";
import { type BoardRow, TicketList } from "./ticket-list";

export const metadata: Metadata = { title: "Maintenance" };

export default async function MaintenancePage() {
  const [rows, me] = await Promise.all([get<BoardRow[]>("/api/tickets"), get<Me>("/api/me")]);
  const canAct = me?.role === "leasing_officer" || me?.role === "leasing_manager";
  return (
    <div className="grid gap-5">
      <PageTitle
        title="Maintenance"
        lede="Open tickets from tenants' reports, most urgent first. Due times come from company policy by urgency."
      />
      {!rows?.length ? (
        <EmptyState
          title="No open tickets"
          body="Tickets appear when a tenant reports an issue and triage files it, or an officer opens one."
        />
      ) : (
        <TicketList rows={rows} canAct={canAct} />
      )}
    </div>
  );
}
