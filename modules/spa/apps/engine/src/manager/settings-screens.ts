import { DealType, type SpaKycRole, SPA_KYC_ROLES, SpaKycRole as KycRoleSchema, type SpaRole, hasAnyRole, hasRole } from "@spa/core";
import { spaAmlPolicy, spaKycConfigs } from "@spa/db";
import { desc } from "drizzle-orm";
import { z } from "zod";
import { currentAmlPolicy, publishAmlPolicy } from "./aml.ts";
import type { SpaContext } from "./context.ts";
import { forbidden, unprocessable } from "./errors.ts";
import { effectiveKycConfig, publishKycDraft, saveKycDraft } from "./kyc-config.ts";

/** Who looks at the KYC forms: an admin edits, a sales manager reads (S66). */
const KYC_READERS: readonly SpaRole[] = ["admin", "sales_manager"];
const SCOPES = ["any", ...DealType.options] as const;

const Query = z.object({ role: KycRoleSchema.optional(), dealType: DealType.optional() });
const Target = z.object({ role: KycRoleSchema, dealType: DealType.optional() });
export const KycDraftBody = Target.extend({ config: z.unknown() });

function needKycReader(user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }) {
  if (!hasAnyRole(user, KYC_READERS)) throw forbidden("you can't view the KYC forms");
}

/**
 * Settings → KYC forms (S41, S66). Without a role it lists every role and deal-type override with the version in force
 * and whether a draft waits; with a role (and a deal type for an override) it gives the form in force, the draft if any
 * and the published versions. A published version is only ever read: a change is a new draft, then a new version.
 */
export async function getKycSettings(ctx: SpaContext, user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }, query: unknown) {
  needKycReader(user);
  const q = Query.safeParse(query);
  if (!q.success) throw unprocessable("invalid_request", "that query isn't valid");
  const rows = await ctx.database.db
    .select({
      role: spaKycConfigs.role,
      scope: spaKycConfigs.scope,
      status: spaKycConfigs.status,
      version: spaKycConfigs.version,
      values: spaKycConfigs.values,
      publishedAt: spaKycConfigs.publishedAt,
    })
    .from(spaKycConfigs)
    .orderBy(desc(spaKycConfigs.version));
  if (!q.data.role) {
    return {
      items: SPA_KYC_ROLES.flatMap((role) =>
        SCOPES.map((scope) => {
          const own = rows.filter((r) => r.role === role && r.scope === scope);
          const published = own.find((r) => r.status === "published");
          return {
            role: role as SpaKycRole,
            dealType: scope === "any" ? null : scope,
            scope,
            version: published?.version ?? null,
            hasDraft: own.some((r) => r.status === "draft"),
          };
        }),
      ),
    };
  }
  const { role, dealType } = q.data;
  const scope = dealType ?? "any";
  const own = rows.filter((r) => r.role === role && r.scope === scope);
  const effective = await effectiveKycConfig(ctx.database.db, role, dealType ?? null);
  return {
    role,
    dealType: dealType ?? null,
    scope,
    effective,
    draft: own.find((r) => r.status === "draft")?.values ?? null,
    versions: own
      .filter((r) => r.status === "published")
      .map((r) => ({ version: r.version!, publishedAt: r.publishedAt?.toISOString() ?? null })),
  };
}

export const saveKycSettings = (ctx: SpaContext, user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }, body: unknown) => {
  if (!hasRole(user, "admin")) throw forbidden("only an admin changes KYC settings");
  const p = KycDraftBody.safeParse(body);
  if (!p.success) throw unprocessable("invalid_request", "send a role, an optional deal type and the form");
  return saveKycDraft(
    ctx,
    { role: p.data.role, ...(p.data.dealType ? { dealType: p.data.dealType } : {}), config: p.data.config },
    user,
  );
};

export const publishKycSettings = (ctx: SpaContext, user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }, body: unknown) => {
  if (!hasRole(user, "admin")) throw forbidden("only an admin changes KYC settings");
  const p = Target.safeParse(body);
  if (!p.success) throw unprocessable("invalid_request", "send a role and an optional deal type");
  return publishKycDraft(ctx, { role: p.data.role, ...(p.data.dealType ? { dealType: p.data.dealType } : {}) }, user);
};

/** The compliance rules page: the compliance officer publishes, the MLRO reads, nobody else sees it (S57, S66). */
export async function getAmlPolicySettings(ctx: SpaContext, user: { role: SpaRole; roles?: readonly SpaRole[] | undefined }) {
  if (!hasRole(user, "compliance_officer") && !hasRole(user, "mlro")) throw forbidden("you can't do this");
  const current = await currentAmlPolicy(ctx.database.db);
  const history = await ctx.database.db
    .select({ version: spaAmlPolicy.version, createdAt: spaAmlPolicy.createdAt })
    .from(spaAmlPolicy)
    .orderBy(desc(spaAmlPolicy.version))
    .limit(20);
  return {
    version: current.version,
    values: current.values,
    // Version 0 is the code's placeholder: compliance sets its own before relying on it.
    confirmWithCompliance: current.version === 0,
    mayPublish: hasRole(user, "compliance_officer"),
    history: history.map((h) => ({ version: h.version, createdAt: h.createdAt.toISOString() })),
  };
}

/**
 * Publishes the AML policy from the compliance page. Only the compliance officer: this route refuses an admin and the
 * MLRO. The manager's own rule (S42) is unchanged and recorded as a follow-up in S66.
 */
export function putAmlPolicy(ctx: SpaContext, user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }, body: unknown) {
  if (!hasRole(user, "compliance_officer")) throw forbidden("you can't do this");
  return publishAmlPolicy(ctx, body, user);
}
