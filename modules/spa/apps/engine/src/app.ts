import { issueToken } from "@platform/kernel";
import { SPA_ROLE_LABELS } from "@spa/core";
import { type SpaDatabase, spaUsers } from "@spa/db";
import { asc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";
import { type AuthEnv, checkPassword, requireUser } from "./auth.ts";
import type { SpaDemoClock } from "./clock.ts";
import type { Jobs } from "./jobs.ts";

export interface AppDeps {
  database: SpaDatabase;
  jobs: Pick<Jobs, "boss" | "lastHeartbeat">;
  clock: SpaDemoClock;
  sessionSecret: string;
  demoMode: boolean;
  /** Wall-clock time for session expiry (not a legal date). */
  nowMs: () => number;
}

// Emails are stored lower case (a database check); sign-in matches whatever case is typed.
const email = () =>
  z
    .email()
    .max(200)
    .transform((e) => e.toLowerCase());
const SignIn = z.object({ email: email(), password: z.string().min(1).max(200) });
const DemoSignIn = z.object({ email: email() });

/**
 * The SPA engine API (S2: :4001, own database, jobs and clock). Routes are chained so the web app's `hc` client gets
 * their types from `SpaApp`.
 */
export function createApp(deps: AppDeps) {
  const { database, clock } = deps;
  const auth = requireUser(database, deps.sessionSecret, deps.nowMs);
  const session = (u: { id: string; name: string; email: string; role: (typeof spaUsers.$inferSelect)["role"] }) => ({
    token: issueToken(deps.sessionSecret, u.id, deps.nowMs()),
    user: { id: u.id, name: u.name, email: u.email, role: u.role },
  });

  const app = new Hono<AuthEnv>()
    .get("/health", async (c) => {
      const db = await database.pool
        .query("select 1")
        .then(() => true)
        .catch(() => false);
      const jobs = await deps.jobs.boss
        .getQueue("spa.heartbeat")
        .then((q) => !!q)
        .catch(() => false);
      await clock.refresh().catch(() => {});
      const ok = db && jobs;
      return c.json(
        {
          ok,
          db,
          jobs,
          heartbeatAt: deps.jobs.lastHeartbeat()?.toISOString() ?? null,
          clock: { today: clock.today(), offsetDays: clock.offsetDays, demo: deps.demoMode },
        },
        ok ? 200 : 503,
      );
    })
    .post("/api/auth/sign-in", async (c) => {
      const body = SignIn.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "enter your email and password", code: "invalid_request" }, 400);
      const [u] = await database.db.select().from(spaUsers).where(eq(spaUsers.email, body.data.email));
      const ok = await checkPassword(body.data.password, u?.active ? u.passwordHash : null);
      // One answer for a wrong email, a wrong password, an inactive user and a user without a password.
      if (!u || !ok) return c.json({ error: "wrong email or password", code: "unauthorised" }, 401);
      return c.json(session(u), 200);
    })
    .get("/api/auth/demo-users", async (c) => {
      if (!deps.demoMode) return c.json({ error: "not found", code: "not_found" }, 404);
      const rows = await database.db
        .select({ email: spaUsers.email, name: spaUsers.name, role: spaUsers.role })
        .from(spaUsers)
        .where(eq(spaUsers.active, true))
        .orderBy(asc(spaUsers.role));
      return c.json(
        rows.map((r) => ({ ...r, roleLabel: SPA_ROLE_LABELS[r.role] })),
        200,
      );
    })
    .post("/api/auth/demo-sign-in", async (c) => {
      if (!deps.demoMode) return c.json({ error: "not found", code: "not_found" }, 404);
      const body = DemoSignIn.safeParse(await c.req.json().catch(() => null));
      if (!body.success) return c.json({ error: "choose a demo user", code: "invalid_request" }, 400);
      const [u] = await database.db.select().from(spaUsers).where(eq(spaUsers.email, body.data.email));
      if (!u?.active) return c.json({ error: "not found", code: "not_found" }, 404);
      return c.json(session(u), 200);
    })
    .get("/api/me", auth, (c) => {
      const u = c.get("user");
      return c.json({ ...u, roleLabel: SPA_ROLE_LABELS[u.role] }, 200);
    })
    .get("/api/demo/clock", auth, async (c) => {
      await clock.refresh();
      return c.json({ today: clock.today(), offsetDays: clock.offsetDays, demo: deps.demoMode }, 200);
    });
  return app;
}

export type SpaApp = ReturnType<typeof createApp>;
