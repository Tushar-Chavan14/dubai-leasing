import type { LocalDiskStore } from "@leasing/adapters";
import { leasingMetrics } from "../manager/metrics.ts";
import { resetDemoData } from "../demo/reset-data.ts";
import { seedMissingDemoLeases } from "../demo/seed.ts";
import { ApprovalDecision, AutopilotPatch, maskPiiText, newId, QUIET_HOURS_SAME } from "@leasing/core";
import { companies, companyPolicy, staffUsers, withTx } from "@leasing/db";
import { asc, desc, eq, sql } from "drizzle-orm";

import { type Context, Hono } from "hono";
import { z } from "zod";
import { unprocessable } from "../errors.ts";
import type { EngineDemoClock } from "../clock.ts";
import type { EngineContext } from "../context.ts";
import { DomainError, notFound } from "../errors.ts";
import { decideApproval } from "../manager/approvals.ts";
import { appendEvent, getCompanyPolicy, getCompanyPolicyVersion } from "../manager/events.ts";
import { importLeasesCsv, importUnitsCsv } from "../manager/import.ts";
import { sweepDueDeadlines } from "../manager/milestones.ts";
import { type AuthEnv, issueToken, requireRole, requireUser } from "./auth.ts";
import * as q from "./queries.ts";
import { registerApplicationRoutes } from "./applications.ts";
import { registerChannelRoutes, registerConversationRoutes } from "./channel.ts";
import { registerPublicRoutes } from "./public.ts";
import { registerTenancyDemoRoutes, registerTenancyRoutes } from "./tenancy.ts";
import { leaseContractView, registerContractRoutes } from "./contracts.ts";
import { registerCopilotRoutes } from "./copilot.ts";
import { registerPortalRoutes } from "./portal.ts";
import { registerPortfolioRoutes } from "./portfolio.ts";
import { registerCopilotReadRoutes } from "./copilot-reads.ts";
import { registerReadRoutes } from "./reads.ts";
import { registerRenewalRoutes } from "./renewals.ts";
import { registerStaffWorkRoutes } from "./staff-work.ts";
import { registerSriRoutes } from "./sri.ts";
import { registerLeaseDocumentRoutes } from "./lease-documents.ts";
import { registerRulebookRoutes } from "./rulebooks.ts";
import { registerUnitRoutes } from "./units.ts";
import { registerWorkspaceRoutes } from "./workspace.ts";

/** Advisory lock number that serializes autopilot saves. */
const AUTOPILOT_LOCK = 7_301_001;

/** POST /import/<kind>: admin or leasing manager; CSV body or {"csv": "..."}. */
const importRoute = (
  ctx: EngineContext,
  run: (
    csv: string,
    actor: `user:${string}`,
    companyId: string | null,
  ) => Promise<{ status: "imported" | "skipped" | "error" }[]>,
  /** Units import: each row names its `company`; `?company=` is only the default for rows without one (D44). */
  opts: { companyOptional?: boolean } = {},
) =>
  async function handler(c: Context<AuthEnv>) {
    requireRole(c.get("user"), ["admin", "leasing_manager"]);
    const slug = c.req.query("company");
    if (!slug && !opts.companyOptional)
      throw new DomainError("company is required: pass ?company=<slug>", 400, "company_required");
    const [company] = slug
      ? await ctx.database.db
          .select({ id: companies.id, active: companies.active })
          .from(companies)
          .where(eq(companies.slug, slug))
      : [null];
    if (slug && (!company || !company.active)) throw notFound("company");
    const type = c.req.header("content-type") ?? "";
    const csv = type.includes("application/json")
      ? z.object({ csv: z.string().min(1).max(2_000_000) }).parse(await c.req.json()).csv
      : await c.req.text();
    const rows = await run(csv, `user:${c.get("user").id}`, company?.id ?? null);
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
  // Public listings and the enquiry form: secret-authenticated, called by the web server only.
  registerPublicRoutes(app, ctx, opts.channelSecret, opts.mediaStore);

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
  // Always on: the rent index (pricing) and generated contract documents.
  registerSriRoutes(api, ctx);
  registerLeaseDocumentRoutes(api, ctx);
  registerStaffWorkRoutes(api, ctx);
  // Move-in through move-out: only with TENANCY_OPS.
  if (ctx.tenancyOps) registerRenewalRoutes(api, ctx);
  registerReadRoutes(api, ctx);
  registerWorkspaceRoutes(api, ctx);
  registerCopilotReadRoutes(api, ctx);
  registerRulebookRoutes(api, ctx);
  registerPortfolioRoutes(api, ctx);
  registerApplicationRoutes(api, ctx);
  registerContractRoutes(api, ctx);
  registerConversationRoutes(api, ctx);
  if (ctx.tenancyOps) registerTenancyRoutes(api, ctx);
  // The copilot calls this same app in-process, as the user (architecture §8b).
  registerCopilotRoutes(api, ctx, app);
  api.get("/policy", async (c) => c.json(await withTx(ctx.database, (tx) => getCompanyPolicy(tx, ctx.clock.today()))));
  api.put("/policy/autopilot", async (c) => {
    requireRole(c.get("user"), ["admin"]);
    const body = AutopilotPatch.parse(await c.req.json());
    const userId = c.get("user").id;
    const out = await withTx(ctx.database, async (tx) => {
      // Saves serialize: each reads the newest version and merges on its values.
      await tx.db.execute(sql`select pg_advisory_xact_lock(${AUTOPILOT_LOCK})`);
      const [latest] = await tx.db
        .select({ v: companyPolicy.version })
        .from(companyPolicy)
        .orderBy(desc(companyPolicy.version))
        .limit(1);
      const cur = await getCompanyPolicyVersion(tx, ctx.clock.today());
      const values = { ...cur.values, autopilot: { ...cur.values.autopilot, ...body } };
      if (values.autopilot.quiet_hours_start === values.autopilot.quiet_hours_end)
        throw new DomainError(QUIET_HOURS_SAME, 400, "quiet_hours_same", ["quiet_hours_end: " + QUIET_HOURS_SAME]);
      const before = cur.values.autopilot as Record<string, unknown>;
      const changed = Object.entries(body).some(([k, v]) => v !== undefined && before[k] !== v);
      if (!changed && cur.version !== null) return { version: cur.version, autopilot: cur.values.autopilot };
      const version = (latest?.v ?? 0) + 1;
      const policyId = newId();
      await tx.db.insert(companyPolicy).values({
        id: policyId,
        version,
        effectiveFrom: ctx.clock.today(),
        values,
        createdBy: `user:${userId}`,
      });
      // Audit (rule 4): who changed which toggle, from what to what. The policy is company-wide, so
      // the entity is the new policy row (kind "company").
      await appendEvent(tx, ctx, {
        entity: { kind: "company", id: policyId },
        type: "AUTOPILOT_CHANGED",
        actor: `user:${userId}`,
        payload: {
          policyVersion: version,
          previousVersion: cur.version,
          changes: Object.entries(body)
            .filter(([k, v]) => v !== undefined && before[k] !== v)
            .map(([step, to]) => ({ step, from: before[step], to })),
        },
        rulesVersion: null,
      });
      return { version, autopilot: values.autopilot };
    });
    return c.json(out);
  });
  api.get("/deadlines", async (c) => {
    const days = z.coerce.number().int().min(1).max(400).catch(60).parse(c.req.query("days"));
    return c.json(await q.upcomingDeadlines(db, ctx.clock.today(), days));
  });
  api.get("/tasks", async (c) => c.json(await q.listTasks(db, c.req.query("status") === "all" ? "all" : "open")));

  api.post(
    "/import/leases",
    importRoute(ctx, (csv, actor, companyId) => importLeasesCsv(ctx, csv, actor, companyId!)),
  );
  api.post(
    "/import/units",
    importRoute(ctx, (csv, actor, companyId) => importUnitsCsv(ctx, csv, actor, companyId), {
      companyOptional: true,
    }),
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
    if (ctx.tenancyOps) registerTenancyDemoRoutes(api, ctx);
  }

  app.route("/api", api);
  return app;
}
