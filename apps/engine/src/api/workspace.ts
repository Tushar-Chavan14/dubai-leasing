import { newId } from "@leasing/core";
import { savedViews } from "@leasing/db";
import { and, asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { kycStuckMs } from "../manager/kyc-check.ts";
import { STAGES, homeView, listRecords, listVersion, recordLog, recordVersion } from "../manager/workspace.ts";
import type { AuthEnv } from "./auth.ts";

const uuid = (v: string | undefined) => z.uuid().catch("00000000-0000-0000-0000-000000000000").parse(v);

const ViewFilter = z.object({
  stage: z.enum(STAGES).optional(),
  q: z.string().max(100).optional(),
  mine: z.boolean().optional(),
});
const NewView = z.object({ name: z.string().trim().min(1).max(40), filter: ViewFilter });

/** Staff Workspace and Home reads, plus per-user saved views. Any staff role may read. */
export function registerWorkspaceRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  api.get("/records", async (c) => {
    const me = c.get("user");
    let filter: { stage?: string; q?: string; mine?: boolean } = {};
    const view = c.req.query("view");
    if (view) {
      const [v] = await db
        .select()
        .from(savedViews)
        .where(and(eq(savedViews.id, uuid(view)), eq(savedViews.staffUserId, me.id)));
      if (!v) throw notFound("view");
      filter = v.filter;
    }
    const q = c.req.query("q");
    const stage = c.req.query("stage");
    const mine = c.req.query("mine");
    return c.json(
      await listRecords(db, me, {
        q: q ?? filter.q,
        stage: stage ?? filter.stage,
        mine: mine !== undefined ? mine === "1" : filter.mine,
      }),
    );
  });

  // Change markers for live updates: equality-compared by the web client, cheap (indexed) to poll.
  api.get("/records/version", async (c) => c.json({ version: await listVersion(db) }));

  api.get("/records/:kind/:id/version", async (c) => {
    const kind = z.enum(["application", "lease"]).safeParse(c.req.param("kind"));
    const version = kind.success ? await recordVersion(db, kind.data, uuid(c.req.param("id"))) : null;
    if (version === null) throw notFound("record");
    return c.json({ version });
  });

  api.get("/records/:kind/:id/log", async (c) => {
    const kind = z.enum(["application", "lease"]).safeParse(c.req.param("kind"));
    const log = kind.success
      ? await recordLog(db, c.get("user"), kind.data, uuid(c.req.param("id")), ctx.clock.now(), kycStuckMs(ctx))
      : null;
    if (!log) throw notFound("record");
    return c.json(log);
  });

  api.get("/home", async (c) => c.json(await homeView(ctx, c.get("user"))));

  api.get("/views", async (c) =>
    c.json(
      await db
        .select()
        .from(savedViews)
        .where(eq(savedViews.staffUserId, c.get("user").id))
        .orderBy(asc(savedViews.createdAt)),
    ),
  );
  api.post("/views", async (c) => {
    const b = NewView.parse(await c.req.json());
    const filter = Object.fromEntries(Object.entries(b.filter).filter(([, v]) => v !== undefined));
    const [row] = await db
      .insert(savedViews)
      .values({ id: newId(), staffUserId: c.get("user").id, name: b.name, filter })
      .onConflictDoNothing()
      .returning();
    if (!row) throw conflict("you already have a view with that name", "view_name_taken");
    return c.json(row, 201);
  });
  api.delete("/views/:id", async (c) => {
    const [row] = await db
      .delete(savedViews)
      .where(and(eq(savedViews.id, uuid(c.req.param("id"))), eq(savedViews.staffUserId, c.get("user").id)))
      .returning({ id: savedViews.id });
    if (!row) throw notFound("view");
    return c.json({ ok: true });
  });
}
