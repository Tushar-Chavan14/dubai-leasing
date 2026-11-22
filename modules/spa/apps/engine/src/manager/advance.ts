import {
  DEAL_GATE_OUTCOMES,
  type DealEvent,
  type DealMachineEvent,
  dealMachine,
  type GateOutcome,
  type ListingEvent,
  listingMachine,
  routeDealEvent,
  type SpaActor,
  type SpaGateId,
  type UnitEvent,
  unitMachine,
} from "@spa/core";
import { deals, listings, type SpaEntityKind, spaApprovals, type SpaTx, units, withSpaTx } from "@spa/db";
import { eq } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { conflict, notFound, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { DealRow } from "./facts.ts";
import { supersedeAgreementOnCancel } from "./agreement-cancel.ts";
import { supersedeOnCancel } from "./settlement.ts";

export interface AdvanceOptions {
  actor: SpaActor;
  /** Required for a gated step: a decided, unused approval of that gate for this deal. */
  approvalId?: string;
  payload?: Record<string, unknown>;
  /** The deal's pinned rulebook version, passed to unit and listing events. */
  rulesVersion?: string | null;
  /** Join the caller's transaction. */
  tx?: SpaTx;
}
export interface AdvanceResult {
  eventId: string;
  from: string;
  to: string;
  machineEvent: string;
}
type Entity = { kind: SpaEntityKind; id: string };

/** The AML moves are written to the timeline as a compliance review, never by name (S50, tipping-off). */
const AML_MOVES: ReadonlySet<string> = new Set(["AML_FLAGGED", "AML_CLEARED", "AML_STOPPED"]);

/**
 * The only way a deal, unit or listing changes state (architecture §1.2). In one transaction: lock the row, route the
 * event by deal type, check the transition, its guard (facts) and its gate, write the state, append the event,
 * consume the approval and cascade to the unit or listing. Any refusal rolls everything back.
 */
export async function advance(
  ctx: SpaContext,
  entity: { kind: "deal"; id: string },
  event: DealEvent,
  opts: AdvanceOptions,
): Promise<AdvanceResult> {
  // Units and listings move only as part of a deal step (final review #2): never on their own from outside.
  if ((entity as Entity).kind !== "deal")
    throw conflict("deal_only", "units and listings change only through their deal");
  const run = (tx: SpaTx) => advanceDeal(ctx, tx, entity.id, event, opts);
  return opts.tx ? run(opts.tx) : withSpaTx(ctx.database, run);
}

/** Internal: moves the unit or listing a deal step touches, inside that step's transaction (cascades, createDeal). */
export function moveProperty(
  ctx: SpaContext,
  tx: SpaTx,
  entity: { kind: "unit" | "listing"; id: string },
  event: UnitEvent | ListingEvent,
  opts: Omit<AdvanceOptions, "tx" | "approvalId">,
): Promise<AdvanceResult> {
  return entity.kind === "unit"
    ? advanceUnit(ctx, tx, entity.id, event as UnitEvent, opts)
    : advanceListing(ctx, tx, entity.id, event as ListingEvent, opts);
}

async function advanceDeal(ctx: SpaContext, tx: SpaTx, id: string, event: DealEvent, opts: AdvanceOptions) {
  const [deal] = await tx.db.select().from(deals).where(eq(deals.id, id)).for("update");
  if (!deal) throw notFound("deal");
  const machineEvent = routeDealEvent(event, {
    type: deal.dealType,
    sellerMortgage: deal.sellerMortgage,
    buyerMortgage: deal.buyerMortgage,
    planTakenOver: deal.planTakenOver,
  });
  const t = dealMachine.transitions.find((x) => x.from === deal.state && x.event === machineEvent);
  if (!t) throw conflict("transition_not_allowed", `a deal in ${deal.state} does not accept ${event}`);
  const g = t.guard?.(await ctx.facts.deal(tx, deal, ctx.clock.today(), { amlListVersion: ctx.amlListVersion }));
  if (g && !g.ok) throw unprocessable("guard_failed", `can't ${event}`, g.reasons);
  const approvalId = t.gate
    ? await usableApproval(tx, t.gate, { kind: "deal", id }, machineEvent, opts.approvalId)
    : undefined;
  await tx.db.update(deals).set({ state: t.to }).where(eq(deals.id, id));
  const eventId = await appendDealEvent(tx, ctx, {
    entity: { kind: "deal", id },
    type: AML_MOVES.has(event) ? "COMPLIANCE_REVIEW_RECORDED" : event,
    rulesVersion: deal.rulesVersion,
    fromState: deal.state,
    toState: t.to,
    actor: opts.actor,
    // System fields last: a caller's payload can't overwrite them (final review #5).
    payload: {
      ...(AML_MOVES.has(event) ? {} : opts.payload),
      machineEvent: AML_MOVES.has(machineEvent) ? "compliance_review" : machineEvent,
      approvalId: approvalId ?? undefined,
    },
  });
  if (approvalId)
    await tx.db.update(spaApprovals).set({ consumedByEventId: eventId }).where(eq(spaApprovals.id, approvalId));
  await cascade(ctx, tx, deal, machineEvent, t.to, opts.actor);
  await ctx.onDealEntered?.({ dealId: id, to: t.to }, tx);
  return { eventId, from: deal.state, to: t.to, machineEvent };
}

/** What a deal step does to its unit (primary) or listing (resale), per S35 decision 4. */
async function cascade(ctx: SpaContext, tx: SpaTx, deal: DealRow, ev: DealMachineEvent, to: string, actor: SpaActor) {
  const step = { actor, rulesVersion: deal.rulesVersion, payload: { dealId: deal.id } };
  // S48: a cancelled deal's live settlement statement is superseded and its approval cancelled.
  if (to === "CANCELLED") {
    await supersedeOnCancel(ctx, tx, deal.id, actor);
    await supersedeAgreementOnCancel(ctx, tx, deal.id, actor);
  }
  if (deal.unitId) {
    const unit = { kind: "unit" as const, id: deal.unitId };
    if (ev === "ALL_SIGNED_PRIMARY") await moveProperty(ctx, tx, unit, "SELL", step);
    else if (ev === "REGISTERED") await moveProperty(ctx, tx, unit, "REGISTER", step);
    else if (ev === "HANDOVER") await moveProperty(ctx, tx, unit, "HAND_OVER", step);
    else if (to === "CANCELLED") await moveProperty(ctx, tx, unit, "RELEASE", step);
  } else if (deal.listingId) {
    const listing = { kind: "listing" as const, id: deal.listingId };
    if (ev === "TRANSFERRED_COMPLETE" || ev === "TRANSFERRED_PLAN") await moveProperty(ctx, tx, listing, "SELL", step);
    else if (to === "CANCELLED") await moveProperty(ctx, tx, listing, "OFFER_CLOSED", step);
  }
}

async function advanceUnit(ctx: SpaContext, tx: SpaTx, id: string, event: UnitEvent, opts: AdvanceOptions) {
  const [unit] = await tx.db.select().from(units).where(eq(units.id, id)).for("update");
  if (!unit) throw notFound("unit");
  const t = unitMachine.transitions.find((x) => x.from === unit.state && x.event === event);
  if (!t) throw conflict("transition_not_allowed", `a unit in ${unit.state} does not accept ${event}`);
  await tx.db.update(units).set({ state: t.to }).where(eq(units.id, id));
  const eventId = await appendDealEvent(tx, ctx, {
    entity: { kind: "unit", id },
    type: event,
    rulesVersion: opts.rulesVersion ?? null,
    fromState: unit.state,
    toState: t.to,
    actor: opts.actor,
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
  return { eventId, from: unit.state, to: t.to, machineEvent: event };
}

async function advanceListing(ctx: SpaContext, tx: SpaTx, id: string, event: ListingEvent, opts: AdvanceOptions) {
  const [listing] = await tx.db.select().from(listings).where(eq(listings.id, id)).for("update");
  if (!listing) throw notFound("listing");
  const t = listingMachine.transitions.find((x) => x.from === listing.state && x.event === event);
  if (!t) throw conflict("transition_not_allowed", `a listing in ${listing.state} does not accept ${event}`);
  const g = t.guard?.(await ctx.facts.listing(tx, listing, ctx.clock.today()));
  if (g && !g.ok) throw unprocessable("guard_failed", `can't ${event}`, g.reasons);
  await tx.db.update(listings).set({ state: t.to }).where(eq(listings.id, id));
  const eventId = await appendDealEvent(tx, ctx, {
    entity: { kind: "listing", id },
    type: event,
    rulesVersion: opts.rulesVersion ?? null,
    fromState: listing.state,
    toState: t.to,
    actor: opts.actor,
    ...(opts.payload ? { payload: opts.payload } : {}),
  });
  return { eventId, from: listing.state, to: t.to, machineEvent: event };
}

/** The approval a gated step uses: same gate and deal, decided with an accepted outcome, never used before. */
async function usableApproval(
  tx: SpaTx,
  gate: SpaGateId,
  entity: Entity,
  event: DealMachineEvent,
  approvalId: string | undefined,
): Promise<string> {
  if (!approvalId) throw conflict("gate_required", `${gate} approval required`);
  const [a] = await tx.db.select().from(spaApprovals).where(eq(spaApprovals.id, approvalId)).for("update");
  if (!a) throw conflict("gate_required", `${gate} approval not found`);
  const got: GateOutcome | null =
    gate === "aml_flag"
      ? ((a.outcome as GateOutcome | null) ?? null)
      : a.status === "approved" || a.status === "edited"
        ? "approved"
        : a.status === "rejected"
          ? "rejected"
          : null;
  const reasons: string[] = [];
  if (a.gate !== gate) reasons.push(`approval for ${a.gate}, not ${gate}`);
  if (a.entityKind !== entity.kind || a.entityId !== entity.id) reasons.push("approval for another record");
  if (!got || !(DEAL_GATE_OUTCOMES[event] ?? ["approved"]).includes(got))
    reasons.push(`approval is ${a.outcome ?? a.status}`);
  if (a.consumedByEventId) reasons.push("approval was already used");
  if (reasons.length) throw conflict("gate_required", `${gate} approval not usable: ${reasons.join("; ")}`, reasons);
  return a.id;
}
