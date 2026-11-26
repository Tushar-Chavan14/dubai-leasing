import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { LeadView } from "../../../../components/lead-view";
import { engineGet } from "../../../../lib/engine";
import { loadLead } from "../../../../lib/loaders";
import { requireScreen } from "../../../../lib/session";

export const metadata: Metadata = { title: "Lead" };

/** One lead (S79, record layout rule): what waits on you, Overview, Messages, Viewings, Activity. Sales roles only. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  await requireScreen("work");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const lead = await loadLead(engineGet, id.data);
  if (!lead) notFound();
  return <LeadView lead={lead} />;
}
