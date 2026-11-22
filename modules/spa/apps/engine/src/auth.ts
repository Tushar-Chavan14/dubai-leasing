import { verifyToken } from "@platform/kernel";
import { type SpaRole } from "@spa/core";
import { type SpaDatabase, spaUsers } from "@spa/db";
import { and, eq } from "drizzle-orm";
import type { MiddlewareHandler } from "hono";

/** A signed-in SPA staff user (from `spa_users`, never leasing's `staff_users`). */
export interface SpaUser {
  id: string;
  email: string;
  name: string;
  role: SpaRole;
}
export type AuthEnv = { Variables: { user: SpaUser } };

/**
 * Bearer session tokens, the same approach as the leasing engine (kernel `issueToken`/`verifyToken`) with SPA's own
 * secret, so a leasing token never works here. Expiry uses wall-clock time, not the demo clock.
 */
export function requireUser(database: SpaDatabase, secret: string, nowMs: () => number): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const uid = header.startsWith("Bearer ") ? verifyToken(secret, header.slice(7), nowMs()) : null;
    if (!uid) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    const [u] = await database.db
      .select()
      .from(spaUsers)
      .where(and(eq(spaUsers.id, uid), eq(spaUsers.active, true)));
    if (!u) return c.json({ error: "unauthorised", code: "unauthorised" }, 401);
    c.set("user", { id: u.id, email: u.email, name: u.name, role: u.role });
    await next();
  };
}

/** Hash every password the same way (argon2id). */
export const hashPassword = (password: string): Promise<string> => Bun.password.hash(password, "argon2id");

/** A real hash to check against when the email is unknown, so a wrong email takes as long as a wrong password. */
let dummy: Promise<string> | null = null;
export async function checkPassword(password: string, hash: string | null): Promise<boolean> {
  if (hash) return Bun.password.verify(password, hash);
  dummy ??= hashPassword("not-a-real-password");
  await Bun.password.verify(password, await dummy);
  return false;
}
