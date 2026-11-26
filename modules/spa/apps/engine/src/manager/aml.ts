import { newId } from "@platform/kernel/ids";
import { assessRisk, DEFAULT_SPA_AML_POLICY, type RiskInput, SpaAmlPolicy, type SpaActor, type SpaRole, hasRole } from "@spa/core";
import { dealParties, deals, riskAssessments, type SpaDb, spaAmlPolicy, type SpaTx, withSpaTx } from "@spa/db";
import { and, desc, eq } from "drizzle-orm";
import { proposeApproval } from "./approvals.ts";
import type { SpaContext } from "./context.ts";
import { forbidden, notFound, takingVersion, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";

const AML_SETTINGS = { kind: "settings" as const, id: "00000000-0000-7000-8000-000000000004" };

/** The latest published AML policy, else the code default (version 0). */
export async function currentAmlPolicy(db: SpaDb): Promise<{ version: number; values: SpaAmlPolicy }> {
  const [row] = await db.select().from(spaAmlPolicy).orderBy(desc(spaAmlPolicy.version)).limit(1);
  return row
    ? { version: row.version, values: SpaAmlPolicy.parse(row.values) }
    : { version: 0, values: DEFAULT_SPA_AML_POLICY };
}

/** An admin or compliance officer publishes a new AML policy version (S20, S42). Versions never change. */
export async function publishAmlPolicy(
  ctx: SpaContext,
  input: unknown,
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ version: number }> {
  if (!hasRole(user, "admin") && !hasRole(user, "compliance_officer"))
    throw forbidden("only an admin or a compliance officer publishes the AML policy");
  const parsed = SpaAmlPolicy.safeParse(input);
  if (!parsed.success)
    throw unprocessable(
      "invalid_aml_policy",
      "the AML policy isn't valid",
      parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`),
    );
  return takingVersion(() =>
    withSpaTx(ctx.database, async (tx) => {
      const [latest] = await tx.db
        .select()
        .from(spaAmlPolicy)
        .orderBy(desc(spaAmlPolicy.version))
        .limit(1)
        .for("update");
      const version = (latest?.version ?? 0) + 1;
      await tx.db
        .insert(spaAmlPolicy)
        .values({ version, values: parsed.data, createdBy: `user:${user.id}`, createdAt: ctx.clock.now() });
      await appendDealEvent(tx, ctx, {
        entity: AML_SETTINGS,
        type: "AML_POLICY_PUBLISHED",
        actor: `user:${user.id}`,
        payload: { version },
      });
      return { version };
    }),
  );
}

/**
 * Records one party's risk assessment by code (S20): the hits and points stay on the compliance-only row with the
 * policy and rulebook versions; a high level opens `edd_signoff` for the compliance officer, flag or not.
 */
export async function recordRiskAssessment(
  ctx: SpaContext,
  input: { dealId: string; partyId: string } & Omit<RiskInput, "priceFils">,
  actor: SpaActor,
): Promise<RiskRecord> {
  return withSpaTx(ctx.database, (tx) => recordRiskAssessmentIn(tx, ctx, input, actor));
}

export interface RiskRecord {
  id: string;
  level: string;
  flagged: boolean;
  points: number;
  eddApprovalId?: string;
}

/** Same as `recordRiskAssessment`, inside the caller's transaction (C18 screening records one per party). */
export async function recordRiskAssessmentIn(
  tx: SpaTx,
  ctx: SpaContext,
  input: { dealId: string; partyId: string } & Omit<RiskInput, "priceFils">,
  actor: SpaActor,
): Promise<RiskRecord> {
  const [d] = await tx.db.select().from(deals).where(eq(deals.id, input.dealId));
  if (!d) throw notFound("deal");
  const [onDeal] = await tx.db
    .select({ id: dealParties.partyId })
    .from(dealParties)
    .where(and(eq(dealParties.dealId, d.id), eq(dealParties.partyId, input.partyId)));
  if (!onDeal) throw unprocessable("party_not_on_deal", "this party isn't on the deal");
  const policy = await currentAmlPolicy(tx.db);
  const r = assessRisk(
    { hits: input.hits, partyType: input.partyType, paymentMethod: input.paymentMethod, priceFils: d.priceFils },
    policy.values,
  );
  const id = newId();
  await tx.db.insert(riskAssessments).values({
    id,
    dealId: d.id,
    partyId: input.partyId,
    policyVersion: policy.version,
    rulesVersion: d.rulesVersion,
    points: r.points,
    level: r.level,
    flagged: r.flagged,
    detail: { hits: input.hits, breakdown: r.breakdown },
    createdBy: actor,
    createdAt: ctx.clock.now(),
  });
  // The timeline says only that a review happened (S6): no level, points or hits.
  await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id: d.id },
    type: "COMPLIANCE_REVIEW_RECORDED",
    actor,
    rulesVersion: d.rulesVersion,
    payload: { assessmentId: id },
  });
  if (!r.eddRequired) return { id, level: r.level, flagged: r.flagged, points: r.points };
  const p = await proposeApproval(
    ctx,
    {
      gate: "edd_signoff",
      entity: { kind: "deal", id: d.id },
      dedupeKey: `${d.id}:edd_signoff:${input.partyId}`,
      title: "Compliance review",
      proposal: { assessmentId: id, partyId: input.partyId, policyVersion: policy.version },
      proposedBy: actor,
    },
    tx,
  );
  return { id, level: r.level, flagged: r.flagged, points: r.points, eddApprovalId: p.id };
}
