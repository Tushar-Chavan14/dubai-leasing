import type { LocalDiskStore } from "@leasing/adapters";
import { leasingMetrics } from "../manager/metrics.ts";
import { resetDemoData } from "../demo/reset-data.ts";
import { seedMissingDemoLeases } from "../demo/seed.ts";
import { ApprovalDecision, maskPiiText } from "@leasing/core";
import { staffUsers, withTx } from "@leasing/db";
import { asc, eq } from "drizzle-orm";
import { type Context, Hono } from "hono";
import { z } from "zod";
import { unprocessable } from "../errors.ts";
import type { EngineDemoClock } from "../clock.ts";
import type { EngineContext } from "../context.ts";
import { DomainError, notFound } from "../errors.ts";
import { decideApproval } from "../manager/approvals.ts";
import { getCompanyPolicy } from "../manager/events.ts";
import { importLeasesCsv, importUnitsCsv } from "../manager/import.ts";
import { sweepDueDeadlines } from "../manager/milestones.ts";
import { type AuthEnv, issueToken, requireRole, requireUser } from "./auth.ts";
import * as q from "./queries.ts";
import { registerApplicationRoutes } from "./applications.ts";
import { registerChannelRoutes, registerConversationRoutes } from "./channel.ts";
import { registerTenancyDemoRoutes, registerTenancyRoutes } from "./tenancy.ts";
import { leaseContractView, registerContractRoutes } from "./contracts.ts";
import { registerCopilotRoutes } from "./copilot.ts";
import { registerCustomerRoutes } from "./customer.ts";
import { registerPortalRoutes } from "./portal.ts";
import { registerReadRoutes } from "./reads.ts";
import { registerRenewalRoutes } from "./renewals.ts";
import { registerRulebookRoutes } from "./rulebooks.ts";
import { registerUnitRoutes } from "./units.ts";

/** POST /import/<kind>: admin or leasing manager; CSV body or {"csv": "..."}. */
const importRoute = (
  run: (csv: string, actor: `user:${string}`) => Promise<{ status: "imported" | "skipped" | "error" }[]>,
) =>
  async function handler(c: Context<AuthEnv>) {
    requireRole(c.get("user"), ["admin", "leasing_manager"]);
    const type = c.req.header("content-type") ?? "";
    const csv = type.includes("application/json")
      ? z.object({ csv: z.string().min(1).max(2_000_000) }).parse(await c.req.json()).csv
      : await c.req.text();
    const rows = await run(csv, `user:${c.get("user").id}`);
    return c.json({
      imported: rows.filter((r) => r.status === "imported").length,
      skipped: rows.filter((r) => r.status === "skipped").length,
      errors: rows.filter((r) => r.status === "error").length,
      rows,
    });
  };

export interface ApiOptions {
  sessionSecret: string;
  /** Unit photo store (MEDIA_DIR). */
  mediaStore: LocalDiskStore;
  /** Present only in demo mode. */
  demoClock?: EngineDemoClock;
  /** Shared secret for the Telegram bot's route; unset turns the route off. */
  channelSecret?: string | undefined;
  /** The simulated registry (demo console: reject the next submission, reset). */
  ejariMockUrl?: string | undefined;
}

export function createApi(ctx: EngineContext, opts: ApiOptions) {
  const app = new Hono<AuthEnv>();
  const db = ctx.database.db;

  app.onError((err, c) => {
    if (err instanceof DomainError)
      return c.json({ error: err.message, code: err.code, reasons: err.reasons }, err.status);
    if (err instanceof z.ZodError)
      return c.json(
        {
          error: "invalid request",
          code: "invalid_request",
          reasons: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
        },
        400,
      );
    console.error(maskPiiText(String(err instanceof Error ? (err.stack ?? err.message) : err)));
    return c.json({ error: "internal error", code: "internal" }, 500);
  });

  app.get("/health", (c) => c.json({ ok: true, today: ctx.clock.today(), demoMode: ctx.demoMode }));

  // --- auth (demo login only in phase 0) ---
  if (ctx.demoMode) {
    app.get("/api/auth/demo-users", async (c) =>
      c.json(
        await db
          .select({ email: staffUsers.email, name: staffUsers.name, role: staffUsers.role })
          .from(staffUsers)
          .where(eq(staffUsers.active, true))
          .orderBy(asc(staffUsers.role)),
      ),
    );
    app.post("/api/auth/demo-login", async (c) => {
      const { email } = z.object({ email: z.email() }).parse(await c.req.json());
      const [u] = await db.select().from(staffUsers).where(eq(staffUsers.email, email));
      if (!u || !u.active) throw notFound("staff user");
      return c.json({
        token: issueToken(opts.sessionSecret, u.id, Date.now()),
        user: { id: u.id, name: u.name, email: u.email, role: u.role },
      });
    });
  }

  // Tenant portal: token-authenticated, outside the staff session.
  registerPortalRoutes(app, ctx, opts.mediaStore);
  // Telegram bot: secret-authenticated, outside the staff session.
  registerChannelRoutes(app, ctx, opts.channelSecret);

  // Customer web chat: its own token audience, outside the staff session.
  registerCustomerRoutes(app, ctx, opts);

  const api = new Hono<AuthEnv>();
  api.use("*", requireUser(ctx.database, opts.sessionSecret));

  api.get("/me", (c) => c.json(c.get("user")));

  api.get("/approvals", async (c) => {
    const status = z.enum(["pending", "decided", "all"]).catch("pending").parse(c.req.query("status"));
    return c.json(await q.listApprovals(db, status));
  });
  api.get("/approvals/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    const a = id.success ? await q.getApproval(db, id.data) : null;
    if (!a) throw notFound("approval");
    return c.json(a);
  });
  api.post("/approvals/:id/decide", async (c) => {
    const decision = ApprovalDecision.parse(await c.req.json());
    return c.json(await decideApproval(ctx, c.req.param("id"), c.get("user"), decision));
  });

  api.get("/leases", async (c) => c.json(await q.listLeases(db)));
  // The five KPIs (docs/specs.md §8), any staff role.
  api.get("/metrics", async (c) => c.json(await withTx(ctx.database, (tx) => leasingMetrics(tx, ctx.clock.today()))));
  api.get("/leases/:id", async (c) => {
    const id = z.uuid().safeParse(c.req.param("id"));
    const l = id.success ? await q.getLease(db, id.data) : null;
    if (!l) throw notFound("lease");
    return c.json({ ...l, ...(await leaseContractView(db, l.id)) });
  });
  registerUnitRoutes(api, ctx, opts.mediaStore);
  registerRenewalRoutes(api, ctx);
  registerReadRoutes(api, ctx);
  registerRulebookRoutes(api, ctx);
  registerApplicationRoutes(api, ctx);
  registerContractRoutes(api, ctx);
  registerConversationRoutes(api, ctx);
  registerTenancyRoutes(api, ctx);
  // The copilot calls this same app in-process, as the user (architecture §8b).
  registerCopilotRoutes(api, ctx, app);
  api.get("/policy", async (c) => c.json(await withTx(ctx.database, (tx) => getCompanyPolicy(tx, ctx.clock.today()))));
  api.get("/deadlines", async (c) => {
    const days = z.coerce.number().int().min(1).max(400).catch(60).parse(c.req.query("days"));
    return c.json(await q.upcomingDeadlines(db, ctx.clock.today(), days));
  });
  api.get("/tasks", async (c) => c.json(await q.listTasks(db, c.req.query("status") === "all" ? "all" : "open")));

  api.post(
    "/import/leases",
    importRoute((csv, actor) => importLeasesCsv(ctx, csv, actor)),
  );
  api.post(
    "/import/units",
    importRoute((csv, actor) => importUnitsCsv(ctx, csv, actor)),
  );

  if (ctx.demoMode && opts.demoClock) {
    const demoClock = opts.demoClock;
    api.get("/demo/clock", (c) =>
      c.json({
        now: ctx.clock.now().toISOString(),
        today: ctx.clock.today(),
        offsetDays: Math.round(demoClock.offset / 86_400_000),
      }),
    );
    api.post("/demo/fast-forward", async (c) => {
      requireRole(c.get("user"), ["admin", "leasing_manager", "leasing_officer"]);
      const { days } = z.object({ days: z.number().int().min(1).max(800) }).parse(await c.req.json());
      await demoClock.fastForward(days);
      const fired = await sweepDueDeadlines(ctx);
      return c.json({ today: ctx.clock.today(), fired: fired.filter((f) => f.fired) });
    });
    api.post("/demo/rewind", async (c) => {
      requireRole(c.get("user"), ["admin", "leasing_manager", "leasing_officer"]);
      await demoClock.rewind();
      return c.json({ today: ctx.clock.today(), offsetDays: 0 });
    });
    api.post("/demo/sweep", async (c) => c.json({ fired: (await sweepDueDeadlines(ctx)).filter((f) => f.fired) }));
    // The simulated registry rejects the next registration (name mismatch), to show the review path.
    api.post("/demo/ejari/reject-next", async (c) => {
      requireRole(c.get("user"), ["admin", "leasing_manager", "leasing_officer"]);
      if (!opts.ejariMockUrl) throw unprocessable("the simulated registry isn't configured", [], "no_mock");
      const r = await fetch(`${opts.ejariMockUrl.replace(/\/$/, "")}/api/v1/demo/reject-next`, {
        method: "POST",
      }).catch(() => null);
      if (!r?.ok) throw unprocessable("the simulated registry didn't answer; is it running?", [], "mock_down");
      return c.json({ ok: true });
    });
    // Adds the demo leases that are missing, next to existing data (nothing deleted).
    api.post("/demo/seed-leases", async (c) => {
      requireRole(c.get("user"), ["admin", "leasing_manager", "leasing_officer"]);
      return c.json({ results: await seedMissingDemoLeases(ctx) });
    });
    // Everything back to the seeded demo, clock at today. Admin only.
    api.post("/demo/reset", async (c) => {
      requireRole(c.get("user"), ["admin"]);
      z.object({ confirm: z.literal("RESET") }).parse(await c.req.json());
      // The audit log goes with the data, so the reset itself is logged by the server.
      console.warn(`demo reset by user:${c.get("user").id}`);
      await demoClock.rewind();
      const r = await resetDemoData(ctx.database, opts.ejariMockUrl ?? "http://localhost:4100");
      return c.json({ ok: true, today: ctx.clock.today(), ...r });
    });
    registerTenancyDemoRoutes(api, ctx);
  }

  app.route("/api", api);
  return app;
}
