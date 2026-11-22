import { agreements, signatures, signingEnvelopes, type SpaTx } from "@spa/db";
import { and, count, eq, isNull } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { agreementPreparedFact } from "./prepare-facts.ts";

/**
 * The `allSigned` fact (S54), real and fail-closed: the deal's live approved agreement has a `complete` envelope for the
 * same PDF hash, every signature is signed, the signed PDF's hash is stored, and the deal still hashes the same as when
 * the agreement was prepared (`agreementPreparedFact`). A changed deal, a superseded envelope or one signature missing
 * makes it false.
 */
export async function allSignedFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  const [ag] = await tx.db
    .select()
    .from(agreements)
    .where(and(eq(agreements.dealId, deal.id), eq(agreements.status, "approved")));
  if (!ag) return false;
  const [env] = await tx.db
    .select()
    .from(signingEnvelopes)
    .where(and(eq(signingEnvelopes.agreementId, ag.id), eq(signingEnvelopes.status, "complete")));
  if (!env || env.docHash !== ag.docHash || !env.signedDocHash) return false;
  const [{ n: total } = { n: 0 }] = await tx.db
    .select({ n: count() })
    .from(signatures)
    .where(eq(signatures.envelopeId, env.id));
  const [{ n: open } = { n: 0 }] = await tx.db
    .select({ n: count() })
    .from(signatures)
    .where(and(eq(signatures.envelopeId, env.id), isNull(signatures.signedAt)));
  if (total === 0 || open > 0) return false;
  return agreementPreparedFact(tx, deal);
}
