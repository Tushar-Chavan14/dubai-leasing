import { z } from "zod";
import type { Hono } from "hono";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import {
  addApprovalNote,
  approvalNotesFor,
  getOwnDraft,
  sendApplicantEmail,
  sendStaffEmail,
} from "../manager/staff-messages.ts";
import { completeTask, createStaffTask } from "../manager/task-actions.ts";
import type { AuthEnv } from "./auth.ts";

const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);

/** Staff work that exists before move-in: tasks, emails to a tenant, approval notes, copilot drafts. Always on. */
export function registerStaffWorkRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  api.post("/tasks", async (c) => {
    const user = c.get("user");
    return c.json(await createStaffTask(ctx, `user:${user.id}`, user.role, await c.req.json()), 201);
  });
  api.post("/tasks/:id/done", async (c) => {
    const { note } = z
      .object({ note: z.string().trim().max(2000).optional() })
      .parse(await c.req.json().catch(() => ({})));
    return c.json(await completeTask(ctx, c.get("user"), uuid(c.req.param("id")), note));
  });
  api.post("/leases/:id/email", async (c) =>
    c.json(await sendStaffEmail(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.post("/applications/:id/email", async (c) =>
    c.json(await sendApplicantEmail(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json())),
  );
  api.get("/approvals/:id/notes", async (c) => c.json(await approvalNotesFor(ctx, uuid(c.req.param("id")))));
  api.post("/approvals/:id/notes", async (c) =>
    c.json(await addApprovalNote(ctx, c.get("user"), uuid(c.req.param("id")), await c.req.json()), 201),
  );
  api.get("/copilot/drafts/:id", async (c) => {
    const d = await getOwnDraft(ctx, c.get("user"), uuid(c.req.param("id")));
    if (!d) throw notFound("draft");
    return c.json(d);
  });
}
