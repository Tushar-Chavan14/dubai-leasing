"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { engine } from "../../../lib/engine";

/** "Mark read" on an alert (C23, S62): `POST /api/alerts/:id/read` as the signed-in user; the engine only lets you read your own. */
export async function markAlertRead(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/alerts?error=1");
  const res = await (await engine()).api.alerts[":id"].read.$post({ param: { id: id.data } }).catch(() => null);
  if ((res?.status as number | undefined) === 401) redirect("/sign-in");
  if (!res?.ok) redirect("/alerts?error=1");
  revalidatePath("/alerts");
  revalidatePath("/", "layout");
}
