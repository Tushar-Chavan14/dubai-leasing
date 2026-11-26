import {
  type Actor,
  type CalendarDate,
  type Emirate,
  EMIRATE_LABELS,
  type OfferTerms,
  type TermValues,
} from "@leasing/core";
import { applications, leases, type Tx, units } from "@leasing/db";
import { type OfferPolicy, planTermChange, type TermPlan } from "@leasing/helpers";
import { hasRulebookFor, rulesVersionForTerm } from "@leasing/rulebook";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { conflict, notFound } from "../errors.ts";
import { appendEvent } from "./events.ts";
import { offerPolicyAndRuleFor } from "./pricing.ts";

/**
 * D72: lease-term changes by the leasing team through the change marks. The Manager owns the write (rule 2): the
 * plan comes from `planTermChange` (code), a value outside the offer limits needs a leasing manager (rule 3), and
 * every change is an audit event with the actor, the old and new values and the rules version (rule 4).
 */

export interface TermInputs {
  lease: typeof leases.$inferSelect;
  app: typeof applications.$inferSelect | null;
  unit: typeof units.$inferSelect;
  policy: OfferPolicy;
  /** The lease's terms as an offer record (rent-free days, reservation and expiry come from the accepted offer). */
  current: OfferTerms;
  today: CalendarDate;
}

export async function termInputs(ctx: EngineContext, tx: Tx, leaseId: string, lock = false): Promise<TermInputs> {
  const q = tx.db.select().from(leases).where(eq(leases.id, leaseId));
  const [lease] = lock ? await q.for("update") : await q;
  if (!lease) throw notFound("lease");
  const [unit] = await tx.db.select().from(units).where(eq(units.id, lease.unitId));
  if (!unit) throw notFound("unit");
  if (!unit.askingRentFils) throw conflict("The unit has no approved asking rent.", "no_asking_rent");
  const [app] = lease.applicationId
    ? await tx.db.select().from(applications).where(eq(applications.id, lease.applicationId))
    : [];
  const o = app?.offer ?? null;
  const today = ctx.clock.today();
  const { policy } = await offerPolicyAndRuleFor(tx, unit, today);
  const current: OfferTerms = {
    revision: o?.revision ?? 1,
    annualRentFils: lease.annualRentFils,
    askingRentFils: o?.askingRentFils ?? unit.askingRentFils,
    cheques: lease.cheques,
    depositFils: lease.depositFils,
    rentFreeDays: o?.rentFreeDays ?? 0,
    moveInOn: o?.moveInOn ?? lease.startOn,
    startOn: lease.startOn,
    endOn: lease.endOn,
    reservationFils: o?.reservationFils ?? 0,
    expiresOn: o?.expiresOn ?? lease.startOn,
    ...(o?.fromCounter ? { fromCounter: true } : {}),
  };
  return { lease, app: app ?? null, unit, policy, current, today };
}

export function planFor(i: TermInputs, change: TermValues): TermPlan {
  return planTermChange(
    i.current,
    change,
    { askingRentFils: i.unit.askingRentFils!, furnished: !!i.unit.furnished },
    i.policy,
    i.today,
  );
}

/** The officer's term values of several marks merged; a value two marks set differently is a problem. */
export function mergeChanges(list: { n: number; change: TermValues }[]): { change: TermValues; problems: string[] } {
  const change: Record<string, unknown> = {};
  const from: Record<string, number> = {};
  const problems: string[] = [];
  for (const { n, change: c } of list) {
    for (const [k, v] of Object.entries(c)) {
      if (v === undefined) continue;
      if (k in change && change[k] !== v)
        problems.push(`Marks ${from[k]} and ${n} set the ${k} differently. Apply one.`);
      else {
        change[k] = v;
        from[k] = n;
      }
    }
  }
  return { change: change as TermValues, problems };
}

/** What `applyLeaseTerms` writes: the planned terms as they were shown (a frozen snapshot) and the values they replace. */
export interface TermSnapshot {
  terms: OfferTerms;
  /** Finance notes from the plan (reservation not changed). */
  notes?: string[];
  /** The current values of the terms that change; the write is refused if the lease no longer has them. */
  from: TermValues;
}

/**
 * Writes exactly the snapshot's terms: the lease (start, end, rent, cheques, deposit), the accepted offer on the
 * application (so the offer record matches), and the pinned rules version when the start date moves. Refused (409
 * stale) if the lease's terms are no longer the snapshot's `from`, and for a start date another lease of the unit
 * already has. Appends LEASE_TERMS_CHANGED. Runs inside the caller's transaction (the contract preparation's), so
 * the terms and the new version commit or roll back together.
 */
export async function applyLeaseTerms(
  ctx: EngineContext,
  tx: Tx,
  leaseId: string,
  snap: TermSnapshot,
  meta: { requestId: string; ref: string; marks: number[]; actor: Actor; approvalId?: string },
) {
  const i = await termInputs(ctx, tx, leaseId, true);
  if (i.lease.state !== "CONTRACT") {
    throw conflict(
      `The lease is in ${i.lease.state}; its terms change only while the contract is prepared.`,
      "wrong_state",
    );
  }
  for (const [k, v] of Object.entries(snap.from)) {
    if (v !== undefined && i.current[k as keyof TermValues] !== v)
      throw conflict("The lease terms changed since this was sent for approval.", "stale_terms");
  }
  const t = snap.terms;
  const startMoved = t.startOn !== i.lease.startOn;
  if (startMoved) {
    const [clash] = await tx.db
      .select({ id: leases.id })
      .from(leases)
      .where(
        and(eq(leases.unitId, i.lease.unitId), eq(leases.startOn, t.startOn as CalendarDate), ne(leases.id, leaseId)),
      )
      .limit(1);
    if (clash) throw conflict("Another lease of this unit starts on that date.", "lease_start_clash");
    const [overlap] = await tx.db
      .select({ ref: leases.ref })
      .from(leases)
      .where(
        and(
          eq(leases.unitId, i.lease.unitId),
          ne(leases.id, leaseId),
          ne(leases.state, "CLOSED"),
          lte(leases.startOn, t.endOn as CalendarDate),
          gte(leases.endOn, t.startOn as CalendarDate),
        ),
      )
      .limit(1);
    if (overlap) throw conflict(`The new term overlaps lease ${overlap.ref} of this unit.`, "lease_overlap");
    if (!hasRulebookFor(t.startOn as CalendarDate, i.unit.emirate))
      throw conflict(`no rulebook for ${EMIRATE_LABELS[i.unit.emirate]} yet`, "no_rulebook");
  }
  const rulesVersion = startMoved
    ? rulesVersionForTerm(t.startOn as CalendarDate, i.unit.emirate)
    : i.lease.rulesVersion;
  try {
    await tx.db
      .update(leases)
      .set({
        startOn: t.startOn as CalendarDate,
        endOn: t.endOn as CalendarDate,
        annualRentFils: t.annualRentFils,
        cheques: t.cheques,
        depositFils: t.depositFils,
        rulesVersion,
      })
      .where(eq(leases.id, leaseId));
  } catch (e) {
    // A concurrent lease took the same start date between the check and the write (leases_unit_start_uq).
    const code =
      (e as { code?: string; cause?: { code?: string } }).code ?? (e as { cause?: { code?: string } }).cause?.code;
    if (code === "23505") throw conflict("Another lease of this unit starts on that date.", "lease_start_clash");
    throw e;
  }
  if (i.app?.offer) {
    await tx.db
      .update(applications)
      .set({
        offer: {
          ...i.app.offer,
          annualRentFils: t.annualRentFils,
          cheques: t.cheques,
          depositFils: t.depositFils,
          moveInOn: t.moveInOn,
          startOn: t.startOn,
          endOn: t.endOn,
        },
      })
      .where(eq(applications.id, i.app.id));
  }
  const to: Record<string, unknown> = {};
  for (const k of Object.keys(snap.from)) to[k] = t[k as keyof TermValues];
  await appendEvent(tx, ctx, {
    entity: { kind: "lease", id: leaseId },
    type: "LEASE_TERMS_CHANGED",
    actor: meta.actor,
    payload: {
      requestId: meta.requestId,
      ref: meta.ref,
      marks: meta.marks,
      from: snap.from,
      to,
      ...(meta.approvalId ? { approvalId: meta.approvalId } : {}),
      ...(rulesVersion !== i.lease.rulesVersion ? { previousRulesVersion: i.lease.rulesVersion } : {}),
    },
    rulesVersion,
  });
}

/** Records in memory as they will be once the snapshot is written: for the contract's fields and input hash. */
export function termOverride(terms: OfferTerms, lease: { startOn: string; rulesVersion: string }, emirate: Emirate) {
  return {
    lease: {
      startOn: terms.startOn as CalendarDate,
      endOn: terms.endOn as CalendarDate,
      annualRentFils: terms.annualRentFils,
      cheques: terms.cheques,
      depositFils: terms.depositFils,
      rulesVersion:
        terms.startOn !== lease.startOn
          ? rulesVersionForTerm(terms.startOn as CalendarDate, emirate)
          : lease.rulesVersion,
    },
    offer: {
      annualRentFils: terms.annualRentFils,
      cheques: terms.cheques,
      depositFils: terms.depositFils,
      moveInOn: terms.moveInOn,
      startOn: terms.startOn,
      endOn: terms.endOn,
    },
  };
}
