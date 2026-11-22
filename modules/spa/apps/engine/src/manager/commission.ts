/** The approval row behind a broker's commission override, as the queries read it (nulls when none is linked). */
export interface CommissionApproval {
  status: string | null;
  gate: string | null;
  entityId: string | null;
  proposal: Record<string, unknown> | null;
}

/**
 * Whether an override of the policy commission may be used (S40 amendment, review 13): only when the linked approval
 * is an approved `price_out_of_range` of this deal whose proposal names this side and exactly this %. An approval of
 * another gate, deal, side or % (or one not approved) never counts.
 */
export function overrideApproved(
  a: CommissionApproval | null,
  deal: { id: string },
  broker: { side: string; commissionBps: number },
): boolean {
  return (
    !!a &&
    a.status === "approved" &&
    a.gate === "price_out_of_range" &&
    a.entityId === deal.id &&
    a.proposal?.side === broker.side &&
    a.proposal?.commissionBps === broker.commissionBps
  );
}
