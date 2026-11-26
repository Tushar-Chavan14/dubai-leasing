import { PageTitle } from "@platform/ui/page";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { DealForm } from "../../../../components/deal-form";
import { DealUnavailable } from "../../../../components/deal-unavailable";
import { engineGet } from "../../../../lib/engine";
import { loadDealQuote, loadLead, loadUnit } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Start a deal" };

const SALES = ["sales_officer", "sales_manager", "sales_admin"];

/**
 * Start a primary deal (M6, S81) from an available unit, `?unit=<id>`, or from a lead, `?lead=<id>` (the buyer and the home
 * come filled in). A lead about a resale listing goes to the offer page; a home that is no longer available says so.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ unit?: string; lead?: string }> }) {
  const { user } = await requireScreen("work");
  if (!SALES.includes(user.role)) notFound();
  const q = await searchParams;
  let unitId = z.uuid().safeParse(q.unit).data;
  let lead: { id: string; name: string; email: string } | null = null;
  if (q.lead) {
    const id = z.uuid().safeParse(q.lead);
    if (!id.success) notFound();
    const l = await loadLead(engineGet, id.data);
    if (!l) notFound();
    if (l.property?.kind === "listing") redirect(`/listings/${l.property.id}/offer?lead=${l.id}`);
    if (!l.property) return <DealUnavailable />;
    lead = { id: l.id, name: l.name, email: l.email };
    unitId = l.property.id;
  }
  if (!unitId) notFound();
  const unit = await loadUnit(engineGet, unitId);
  if (!unit) notFound();
  if (unit.state !== "AVAILABLE") return <DealUnavailable code={unit.code} />;
  const quote = await loadDealQuote(engineGet, unit.id);
  if (!quote) notFound();
  const title = [unit.project?.name, unit.building?.name].filter(Boolean).join(", ") || "Not in a project yet";
  return (
    <div className="grid gap-6">
      <PageTitle
        back={[
          { href: "/inventory", label: "Inventory" },
          { href: `/inventory/units/${unit.id}`, label: unit.code },
        ]}
        title="Start deal"
        lede="Add the buyers and the agreed price. A price or booking outside the limits still starts the deal, and a sales manager decides it."
      />
      <DealForm unit={{ id: unit.id, code: unit.code, title }} quote={quote} lead={lead} />
    </div>
  );
}
