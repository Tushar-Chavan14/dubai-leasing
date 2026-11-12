import type { Actor, Emirate } from "@leasing/core";
import { newId } from "@leasing/core";
import { sriAverages, type Tx } from "@leasing/db";
import type { EngineContext } from "../context.ts";

export interface SriInput {
  emirate?: Emirate | undefined;
  community: string;
  bedrooms: number;
  avgAnnualRentFils: number;
}

/** Records a residential Smart Rental Index average from today (a same-day value is replaced). */
export async function saveSriValue(ctx: EngineContext, tx: Tx, b: SriInput, actor: Actor) {
  const [row] = await tx.db
    .insert(sriAverages)
    .values({
      id: newId(),
      ...b,
      emirate: b.emirate ?? "dubai",
      category: "residential",
      source: "manual",
      effectiveFrom: ctx.clock.today(),
      createdBy: actor,
    })
    .onConflictDoUpdate({
      target: [
        sriAverages.emirate,
        sriAverages.community,
        sriAverages.category,
        sriAverages.bedrooms,
        sriAverages.effectiveFrom,
      ],
      set: { avgAnnualRentFils: b.avgAnnualRentFils, source: "manual", createdBy: actor },
    })
    .returning();
  return row!;
}
