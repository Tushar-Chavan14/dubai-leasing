import { type SpaDatabase, portalHandoffs, spaUsers } from "@spa/db";
import { and, eq } from "drizzle-orm";
import type { SpaContext } from "./context.ts";

/** What the exchange needs of a user: the module's own row, nothing from the portal's token (S70). */
export interface ExchangeUser {
  id: string;
  name: string;
  email: string;
  role: (typeof spaUsers.$inferSelect)["role"];
}

/** True the first time a portal token's `jti` is seen. The row is written with the engine Clock. */
export async function takeHandoff(ctx: Pick<SpaContext, "database" | "clock">, jti: string): Promise<boolean> {
  const rows = await ctx.database.db
    .insert(portalHandoffs)
    .values({ jti, usedAt: ctx.clock.now() })
    .onConflictDoNothing()
    .returning({ jti: portalHandoffs.jti });
  return rows.length === 1;
}

/** The active SPA user for a lower-case email. Never creates, activates or changes a user or a role. */
export async function findActiveUser(database: SpaDatabase, email: string): Promise<ExchangeUser | null> {
  const [u] = await database.db
    .select({ id: spaUsers.id, name: spaUsers.name, email: spaUsers.email, role: spaUsers.role })
    .from(spaUsers)
    .where(and(eq(spaUsers.email, email.toLowerCase()), eq(spaUsers.active, true)));
  return u ?? null;
}
