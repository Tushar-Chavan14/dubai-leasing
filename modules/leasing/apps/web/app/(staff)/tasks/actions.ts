"use server";

import { revalidatePath } from "next/cache";
import { engine, formError } from "../../../lib/engine";

export interface TaskActionState {
  ok?: string;
  error?: string;
  reasons?: string[];
  /** After a repossession ground that can still end this term: offer the 12-month notice form. */
  vacate?: { leaseId: string; ground: string; deadline: string };
}

const refresh = (leaseId: string) => {
  revalidatePath("/tasks");
  if (leaseId) revalidatePath(`/leases/${leaseId}`);
  revalidatePath("/", "layout");
};

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim() || undefined;

export async function markTaskDone(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const r = await engine(`/api/tasks/${String(f.get("taskId"))}/done`, {
    method: "POST",
    body: JSON.stringify({ note: text(f, "note") }),
  });
  if (!r.ok) return formError(r);
  refresh(String(f.get("leaseId") ?? ""));
  return { ok: "Done." };
}

const GROUNDS = new Set(["sale", "own_use", "major_works", "demolition"]);

export async function recordLandlordAnswer(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const leaseId = String(f.get("leaseId") ?? "");
  const answer = String(f.get("answer"));
  const r = await engine<{ closed: boolean; possibleThisTerm: boolean; deadline: string }>(
    `/api/tasks/${String(f.get("taskId"))}/landlord-answer`,
    { method: "POST", body: JSON.stringify({ answer, note: text(f, "note") }) },
  );
  if (!r.ok) return formError(r);
  refresh(leaseId);
  if (!r.data.closed) return { ok: "Noted. The task stays open until the landlord answers." };
  if (!GROUNDS.has(answer)) return { ok: "Recorded: the landlord wants to renew." };
  if (r.data.possibleThisTerm)
    return {
      ok: `Recorded. The 12-month notice can still end this term if it is served by notary or registered mail by ${r.data.deadline}.`,
      vacate: { leaseId, ground: answer, deadline: r.data.deadline },
    };
  return {
    ok: `Recorded. The deadline for this term (${r.data.deadline}) has passed, so the notice can only end the next term. A task reminds a leasing manager before that deadline.`,
  };
}

export async function proposeVacateNotice(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/vacate-notice`, {
    method: "POST",
    body: JSON.stringify({
      ground: String(f.get("ground")),
      servedOn: String(f.get("servedOn")),
      deliveryMethod: String(f.get("deliveryMethod")),
      note: text(f, "note"),
    }),
  });
  if (!r.ok) return formError(r);
  refresh(leaseId);
  return { ok: "Sent to a leasing manager for approval." };
}

export async function addTask(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/tasks`, {
    method: "POST",
    body: JSON.stringify({
      leaseId,
      title: String(f.get("title") ?? "").trim(),
      assigneeRole: String(f.get("assigneeRole")),
      dueOn: text(f, "dueOn"),
      note: text(f, "note"),
    }),
  });
  if (!r.ok) return formError(r);
  refresh(leaseId);
  return { ok: "Task added." };
}

export async function emailTenant(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const leaseId = String(f.get("leaseId"));
  const r = await engine(`/api/leases/${leaseId}/email`, {
    method: "POST",
    body: JSON.stringify({
      subject: String(f.get("subject") ?? "").trim(),
      body: String(f.get("body") ?? "").trim(),
      draftId: text(f, "draftId"),
    }),
  });
  if (!r.ok) return formError(r);
  refresh(leaseId);
  return { ok: "Sent. The email and the mail server's response are stored on the lease." };
}

export async function emailApplicant(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const applicationId = String(f.get("applicationId"));
  const r = await engine(`/api/applications/${applicationId}/email`, {
    method: "POST",
    body: JSON.stringify({
      subject: String(f.get("subject") ?? "").trim(),
      body: String(f.get("body") ?? "").trim(),
      draftId: text(f, "draftId"),
    }),
  });
  if (!r.ok) return formError(r);
  revalidatePath("/work");
  revalidatePath("/", "layout");
  return { ok: "Sent. The email and the mail server's response are stored on the application." };
}

export async function addApprovalNote(_p: TaskActionState, f: FormData): Promise<TaskActionState> {
  const approvalId = String(f.get("approvalId"));
  const r = await engine(`/api/approvals/${approvalId}/notes`, {
    method: "POST",
    body: JSON.stringify({ body: String(f.get("body") ?? "").trim(), draftId: text(f, "draftId") }),
  });
  if (!r.ok) return formError(r);
  revalidatePath("/work");
  return { ok: "Note added." };
}
