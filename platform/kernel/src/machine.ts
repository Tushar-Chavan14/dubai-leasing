/**
 * State-machine building blocks shared by every module (S4). A machine names its own entity and, through `G`, the
 * gates its transitions may require; the module's Manager is still the only one that applies a transition.
 */
export type GuardResult = { ok: true } | { ok: false; reasons: string[] };
export const allow: GuardResult = { ok: true };
export const deny = (...reasons: string[]): GuardResult => ({ ok: false, reasons });

export interface Transition<S extends string, E extends string, Ctx, G extends string = string> {
  from: S;
  event: E;
  to: S;
  /** A gated transition needs an approved, unused approval of this gate for the entity. */
  gate?: G;
  /** Pure check over a snapshot the Manager loads inside the transaction. */
  guard?: (ctx: Ctx) => GuardResult;
  description: string;
}

export interface StateMachine<S extends string, E extends string, Ctx, G extends string = string> {
  entity: string;
  states: readonly S[];
  events: readonly E[];
  initial: S;
  terminal: readonly S[];
  transitions: readonly Transition<S, E, Ctx, G>[];
}

export function findTransition<S extends string, E extends string, Ctx, G extends string = string>(
  machine: StateMachine<S, E, Ctx, G>,
  from: S,
  event: E,
): Transition<S, E, Ctx, G> | undefined {
  return machine.transitions.find((t) => t.from === from && t.event === event);
}

export function canTransitionTo<S extends string, E extends string, Ctx, G extends string = string>(
  machine: StateMachine<S, E, Ctx, G>,
  from: S,
  to: S,
): boolean {
  return machine.transitions.some((t) => t.from === from && t.to === to);
}

export function eventsFrom<S extends string, E extends string, Ctx, G extends string = string>(
  machine: StateMachine<S, E, Ctx, G>,
  from: S,
): E[] {
  return machine.transitions.filter((t) => t.from === from).map((t) => t.event);
}

export function defineMachine<S extends string, E extends string, Ctx, G extends string = string>(
  m: StateMachine<S, E, Ctx, G>,
): StateMachine<S, E, Ctx, G> {
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
