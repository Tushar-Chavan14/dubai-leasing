import { dealMachine, type DealEvent, routeDealEvent, type SpaActor } from "@spa/core";
import { deals, type SpaTx, withSpaTx } from "@spa/db";
import { eq } from "drizzle-orm";
import { advance } from "./advance.ts";
import type { SpaContext } from "./context.ts";
import { notFound } from "./errors.ts";

const DRIVER: SpaActor = "system:driver";

/**
 * The automatic steps, in order: each is a deal step with no gate whose guard is the facts' alone. Anything with a gate
 * (legal, settlement, submission, a hold's clearing) is never here: a person decides those.
 */
const AUTOMATIC: readonly { from: string; event: DealEvent }[] = [
  { from: "OFFER_AGREED", event: "CHECKS_STARTED" },
  { from: "PARTY_CHECK", event: "CHECKS_PASSED" },
];

/**
 * Takes the next automatic step a deal's facts allow (S59). Nothing called `CHECKS_STARTED` or `CHECKS_PASSED` before:
 * a deal waited in `OFFER_AGREED` and `PARTY_CHECK` for someone to call `advance`. It runs after every helper result, every
 * released review and every document request, as `system:driver`, and only calls `advance` when the real facts already
 * pass the step's guard (`advance` checks them again). It never skips a gate, never leaves a hold and never goes past
 * `PARTY_CHECK`; the NOC steps keep their own drive. Safe to run twice: a step taken is not taken again.
 */
export async function driveDeal(ctx: SpaContext, dealId: string, tx?: SpaTx): Promise<{ moved: string[] }> {
  const run = async (t: SpaTx) => {
    const moved: string[] = [];
    for (let i = 0; i < AUTOMATIC.length; i++) {
      const [deal] = await t.db.select().from(deals).where(eq(deals.id, dealId)).for("update");
      if (!deal) throw notFound("deal");
      const step = AUTOMATIC.find((s) => s.from === deal.state);
      if (!step) break;
      const machineEvent = routeDealEvent(step.event, {
        type: deal.dealType,
        sellerMortgage: deal.sellerMortgage,
        buyerMortgage: deal.buyerMortgage,
        planTakenOver: deal.planTakenOver,
      });
      const transition = dealMachine.transitions.find((x) => x.from === deal.state && x.event === machineEvent);
      // Fail closed: no such transition, or one that needs a person, is not ours to take.
      if (!transition || transition.gate) break;
      const f = await ctx.facts.deal(t, deal, ctx.clock.today(), { amlListVersion: ctx.amlListVersion });
      if (transition.guard && !transition.guard(f).ok) break;
      await advance(ctx, { kind: "deal", id: dealId }, step.event, { actor: DRIVER, tx: t });
      moved.push(step.event);
    }
    return { moved };
  };
  return tx ? run(tx) : withSpaTx(ctx.database, run);
}

/**
 * `driveDeal` after something happened (a helper result, a document request): its failure is logged, never thrown, because
 * what happened must stand. The next result, release or request drives the deal again.
 */
export async function driveAfter(ctx: SpaContext, dealId: string): Promise<void> {
  try {
    await driveDeal(ctx, dealId);
  } catch (e) {
    console.warn(`could not drive deal ${dealId}: ${e instanceof Error ? e.message : "unknown error"}`);
  }
}
