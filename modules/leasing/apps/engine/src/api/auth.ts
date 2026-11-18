import { issueToken, verifyToken } from "@platform/kernel/session-token";
import type { StaffRole, StaffUser } from "@leasing/core";
import { type Database, staffUsers } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";
import { forbidden } from "../errors.ts";

/**
 * Staff session tokens: base64url(JSON {uid, exp}) + "." + HMAC-SHA256, 12 hours. Phase 0 has a demo login
 * (pick a seeded user) only; real staff login (SSO or passwords) comes before any client pilot. The token functions
 * live in the shared kernel (S4, P2) so SPA uses the same code with its own secret.
 */
export { issueToken, verifyToken };

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
