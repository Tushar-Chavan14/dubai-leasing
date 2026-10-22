import type { GateId } from "../gates.ts";

export type GuardResult = { ok: true } | { ok: false; reasons: string[] };
export const allow: GuardResult = { ok: true };
export const deny = (...reasons: string[]): GuardResult => ({ ok: false, reasons });

export interface Transition<S extends string, E extends string, Ctx> {
  from: S;
  event: E;
  to: S;
  /** A gated transition needs an approved, unused approval of this gate for the entity. */
  gate?: GateId;
  /** Pure check over a snapshot the Manager loads inside the transaction. */
  guard?: (ctx: Ctx) => GuardResult;
  description: string;
}

export interface StateMachine<S extends string, E extends string, Ctx> {
  entity: "unit" | "application" | "lease";
  states: readonly S[];
  events: readonly E[];
  initial: S;
  terminal: readonly S[];
  transitions: readonly Transition<S, E, Ctx>[];
}

export function findTransition<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  from: S,
  event: E,
): Transition<S, E, Ctx> | undefined {
  return machine.transitions.find((t) => t.from === from && t.event === event);
}

export function canTransitionTo<S extends string, E extends string, Ctx>(
  machine: StateMachine<S, E, Ctx>,
  from: S,
  to: S,
): boolean {
  return machine.transitions.some((t) => t.from === from && t.to === to);
}

export function eventsFrom<S extends string, E extends string, Ctx>(machine: StateMachine<S, E, Ctx>, from: S): E[] {
  return machine.transitions.filter((t) => t.from === from).map((t) => t.event);
}

export function defineMachine<S extends string, E extends string, Ctx>(
  m: StateMachine<S, E, Ctx>,
): StateMachine<S, E, Ctx> {
  for (const t of m.transitions) {
    if (!m.states.includes(t.from) || !m.states.includes(t.to)) {
      throw new Error(`${m.entity}: transition ${t.from} -${t.event}-> ${t.to} uses an unknown state`);
    }
    if (!m.events.includes(t.event)) throw new Error(`${m.entity}: unknown event ${t.event}`);
  }
  const keys = m.transitions.map((t) => `${t.from}:${t.event}`);
  if (new Set(keys).size !== keys.length) throw new Error(`${m.entity}: duplicate (from, event) pair`);
  return Object.freeze(m);
}
