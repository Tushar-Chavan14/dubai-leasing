import { agreements, type SpaTx } from "@spa/db";
import { and, eq, ne } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { heldAgreementIds } from "./helper-modes.ts";
import { currentSheetHash } from "./sheet.ts";

/**
 * The `agreementPrepared` fact (S51), real and fail-closed: the deal has a live agreement (not superseded) whose values
 * hash is the hash of this deal's inputs now. A deal that moved since the agreement was prepared makes it false again.
 */
export async function agreementPreparedFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  const live = await tx.db
    .select({ id: agreements.id, hash: agreements.valuesHash })
    .from(agreements)
    .where(and(eq(agreements.dealId, deal.id), ne(agreements.status, "superseded")));
  if (!live.length) return false;
  const now = await currentSheetHash(tx, deal);
  // S59: an agreement whose preparation is held for a person's look (review mode), or was rejected, doesn't count.
  const held = await heldAgreementIds(tx, deal.id);
  return live.some((l) => l.hash === now && !held.has(l.id));
}
