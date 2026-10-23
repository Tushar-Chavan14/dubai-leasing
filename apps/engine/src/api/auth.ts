import { createHmac, timingSafeEqual } from "node:crypto";
import type { CustomerAccount, StaffRole, StaffUser } from "@leasing/core";
import { type Database, customerAccounts, staffUsers } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { forbidden } from "../errors.ts";

/**
 * Staff session tokens: base64url(JSON {uid, exp}) + "." + HMAC-SHA256. Phase 0 has a demo login
 * (pick a seeded user) only; real staff login (SSO or passwords) comes before any client pilot.
 */
const SESSION_HOURS = 12;

const b64 = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const sign = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

export function issueToken(secret: string, userId: string, nowMs: number): string {
  const body = b64(JSON.stringify({ uid: userId, exp: nowMs + SESSION_HOURS * 3_600_000 }));
  return `${body}.${sign(secret, body)}`;
}

export function verifyToken(secret: string, token: string, nowMs: number): string | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; exp: number; aud?: unknown };
    // A token for another audience (a customer's) is never a staff token.
    if (parsed.aud !== undefined) return null;
    const { uid, exp } = parsed;
    return typeof uid === "string" && typeof exp === "number" && exp > nowMs ? uid : null;
  } catch {
    return null;
  }
}

export type AuthEnv = { Variables: { user: StaffUser } };

export function requireUser(database: Database, secret: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    // Session expiry uses wall-clock time, not the demo clock.
    const uid = header.startsWith("Bearer ") ? verifyToken(secret, header.slice(7), Date.now()) : null;
    if (!uid) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    const [u] = await database.db
      .select()
      .from(staffUsers)
      .where(and(eq(staffUsers.id, uid), eq(staffUsers.active, true)));
    if (!u) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    c.set("user", { id: u.id, email: u.email, name: u.name, role: u.role });
    await next();
  };
}

export function requireRole(user: StaffUser, roles: StaffRole[]): void {
  if (!roles.includes(user.role)) throw forbidden(`${user.role} can't do this`);
}

/**
 * Customer session tokens (web chat): same signing, but the body carries `aud: "customer"` and the
 * account's `sessionVersion`, so bumping the version signs the account out everywhere.
 */
export const CUSTOMER_COOKIE = "leasing_customer";
export const CUSTOMER_SESSION_DAYS = 30;

export function issueCustomerToken(secret: string, accountId: string, sessionVersion: number, nowMs: number): string {
  const body = b64(
    JSON.stringify({
      aid: accountId,
      aud: "customer",
      sv: sessionVersion,
      exp: nowMs + CUSTOMER_SESSION_DAYS * 86_400_000,
    }),
  );
  return `${body}.${sign(secret, body)}`;
}

export function verifyCustomerToken(secret: string, token: string, nowMs: number): { aid: string; sv: number } | null {
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(secret, body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString()) as {
      aid: unknown;
      aud: unknown;
      sv: unknown;
      exp: unknown;
    };
    if (p.aud !== "customer" || typeof p.aid !== "string" || typeof p.sv !== "number") return null;
    return typeof p.exp === "number" && p.exp > nowMs ? { aid: p.aid, sv: p.sv } : null;
  } catch {
    return null;
  }
}

export type CustomerEnv = { Variables: { customer: CustomerAccount } };

/** Accepts the token as a Bearer header or the `leasing_customer` cookie. */
export function requireCustomer(database: Database, secret: string): MiddlewareHandler<CustomerEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : getCookie(c, CUSTOMER_COOKIE);
    // Session expiry uses wall-clock time, not the demo clock.
    const claims = token ? verifyCustomerToken(secret, token, Date.now()) : null;
    if (!claims) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    const [a] = await database.db.select().from(customerAccounts).where(eq(customerAccounts.id, claims.aid));
    if (!a || a.sessionVersion !== claims.sv) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    c.set("customer", { id: a.id, email: a.email, fullName: a.fullName ?? "", phone: a.phone });
    await next();
  };
}
