import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { webEnv } from "../../../../../lib/env";
import { DealRecord } from "../../../../../components/deal-record";
import { engineGet } from "../../../../../lib/engine";
import { loadRecordPage } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Deal" };

/**
 * The deal record (design §4.3): what the engine's record view says, in design order. Read only: the decision
 * cards are in the inbox (C31), so nothing here approves, rejects or changes a deal.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireScreen("work");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const cursor = (await searchParams).events;
  const page = await loadRecordPage(engineGet, id.data, typeof cursor === "string" ? cursor : undefined);
  if (!page) notFound();
  return (
    <DealRecord
      record={page.record}
      events={page.events.items}
      nextEvents={
        page.events.nextCursor
          ? { href: `/work/deals/${id.data}?events=${encodeURIComponent(page.events.nextCursor)}` }
          : null
      }
      viewer={user.role}
      demo={webEnv().SPA_DEMO_MODE}
    />
  );
}
