import { portalKeyOk } from "@platform/kernel";
import { approvals, tasks } from "@leasing/db";
import { count, eq } from "drizzle-orm";
import type { Hono } from "hono";
import type { EngineContext } from "../context.ts";
import type { AuthEnv } from "./auth.ts";

/**
 * `GET /summary` for the module chooser (S69): two integers, no name, id or personal field, behind `x-portal-key`.
 * No key configured, a missing key and a wrong key all give the same plain 404. It reads leasing's own tables only.
 */
export function registerLauncherSummary(app: Hono<AuthEnv>, ctx: EngineContext, key: string | undefined) {
  app.get("/summary", async (c) => {
    if (!portalKeyOk(c.req.header("x-portal-key"), key)) return c.json({ error: "not found", code: "not_found" }, 404);
    const db = ctx.database.db;
    const [work] = await db.select({ n: count() }).from(tasks).where(eq(tasks.status, "open"));
    const [waiting] = await db.select({ n: count() }).from(approvals).where(eq(approvals.status, "pending"));
    return c.json({ openWork: Number(work!.n), waitingApprovals: Number(waiting!.n) });
  });
}
