import type { BuyerInput, SpaActor } from "@spa/core";
import { parties, type SpaTx } from "@spa/db";
import { inArray } from "drizzle-orm";
import type { SpaContext } from "./context.ts";
import { unprocessable } from "./errors.ts";
import { insertSellerParty } from "./listings.ts";
import { normaliseName } from "./names.ts";

export type BuyerRef = { partyId: string; order: number; shareBps?: number };

/**
 * Turns the buyers typed into a deal or offer form into parties (M6, S81): a typed buyer becomes a new party (a company
 * with its signatory, the same as a typed seller); an existing party is only checked to exist. Runs in the caller's
 * transaction, so a refusal later leaves no orphan party. Orders follow the list.
 */
export async function resolveBuyers(
  tx: SpaTx,
  ctx: SpaContext,
  buyers: readonly (BuyerInput | { partyId: string; shareBps?: number | undefined })[],
  actor: SpaActor,
): Promise<BuyerRef[]> {
  const existing = buyers.flatMap((b) => ("partyId" in b ? [b.partyId] : []));
  if (existing.length) {
    const known = await tx.db.select({ id: parties.id }).from(parties).where(inArray(parties.id, existing));
    if (known.length !== existing.length) throw unprocessable("unknown_party", "a buyer doesn't exist");
  }
  const out: BuyerRef[] = [];
  for (const [i, b] of buyers.entries()) {
    const order = i + 1;
    if ("partyId" in b) {
      out.push({ partyId: b.partyId, order, ...(b.shareBps ? { shareBps: b.shareBps } : {}) });
      continue;
    }
    const name = b.kind === "person" ? b.fullNameEn : b.tradeName;
    if (normaliseName(name) === "") throw unprocessable("invalid_buyer", "a buyer's name has no letters");
    const partyId = await insertSellerParty(tx, ctx, b, actor);
    out.push({ partyId, order, ...(b.shareBps ? { shareBps: b.shareBps } : {}) });
  }
  return out;
}
