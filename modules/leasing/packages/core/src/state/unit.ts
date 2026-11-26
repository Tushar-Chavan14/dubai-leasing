import { z } from "zod";
import type { CalendarDate } from "../dates.ts";
import { askingRentWithinRange, type PriceRange, type PropertyCategory } from "../portfolio.ts";
import { allow, defineMachine, deny, type GuardResult } from "./machine.ts";

export const UnitState = z.enum(["PREP", "READY", "LISTED", "OCCUPIED"]);
export type UnitState = z.infer<typeof UnitState>;

export const UnitEvent = z.enum(["MARK_READY", "PUBLISH", "WITHDRAW", "LEASE_ACTIVATED", "LEASE_CLOSED"]);
export type UnitEvent = z.infer<typeof UnitEvent>;

export interface UnitSnapshot {
  category: PropertyCategory;
  dldPropertyNo: string | null;
  unitNo: string | null;
  makaniNo: string | null;
  areaSqft: number | null;
  bedrooms: number | null;
  furnished: boolean | null;
  dewaPremiseNo: string | null;
  askingRentFils: number | null;
  priceApprovedAt: Date | null;
  ownUseLockUntil: CalendarDate | null;
}

export interface UnitGuardContext {
  unit: UnitSnapshot;
  today: CalendarDate;
  /** Allowed asking-rent range from the rulebook and SRI; null when none applies. */
  priceRange: PriceRange | null;
  /** True while any lease on the unit still has an uncancelled Ejari registration. */
  hasActiveEjari: boolean;
  /** True while a lease on the unit is contracted but not yet active (CONTRACT, REGISTRATION, MOVE_IN). */
  hasContractedLease: boolean;
}

const CHECKLIST: [keyof UnitSnapshot, string][] = [
  ["dldPropertyNo", "DLD property number"],
  ["unitNo", "unit number"],
  ["makaniNo", "Makani number"],
  ["areaSqft", "area"],
  ["bedrooms", "bedrooms"],
  ["furnished", "furnished flag"],
  ["dewaPremiseNo", "DEWA premise number"],
];

export function unitChecklistMissing(unit: UnitSnapshot): string[] {
  return CHECKLIST.filter(([k]) => k !== "bedrooms" || unit.category === "residential")
    .filter(([k]) => unit[k] === null || unit[k] === "")
    .map(([, label]) => label);
}

function readyGuard({ unit, priceRange }: UnitGuardContext): GuardResult {
  const reasons = unitChecklistMissing(unit).map((m) => `missing ${m}`);
  if (unit.askingRentFils === null) reasons.push("asking rent not set");
  else if (!unit.priceApprovedAt && !askingRentWithinRange(unit, priceRange)) {
    reasons.push("asking rent outside company range and not approved");
  }
  return reasons.length ? deny(...reasons) : allow;
}

function publishGuard(ctx: UnitGuardContext): GuardResult {
  const reasons: string[] = [];
  if (ctx.hasActiveEjari) reasons.push("a previous Ejari registration is still active");
  if (ctx.hasContractedLease) reasons.push("the unit is already under contract");
  if (ctx.unit.ownUseLockUntil && ctx.today < ctx.unit.ownUseLockUntil) {
    reasons.push(`own-use lock until ${ctx.unit.ownUseLockUntil}`);
  }
  const ready = readyGuard(ctx);
  if (!ready.ok) reasons.push(...ready.reasons);
  return reasons.length ? deny(...reasons) : allow;
}

export const unitMachine = defineMachine<UnitState, UnitEvent, UnitGuardContext>({
  entity: "unit",
  states: UnitState.options,
  events: UnitEvent.options,
  initial: "PREP",
  terminal: [],
  transitions: [
    {
      from: "PREP",
      event: "MARK_READY",
      to: "READY",
      guard: readyGuard,
      description: "checklist complete + price approved or in range",
    },
    { from: "READY", event: "PUBLISH", to: "LISTED", guard: publishGuard, description: "publish listing" },
    ...(["LISTED", "READY"] as const).map((from) => ({
      from,
      event: "WITHDRAW" as const,
      to: "PREP" as const,
      // A unit with a signed-up lease must stay where the lease's activation can find it.
      guard: (c: UnitGuardContext) => (c.hasContractedLease ? deny("the unit is under contract") : allow),
      description: from === "LISTED" ? "withdraw listing" : "back to preparation",
    })),
    { from: "LISTED", event: "LEASE_ACTIVATED", to: "OCCUPIED", description: "lease became ACTIVE" },
    {
      from: "READY",
      event: "LEASE_ACTIVATED",
      to: "OCCUPIED",
      description: "contracted (unlisted) unit's lease became ACTIVE",
    },
    {
      from: "OCCUPIED",
      event: "LEASE_CLOSED",
      to: "PREP",
      guard: (c) => (c.hasActiveEjari ? deny("Ejari not cancelled") : allow),
      description: "lease CLOSED and Ejari cancelled",
    },
  ],
});
