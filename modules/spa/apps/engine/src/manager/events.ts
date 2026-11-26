import { newId } from "@platform/kernel/ids";
import { maskPii } from "@platform/kernel/pii";
import type { SpaActor } from "@spa/core";
import { dealEvents, type SpaEntityKind, type SpaTx } from "@spa/db";
import type { SpaContext } from "./context.ts";

export interface DealEventInput {
  entity: { kind: SpaEntityKind; id: string };
  type: string;
  fromState?: string;
  toState?: string;
  actor: SpaActor;
  payload?: Record<string, unknown>;
  /** The rulebook version the deal is pinned to (null for settings events). */
  rulesVersion?: string | null;
}

/** Appends one `deal_events` row (append-only). PII in the payload is masked; time is the SPA Clock's. */
export async function appendDealEvent(tx: SpaTx, ctx: SpaContext, e: DealEventInput): Promise<string> {
  const id = newId();
  await tx.db.insert(dealEvents).values({
    id,
    entityKind: e.entity.kind,
    entityId: e.entity.id,
    type: e.type,
    fromState: e.fromState ?? null,
    toState: e.toState ?? null,
    actor: e.actor,
    payload: maskPii(e.payload ?? {}),
    rulesVersion: e.rulesVersion ?? null,
    at: ctx.clock.now(),
  });
  return id;
}
