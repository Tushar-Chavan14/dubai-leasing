import { newId } from "@platform/kernel/ids";
import { DealType, SpaKycConfig, SpaKycRole, type SpaRole, starterKycConfig } from "@spa/core";
import { type SpaDb, spaKycConfigs, withSpaTx } from "@spa/db";
import { and, desc, eq, max } from "drizzle-orm";
import { z } from "zod";
import type { SpaContext } from "./context.ts";
import { conflict, forbidden, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";

const KYC_SETTINGS = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000003" };
const Target = z.object({ role: SpaKycRole, dealType: DealType.optional() });
const scopeOf = (dealType?: string | null) => dealType ?? "any";
const adminOnly = (user: { role: SpaRole }) => {
  if (user.role !== "admin") throw forbidden("only an admin changes KYC settings");
};

/** Saves (or replaces) the draft config for a role and scope (S19). Validated on save; nothing is in force yet. */
export async function saveKycDraft(
  ctx: SpaContext,
  input: { role: string; dealType?: string; config: unknown },
  user: { id: string; role: SpaRole },
): Promise<{ id: string }> {
  adminOnly(user);
  const t = Target.parse({ role: input.role, dealType: input.dealType });
  const parsed = SpaKycConfig.safeParse(input.config);
  if (!parsed.success)
    throw unprocessable(
      "invalid_kyc_config",
      "the KYC settings aren't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return withSpaTx(ctx.database, async (tx) => {
    const scope = scopeOf(t.dealType);
    await tx.db
      .delete(spaKycConfigs)
      .where(and(eq(spaKycConfigs.role, t.role), eq(spaKycConfigs.scope, scope), eq(spaKycConfigs.status, "draft")));
    const id = newId();
    await tx.db.insert(spaKycConfigs).values({
      id,
      role: t.role,
      scope,
      status: "draft",
      values: parsed.data,
      createdBy: `user:${user.id}`,
      createdAt: ctx.clock.now(),
    });
    await appendDealEvent(tx, ctx, {
      entity: KYC_SETTINGS,
      type: "KYC_DRAFT_SAVED",
      actor: `user:${user.id}`,
      payload: { role: t.role, scope },
    });
    return { id };
  });
}

/** Publishes the draft as the next version (S41). Published versions never change; checks record the version used. */
export async function publishKycDraft(
  ctx: SpaContext,
  input: { role: string; dealType?: string },
  user: { id: string; role: SpaRole },
): Promise<{ version: number }> {
  adminOnly(user);
  const t = Target.parse(input);
  const scope = scopeOf(t.dealType);
  return withSpaTx(ctx.database, async (tx) => {
    const [draft] = await tx.db
      .select()
      .from(spaKycConfigs)
      .where(and(eq(spaKycConfigs.role, t.role), eq(spaKycConfigs.scope, scope), eq(spaKycConfigs.status, "draft")))
      .for("update");
    if (!draft) throw conflict("no_draft", "there is no draft to publish");
    const [{ v } = { v: null }] = await tx.db
      .select({ v: max(spaKycConfigs.version) })
      .from(spaKycConfigs)
      .where(and(eq(spaKycConfigs.role, t.role), eq(spaKycConfigs.scope, scope)));
    const version = (v ?? 0) + 1;
    await tx.db
      .update(spaKycConfigs)
      .set({ status: "published", version, publishedAt: ctx.clock.now() })
      .where(eq(spaKycConfigs.id, draft.id));
    await appendDealEvent(tx, ctx, {
      entity: KYC_SETTINGS,
      type: "KYC_PUBLISHED",
      actor: `user:${user.id}`,
      payload: { role: t.role, scope, version },
    });
    return { version };
  });
}

/** The config in force for a party: the deal type's override, else the role's, else the starter (version 0). */
export async function effectiveKycConfig(
  db: SpaDb,
  role: SpaKycRole,
  dealType: DealType | null,
): Promise<{ version: number; scope: string; config: SpaKycConfig }> {
  for (const scope of dealType ? [dealType, "any"] : ["any"]) {
    const [row] = await db
      .select()
      .from(spaKycConfigs)
      .where(and(eq(spaKycConfigs.role, role), eq(spaKycConfigs.scope, scope), eq(spaKycConfigs.status, "published")))
      .orderBy(desc(spaKycConfigs.version))
      .limit(1);
    if (row) return { version: row.version!, scope, config: SpaKycConfig.parse(row.values) };
  }
  return { version: 0, scope: "starter", config: starterKycConfig(role) };
}
