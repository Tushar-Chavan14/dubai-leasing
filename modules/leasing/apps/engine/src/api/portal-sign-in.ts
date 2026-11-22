import { createExchangeLimiter, issueToken, portalExchange } from "@platform/kernel";
import { portalHandoffs, staffUsers } from "@leasing/db";
import { and, eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { z } from "zod";
import type { EngineContext } from "../context.ts";
import type { AuthEnv } from "./auth.ts";

const Body = z.object({ token: z.string().min(1).max(2000) });

/**
 * Portal sign-in (C38, S70). The portal says who the person is; the role comes only from this module's own
 * `staff_users` row. No match is a 403: a user is never created, activated or changed here. `?check=1` answers
 * whether the email has an active user and issues no session. Off (404) unless `LEASING_PORTAL_PUBLIC_KEY` is set.
 * Token expiry uses wall-clock time (`nowMs`); the used-token row is stamped with the engine Clock.
 */
export function registerPortalSignIn(
  app: Hono<AuthEnv>,
  ctx: EngineContext,
  opts: { sessionSecret: string; publicKey: string | undefined; nowMs: () => number },
) {
  const db = ctx.database.db;
  const limiter = createExchangeLimiter();
  app.post("/api/auth/portal-exchange", async (c) => {
    const body = Body.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "this sign-in link isn't valid", code: "unauthorised" }, 401);
    const nowMs = opts.nowMs();
    const r = await portalExchange(
      {
        publicKey: opts.publicKey,
        audience: "leasing",
        nowMs,
        limiter,
        takeJti: async (jti) =>
          (
            await db
              .insert(portalHandoffs)
              .values({ jti, usedAt: ctx.clock.now() })
              .onConflictDoNothing()
              .returning({ jti: portalHandoffs.jti })
          ).length === 1,
        findUser: async (email) =>
          (
            await db
              .select()
              .from(staffUsers)
              .where(and(sql`lower(${staffUsers.email}) = ${email}`, eq(staffUsers.active, true)))
          )[0] ?? null,
      },
      { token: body.data.token, check: c.req.query("check") === "1", ip: c.req.header("x-client-ip") ?? "direct" },
    );
    if ("body" in r) return c.json(r.body, r.status);
    if (r.kind === "check") return c.json({ active: r.active }, 200);
    const u = r.user;
    return c.json(
      {
        token: issueToken(opts.sessionSecret, u.id, nowMs),
        user: { id: u.id, name: u.name, email: u.email, role: u.role },
      },
      200,
    );
  });
}
