import { createHmac, timingSafeEqual } from "node:crypto";
import type { StaffRole, StaffUser } from "@leasing/core";
import { type Database, staffUsers } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
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
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; exp: number };
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
