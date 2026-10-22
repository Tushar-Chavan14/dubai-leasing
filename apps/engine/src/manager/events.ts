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
import { companyPolicy, leaseEvents, leases, type Tx } from "@leasing/db";
import { desc, eq, lte } from "drizzle-orm";
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
      : e.rulesVersion;
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
