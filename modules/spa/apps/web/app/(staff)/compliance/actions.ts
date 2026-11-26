"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { engine } from "../../../lib/engine";

/**
 * "Approve list" on a retention list (C23, S29, S62): `POST /api/compliance/retention/:id/approve` as the signed-in user.
 * The engine checks the role again (a compliance officer or the MLRO). The approval deletes nothing.
 */
export async function approveRetention(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/compliance?error=retention");
  const res = await (
    await engine()
  ).api.compliance.retention[":id"].approve
    .$post({ param: { id: id.data } })
    .catch(() => null);
  if ((res?.status as number | undefined) === 401) redirect("/sign-in");
  if (!res?.ok) redirect("/compliance?error=retention");
  revalidatePath("/compliance");
}
