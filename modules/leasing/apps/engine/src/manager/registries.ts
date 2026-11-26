import type { RegistrationAdapter } from "@leasing/adapters";
import { type Emirate, EMIRATE_LABELS, formatAed, registrationSystemName } from "@leasing/core";
import { leases, units, type Tx } from "@leasing/db";
import { registrationFeeFils, registrationFeeFor } from "@leasing/rulebook";
import { eq } from "drizzle-orm";
import type { EngineContext } from "../context.ts";
import { notFound } from "../errors.ts";
import { getCompanyPolicy } from "./events.ts";
import { createTask } from "./milestones.ts";

/** The registration adapter for an emirate, or null when staff must register by hand there. */
export function registryFor(ctx: EngineContext, emirate: Emirate): RegistrationAdapter | null {
  return ctx.registries[emirate] ?? null;
}

/** The emirate of the lease's unit. */
export async function leaseEmirate(tx: Tx, lease: Pick<typeof leases.$inferSelect, "unitId">): Promise<Emirate> {
  const [u] = await tx.db.select({ emirate: units.emirate }).from(units).where(eq(units.id, lease.unitId));
  // Never assume Dubai: a lease without its unit is a data error, not a Dubai lease.
  if (!u) throw notFound("unit");
  return u.emirate;
}

/** Title of the officer task raised when an emirate has no registration adapter. */
export function unsupportedRegistrationTitle(emirate: Emirate, leaseRef: string): string {
  return `No registration system set up for ${EMIRATE_LABELS[emirate]} (${registrationSystemName(emirate)}): register lease ${leaseRef} by hand`;
}

/** Raises the "register by hand" task (once per lease). */
export async function raiseUnsupportedRegistration(
  ctx: EngineContext,
  tx: Tx,
  lease: Pick<typeof leases.$inferSelect, "id" | "ref">,
  emirate: Emirate,
) {
  await createTask(ctx, tx, lease.id, {
    kind: "registration_unsupported",
    title: unsupportedRegistrationTitle(emirate, lease.ref),
    details: { emirate, system: registrationSystemName(emirate) },
    assigneeRole: "leasing_officer",
    dueOn: ctx.clock.today(),
    dedupeKey: `${lease.id}:registration_unsupported`,
  });
}

/**
 * The registration fee the tenant pays on top of an offer, or null when the landlord pays or the
 * emirate has no fee schedule. Computed on render from the code-versioned schedule; never stored
 * in the offer terms.
 */
export async function offerRegistrationFee(
  ctx: EngineContext,
  tx: Tx,
  emirate: Emirate,
  annualRentFils: number,
): Promise<{ systemName: string; feeFils: number } | null> {
  const today = ctx.clock.today();
  if ((await getCompanyPolicy(tx, today)).registrationFeePaidBy !== "tenant") return null;
  const schedule = registrationFeeFor(emirate, today);
  if (!schedule) return null;
  return { systemName: registrationSystemName(emirate), feeFils: registrationFeeFils(schedule.rule, annualRentFils) };
}

/** "Registration fee (Ejari): AED x, paid by you." for the offer email, or null. */
export async function offerRegistrationFeeLine(
  ctx: EngineContext,
  tx: Tx,
  emirate: Emirate,
  annualRentFils: number,
): Promise<string | null> {
  const f = await offerRegistrationFee(ctx, tx, emirate, annualRentFils);
  return f ? `Registration fee (${f.systemName}): ${formatAed(f.feeFils)}, paid by you.` : null;
}
