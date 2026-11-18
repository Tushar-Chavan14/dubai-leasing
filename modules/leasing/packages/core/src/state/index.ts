import { applicationMachine } from "./application.ts";
import { leaseMachine } from "./lease.ts";
import { unitMachine } from "./unit.ts";

export * from "./application.ts";
export * from "./lease.ts";
export * from "./machine.ts";
export * from "./unit.ts";

export const machines = { unit: unitMachine, application: applicationMachine, lease: leaseMachine } as const;

/** Pure check used by UIs and tests: is there any transition from `from` to `to`? */
export function canTransition(entity: keyof typeof machines, from: string, to: string): boolean {
  const m = machines[entity] as { transitions: readonly { from: string; to: string }[] };
  return m.transitions.some((t) => t.from === from && t.to === to);
}
