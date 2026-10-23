import { sha256Hex } from "@leasing/core/tokens";
import { customerAccounts } from "@leasing/db";
import { eq, sql } from "drizzle-orm";
import type { Hono } from "hono";
import { setCookie } from "hono/cookie";
import type { EngineContext } from "../context.ts";
import { requestLoginCode, updateCustomerProfile, verifyLoginCode } from "../manager/customer-auth.ts";
import {
  type AuthEnv,
  CUSTOMER_COOKIE,
  CUSTOMER_SESSION_DAYS,
  type CustomerEnv,
  issueCustomerToken,
  requireCustomer,
} from "./auth.ts";

const WINDOW_MS = 3_600_000;
const MAX_CODE_REQUESTS_PER_IP = 20;
const hits = new Map<string, { n: number; until: number }>();

/** Per-IP limit on code requests (wall-clock, in memory, like the portal's limiter). */
function ipLimited(ipHash: string): boolean {
  const now = Date.now();
  if (hits.size > 10_000) for (const [k, v] of hits) if (v.until < now) hits.delete(k);
  const h = hits.get(ipHash);
  if (!h || h.until < now) {
    hits.set(ipHash, { n: 1, until: now + WINDOW_MS });
    return false;
  }
  h.n++;
  return h.n > MAX_CODE_REQUESTS_PER_IP;
}

/**
 * Customer web-chat API: email-code login and the customer's own account. Outside the staff
 * session; `requireCustomer` accepts customer tokens only (a staff token has no `aud: "customer"`).
 */
export function registerCustomerRoutes(app: Hono<AuthEnv>, ctx: EngineContext, opts: { sessionSecret: string }): void {
  const guard = requireCustomer(ctx.database, opts.sessionSecret);
  const customer = app as unknown as Hono<CustomerEnv>;

  app.post("/api/customer/auth/code", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: unknown };
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0]!.trim();
    const ipHash = sha256Hex(ip);
    if (ipLimited(ipHash)) return c.json({ error: "Too many requests; try again later." }, 429);
    return c.json(await requestLoginCode(ctx, body.email, ipHash), 202);
  });

  app.post("/api/customer/auth/verify", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { email?: unknown; code?: unknown };
    const { account, needsProfile } = await verifyLoginCode(ctx, body.email, body.code);
    const [row] = await ctx.database.db
      .select({ sv: customerAccounts.sessionVersion })
      .from(customerAccounts)
      .where(eq(customerAccounts.id, account.id));
    const token = issueCustomerToken(opts.sessionSecret, account.id, row!.sv, Date.now());
    setCookie(c, CUSTOMER_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: CUSTOMER_SESSION_DAYS * 86_400,
    });
    return c.json({ token, needsProfile, account });
  });

  customer.get("/api/customer/me", guard, (c) => c.json(c.get("customer")));

  customer.post("/api/customer/profile", guard, async (c) =>
    c.json(await updateCustomerProfile(ctx, c.get("customer").id, await c.req.json().catch(() => ({})))),
  );

  // Bumping the version signs this account out everywhere, not just on this device.
  customer.post("/api/customer/logout", guard, async (c) => {
    await ctx.database.db
      .update(customerAccounts)
      .set({ sessionVersion: sql`${customerAccounts.sessionVersion} + 1` })
      .where(eq(customerAccounts.id, c.get("customer").id));
    setCookie(c, CUSTOMER_COOKIE, "", { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 0 });
    return c.body(null, 204);
  });
}
