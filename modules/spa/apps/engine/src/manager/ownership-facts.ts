import { helperRuns, spaApprovals, type SpaTx } from "@spa/db";
import { and, desc, eq } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { heldRunIds } from "./helper-modes.ts";
import { currentOwnershipDocs } from "./ownership-docs.ts";

/**
 * The `ownershipOk` fact (S52 amendment, review 9), fail-closed. A resale's ownership document set on file now was
 * either checked by code and `matched` (the latest `spa_ownership_check` run is `ok`, matched, and made on exactly
 * these documents), or a sales manager approved a `seller_verification` whose `ownershipDocsHash` is this set. A new
 * upload makes it false until it is checked. A primary deal has no ownership document: false (the guard skips it).
 */
export async function ownershipOkFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  if (deal.dealType === "primary_offplan") return false;
  const docs = await currentOwnershipDocs(tx.db, deal);
  if (!docs) return false;
  const [run] = await tx.db
    .select({ id: helperRuns.id, status: helperRuns.status, result: helperRuns.result })
    .from(helperRuns)
    .where(and(eq(helperRuns.helper, "spa_ownership_check"), eq(helperRuns.entityId, deal.id)))
    .orderBy(desc(helperRuns.createdAt), desc(helperRuns.id))
    .limit(1);
  const r = run?.result as { status?: string; docsHash?: string } | undefined;
  // S59: a match held for a person's look (review mode), or one a person rejected, doesn't count. A manager's
  // approved `seller_verification` below is its own path and is not a helper result.
  const held = run ? (await heldRunIds(tx, deal.id)).has(run.id) : false;
  if (!held && run?.status === "ok" && r?.status === "matched" && r.docsHash === docs.hash) return true;
  const approved = await tx.db
    .select({ proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "seller_verification"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, deal.id),
        eq(spaApprovals.status, "approved"),
      ),
    );
  return approved.some((a) => a.proposal.ownershipDocsHash === docs.hash);
}
