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
 * The deal record for the two compliance roles (C39, S71), who have no Work screen: the same record view with their
 * own role, so the engine sends them the compliance section and the rest only as their role may read it. Read only.
 */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { user } = await requireScreen("compliance");
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
          ? { href: `/compliance/deals/${id.data}?events=${encodeURIComponent(page.events.nextCursor)}` }
          : null
      }
      viewer={user.role}
      demo={webEnv().SPA_DEMO_MODE}
      back={{ href: "/compliance#cases", label: "Compliance" }}
    />
  );
}
