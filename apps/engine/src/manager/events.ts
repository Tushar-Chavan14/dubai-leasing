import {
  type Actor,
  type CompanyPolicy,
  CompanyPolicy as CompanyPolicySchema,
  type EntityRef,
  maskPii,
  newId,
  defaultCompanyPolicy,
  type CalendarDate,
} from "@leasing/core";
import { applications, companyPolicy, leaseEvents, leases, type Tx, units } from "@leasing/db";
import { activeRulesVersion } from "@leasing/rulebook";
import { and, desc, eq, lte, ne } from "drizzle-orm";
import type { EngineContext } from "../context.ts";

export interface EventInput {
  entity: EntityRef;
  type: string;
  actor: Actor;
  fromState?: string | null;
  toState?: string | null;
  payload?: Record<string, unknown>;
  rulesVersion?: string | null;
}

/**
 * Appends to the audit log. Payloads are PII-masked before they are stored. A lease event without
 * an explicit `rulesVersion` records the version pinned on the lease (rule 4).
 */
export async function appendEvent(tx: Tx, ctx: EngineContext, e: EventInput): Promise<string> {
  const id = newId();
  const rulesVersion =
    e.rulesVersion === undefined && e.entity.kind === "lease"
      ? await leaseRulesVersion(tx, e.entity.id)
      : await unitRulesVersion(tx, ctx, e.entity, e.rulesVersion);
  await tx.db.insert(leaseEvents).values({
    id,
    entityKind: e.entity.kind,
    entityId: e.entity.id,
    type: e.type,
    fromState: e.fromState ?? null,
    toState: e.toState ?? null,
    actor: e.actor,
    payload: maskPii(e.payload ?? {}),
    rulesVersion: rulesVersion ?? null,
    at: ctx.clock.now(),
  });
  return id;
}

/**
 * Rule 4 for units and applications. The engine's default version is Dubai's, so for these entities it is replaced
 * by the version that actually governs them: the version pinned on their lease (an application's lease, or the
 * unit's lease that is not closed yet), else the version active today in the unit's emirate, else null when that
 * emirate has no rulebook (offers and leases there are refused). Any other version passed explicitly is kept.
 */
export async function unitRulesVersion(
  tx: Tx,
  ctx: EngineContext,
  entity: EntityRef,
  given: string | null | undefined,
): Promise<string | null | undefined> {
  if (given !== ctx.rulesVersion || (entity.kind !== "application" && entity.kind !== "unit")) return given;
  const [pinned] = await tx.db
    .select({ rulesVersion: leases.rulesVersion })
    .from(leases)
    .where(
      entity.kind === "application"
        ? eq(leases.applicationId, entity.id)
        : and(eq(leases.unitId, entity.id), ne(leases.state, "CLOSED")),
    )
    .orderBy(desc(leases.createdAt))
    .limit(1);
  if (pinned) return pinned.rulesVersion;
  const [row] =
    entity.kind === "unit"
      ? await tx.db.select({ emirate: units.emirate }).from(units).where(eq(units.id, entity.id))
      : await tx.db
          .select({ emirate: units.emirate })
          .from(applications)
          .innerJoin(units, eq(units.id, applications.unitId))
          .where(eq(applications.id, entity.id));
  if (!row) return given;
  return activeRulesVersion(ctx.clock.today(), row.emirate);
}

/** Company policy in force on `today` (latest version), or the defaults if none is stored. */
export async function getCompanyPolicy(tx: Tx, today: CalendarDate): Promise<CompanyPolicy> {
  return (await getCompanyPolicyVersion(tx, today)).values;
}

/** Same, with the stored version number (null for the built-in defaults). */
export async function getCompanyPolicyVersion(
  tx: Tx,
  today: CalendarDate,
): Promise<{ version: number | null; values: CompanyPolicy }> {
  const [row] = await tx.db
    .select()
    .from(companyPolicy)
    .where(lte(companyPolicy.effectiveFrom, today))
    .orderBy(desc(companyPolicy.version))
    .limit(1);
  return row
    ? { version: row.version, values: CompanyPolicySchema.parse(row.values) }
    : { version: null, values: defaultCompanyPolicy };
}

/** The rulebook version pinned on a lease, for events recorded against it. */
export async function leaseRulesVersion(tx: Tx, leaseId: string): Promise<string | null> {
  const [row] = await tx.db.select({ v: leases.rulesVersion }).from(leases).where(eq(leases.id, leaseId));
  return row?.v ?? null;
}
