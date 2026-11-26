import { DEFAULT_SPA_POLICY, SpaPolicy, type SpaRole, hasRole } from "@spa/core";
import { type SpaDb, spaPolicy, withSpaTx } from "@spa/db";
import { desc, eq } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, takingVersion, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";

/** The settings record company-policy events are logged against. */
export const POLICY_ENTITY = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000001" };

/** The latest published policy, else the code default (version 0). */
export async function currentPolicy(db: SpaDb): Promise<{ version: number; values: SpaPolicy }> {
  const [row] = await db.select().from(spaPolicy).orderBy(desc(spaPolicy.version)).limit(1);
  return row
    ? { version: row.version, values: SpaPolicy.parse(row.values) }
    : { version: 0, values: DEFAULT_SPA_POLICY };
}

/** Admin publishes a new policy version (C3). Versions never change; deals keep the one they started with. */
export async function publishPolicy(
  ctx: SpaContext,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
  /** `expectVersion`: refuse (409) unless this is still the latest version, checked inside the locking transaction. */
  opts: { expectVersion?: number } = {},
): Promise<{ version: number }> {
  if (!hasRole(user, "admin")) throw forbidden("only an admin publishes company policy");
  const parsed = SpaPolicy.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_policy",
      "the policy isn't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return takingVersion(() =>
    withSpaTx(ctx.database, async (tx) => {
      // Lock the newest row so two publishes can't take the same number (the primary key refuses it anyway).
      const [latest] = await tx.db.select().from(spaPolicy).orderBy(desc(spaPolicy.version)).limit(1).for("update");
      if (opts.expectVersion !== undefined && (latest?.version ?? 0) !== opts.expectVersion)
        throw conflict("stale_policy", "someone saved a newer version; look again and try once more");
      const version = (latest?.version ?? 0) + 1;
      await tx.db
        .insert(spaPolicy)
        .values({ version, values: parsed.data, createdBy: `user:${user.id}`, createdAt: ctx.clock.now() });
      await appendDealEvent(tx, ctx, {
        entity: POLICY_ENTITY,
        type: "POLICY_PUBLISHED",
        actor: `user:${user.id}`,
        payload: { version },
      });
      return { version };
    }),
  );
}

/** The policy a deal was pinned to (S37): version 0 is the code default. */
export async function policyAt(db: SpaDb, version: number): Promise<SpaPolicy> {
  if (version === 0) return DEFAULT_SPA_POLICY;
  const [row] = await db.select().from(spaPolicy).where(eq(spaPolicy.version, version));
  if (!row) throw new Error(`policy version ${version} is missing`);
  return SpaPolicy.parse(row.values);
}
