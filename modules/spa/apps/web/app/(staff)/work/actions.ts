"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { engine } from "../../../lib/engine";

/**
 * "Mark done" on a task (C30, S58): `POST /api/tasks/:id/done` as the signed-in user. The engine checks the role again
 * (the task's own role, or a sales manager), so this is a convenience and never the rule.
 */
export async function markTaskDone(formData: FormData): Promise<void> {
  const id = z.uuid().safeParse(formData.get("id"));
  if (!id.success) redirect("/work?tab=tasks&error=task");
  const res = await (await engine()).api.tasks[":id"].done.$post({ param: { id: id.data } }).catch(() => null);
  if ((res?.status as number | undefined) === 401) redirect("/sign-in");
  if (!res?.ok) redirect("/work?tab=tasks&error=task");
  revalidatePath("/work");
  revalidatePath("/");
}
