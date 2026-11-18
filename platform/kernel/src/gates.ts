/**
 * Human gates, for any module (S4). A module lists its gates and who decides each; the Manager creates the approval
 * and pauses, and only a person in that module's inbox decides. Nothing here approves anything.
 */
export interface GateDefinition<G extends string, R extends string> {
  id: G;
  label: string;
  when: "always" | "conditional";
  approver: R;
}

export interface GateSet<G extends string, R extends string> {
  gates: Readonly<Record<G, GateDefinition<G, R>>>;
  /** Who may decide a gate: its named approver, or a role the module lets stand in for that approver. */
  canDecide(gate: G, role: R): boolean;
}

/**
 * Builds a module's gate table. `standIn` maps an approver role to roles that may also decide its gates (leasing: a
 * leasing manager for leasing-officer gates). The table is frozen; each entry's `id` must equal its key.
 */
export function defineGates<G extends string, R extends string>(
  gates: Record<G, GateDefinition<G, R>>,
  opts: { standIn?: Partial<Record<R, readonly R[]>> } = {},
): GateSet<G, R> {
  for (const [key, def] of Object.entries(gates) as [string, GateDefinition<G, R>][]) {
    if (def.id !== key) throw new Error(`gate ${key}: id is ${def.id}`);
  }
  const frozen = Object.freeze(gates) as Readonly<Record<G, GateDefinition<G, R>>>;
  const standIn = opts.standIn ?? {};
  return {
    gates: frozen,
    canDecide(gate, role) {
      const approver = frozen[gate].approver;
      const others: readonly R[] | undefined = (standIn as Partial<Record<R, readonly R[]>>)[approver];
      return role === approver || (others?.includes(role) ?? false);
    },
  };
}
