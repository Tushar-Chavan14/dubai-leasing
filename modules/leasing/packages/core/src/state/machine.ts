import {
  defineMachine as defineKernelMachine,
  type StateMachine as KernelMachine,
  type Transition as KernelTransition,
} from "@platform/kernel/machine";
import type { GateId } from "../gates.ts";

/** The machine helpers live in the shared kernel (S4); leasing machines may only name leasing gates. */
export { allow, canTransitionTo, deny, eventsFrom, findTransition, type GuardResult } from "@platform/kernel/machine";

export type Transition<S extends string, E extends string, Ctx> = KernelTransition<S, E, Ctx, GateId>;
export interface StateMachine<S extends string, E extends string, Ctx> extends KernelMachine<S, E, Ctx, GateId> {
  entity: "unit" | "application" | "lease";
}

/** The kernel's `defineMachine` with leasing's entities and gates. */
export function defineMachine<S extends string, E extends string, Ctx>(
  m: StateMachine<S, E, Ctx>,
): StateMachine<S, E, Ctx> {
  defineKernelMachine<S, E, Ctx, GateId>(m);
  return m;
}
