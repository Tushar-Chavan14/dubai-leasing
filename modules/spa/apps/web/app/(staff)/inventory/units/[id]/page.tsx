import { railItems } from "@spa/core/roles";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";
import { UnitView } from "../../../../../components/unit-view";
import { engineGet } from "../../../../../lib/engine";
import { loadUnit } from "../../../../../lib/loaders";
import { requireScreen } from "../../../../../lib/session";

export const metadata: Metadata = { title: "Unit" };

/** One unit (S75): the page reads the unit as the signed-in user and hands it to the view. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { user } = await requireScreen("inventory");
  const id = z.uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const u = await loadUnit(engineGet, id.data);
  if (!u) notFound();
  const canWork = railItems(user.role, user.companyKind).some((i) => i.screen === "work");
  return (
    <UnitView
      unit={u}
      canWork={canWork}
      admin={user.role === "admin"}
      canStartDeal={["sales_officer", "sales_manager", "sales_admin"].includes(user.role)}
    />
  );
}
