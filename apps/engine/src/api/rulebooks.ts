import type { StaffUser } from "@leasing/core";
import { rulebooks, staffUsers } from "@leasing/db";
import { activeRulesVersion, getRulebook, loosenedVsBase, ReferenceRules, RulebookValues } from "@leasing/rulebook";
import { asc, eq } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import {
  baseFor,
  contentsOf,
  createDraft,
  deleteDraft,
  diffContents,
  DraftPatch,
  publishRulebook,
  updateDraft,
} from "../manager/rulebooks.ts";
import { type AuthEnv, requireRole } from "./auth.ts";
import { entityEvents } from "./queries.ts";

/** Staff names for actors; the code base row was stored by the engine. */
const nameOf = (m: Map<string, string>, actor: string | null) =>
  actor === null ? null : (m.get(actor) ?? (actor === "system" ? "System (code base)" : actor));

const actorOf = (u: StaffUser) => `user:${u.id}` as const;

/**
 * Rulebook versions (decision D23). Any staff may read published versions; drafts and every
 * write are admin-only. Published versions are immutable; a newer version supersedes them.
 */
export function registerRulebookRoutes(api: Hono<AuthEnv>, ctx: EngineContext) {
  const db = ctx.database.db;

  async function names(): Promise<Map<string, string>> {
    const staff = await db.select({ id: staffUsers.id, name: staffUsers.name }).from(staffUsers);
    return new Map(staff.map((s) => [`user:${s.id}`, s.name]));
  }

  api.get("/rulebooks", async (c) => {
    const isAdmin = c.get("user").role === "admin";
    const rows = await db.select().from(rulebooks).orderBy(asc(rulebooks.effectiveFrom), asc(rulebooks.createdAt));
    const active = activeRulesVersion(ctx.clock.today());
    const n = await names();
    return c.json({
      today: ctx.clock.today(),
      active,
      versions: rows
        .filter((r) => isAdmin || r.status === "published")
        .map((r) => ({
          version: r.version,
          emirate: r.emirate,
          status: r.status,
          basedOn: r.basedOn,
          effectiveFrom: r.effectiveFrom,
          isActive: r.version === active,
          createdBy: nameOf(n, r.createdBy),
          createdAt: r.createdAt,
          publishedBy: nameOf(n, r.publishedBy),
          publishedAt: r.publishedAt,
          referenceRuleCount: Array.isArray(r.referenceRules) ? r.referenceRules.length : 0,
        })),
    });
  });

  api.get("/rulebooks/:version", async (c) => {
    const [row] = await db
      .select()
      .from(rulebooks)
      .where(eq(rulebooks.version, c.req.param("version")));
    if (!row || (row.status === "draft" && c.get("user").role !== "admin")) throw notFound("rulebook version");
    const values = RulebookValues.parse(row.values);
    const referenceRules = ReferenceRules.parse(row.referenceRules);
    const active = activeRulesVersion(ctx.clock.today(), row.emirate);
    const n = await names();
    const events = await entityEvents(db, "rulebook", row.id);
    return c.json({
      version: row.version,
      emirate: row.emirate,
      status: row.status,
      basedOn: row.basedOn,
      effectiveFrom: row.effectiveFrom,
      isActive: row.version === active,
      active,
      today: ctx.clock.today(),
      baseVersion: baseFor(row.emirate).version,
      createdBy: nameOf(n, row.createdBy),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      publishedBy: nameOf(n, row.publishedBy),
      publishedAt: row.publishedAt,
      values,
      referenceRules,
      loosened: loosenedVsBase(values, baseFor(row.emirate)),
      changesVsActive:
        active && active !== row.version
          ? diffContents(contentsOf(getRulebook(active)), {
              values,
              referenceRules,
              effectiveFrom: row.effectiveFrom,
            })
          : [],
      events: events.map((e) => ({ ...e, actorName: nameOf(n, e.actor) })),
    });
  });

  api.post("/rulebooks", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const { basedOn } = z.object({ basedOn: z.string().min(1).max(40) }).parse(await c.req.json());
    const row = await createDraft(ctx, basedOn, actorOf(user));
    return c.json({ version: row.version, status: row.status }, 201);
  });

  api.patch("/rulebooks/:version", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const patch = DraftPatch.parse(await c.req.json());
    const row = await updateDraft(ctx, c.req.param("version"), patch, actorOf(user));
    return c.json({ version: row.version, status: row.status, effectiveFrom: row.effectiveFrom });
  });

  api.delete("/rulebooks/:version", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    await deleteDraft(ctx, c.req.param("version"), actorOf(user));
    return c.json({ deleted: true });
  });

  api.post("/rulebooks/:version/publish", async (c) => {
    const user = c.get("user");
    requireRole(user, ["admin"]);
    const body = z.object({ confirmLegalReview: z.boolean().optional() }).parse(await c.req.json().catch(() => ({})));
    const { row, loosened } = await publishRulebook(ctx, c.req.param("version"), body, actorOf(user));
    return c.json({ version: row.version, status: row.status, effectiveFrom: row.effectiveFrom, loosened });
  });
}
