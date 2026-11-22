import { defineMachine } from "@platform/kernel/machine";
import type { SpaGateId } from "../gates.ts";

/** A developer's unit (architecture §4). No guards of its own: the deal that moves it decides. */
export type UnitState = "AVAILABLE" | "HELD" | "SOLD" | "REGISTERED" | "HANDED_OVER";
export type UnitEvent = "HOLD" | "RELEASE" | "SELL" | "REGISTER" | "HAND_OVER";

export const unitMachine = defineMachine<UnitState, UnitEvent, null, SpaGateId>({
  entity: "unit",
  states: ["AVAILABLE", "HELD", "SOLD", "REGISTERED", "HANDED_OVER"],
  events: ["HOLD", "RELEASE", "SELL", "REGISTER", "HAND_OVER"],
  initial: "AVAILABLE",
  terminal: ["HANDED_OVER"],
  transitions: [
    { from: "AVAILABLE", event: "HOLD", to: "HELD", description: "A primary deal reserves the unit" },
    { from: "HELD", event: "RELEASE", to: "AVAILABLE", description: "The deal was cancelled or the hold expired" },
    { from: "SOLD", event: "RELEASE", to: "AVAILABLE", description: "A signed deal was cancelled before registration" },
    { from: "HELD", event: "SELL", to: "SOLD", description: "Every party signed" },
    { from: "SOLD", event: "REGISTER", to: "REGISTERED", description: "Oqood registration issued" },
    { from: "REGISTERED", event: "HAND_OVER", to: "HANDED_OVER", description: "Keys handed over" },
  ],
});
