import { compareNames } from "@platform/kernel/names";
import type { RegistryField, RegistryKind } from "@spa/core";
import { dealParties, kycRuns, parties, type SpaTx, spaApprovals } from "@spa/db";
import { and, asc, desc, eq } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { heldRunIds } from "./helper-modes.ts";

/**
 * Is `current` the same name as `verified`, written in another case or spacing? Stricter than `compareNames`'s
 * typo class on purpose: punctuation, accents and word order never count. This is the only difference the registry
 * helper may correct (S56).
 */
export function isSpellingOnly(current: string, verified: string): boolean {
  if (current === verified) return false;
  const squash = (s: string) => s.replace(/\s+/g, "").toLowerCase();
  return compareNames(current, verified) === "typo_class" && squash(current) === squash(verified);
}

/**
 * The name a party's KYC run read from their identity document, when that run counts: it passed, or it was flagged
 * for review and a person approved that run (as for the `kycOk` fact). Null with no run, an uncounted run or no name.
 */
async function verifiedName(tx: SpaTx, dealId: string, partyId: string): Promise<string | null> {
  const [run] = await tx.db
    .select()
    .from(kycRuns)
    .where(and(eq(kycRuns.dealId, dealId), eq(kycRuns.partyId, partyId)))
    .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id))
    .limit(1);
  if (!run) return null;
  // A result held for a person's look (review mode) or rejected by one doesn't count, so it names nobody (S59).
  if (run.runId && (await heldRunIds(tx, dealId)).has(run.runId)) return null;
  let counts = run.status === "passed";
  if (!counts && run.status === "review") {
    const approved = await tx.db
      .select({ proposal: spaApprovals.proposal })
      .from(spaApprovals)
      .where(
        and(
          eq(spaApprovals.gate, "kyc_review"),
          eq(spaApprovals.entityKind, "deal"),
          eq(spaApprovals.entityId, dealId),
          eq(spaApprovals.status, "approved"),
        ),
      );
    counts = approved.some((a) => a.proposal.kycRunId === run.id);
  }
  const name = (run.identity as { fullNameEn?: unknown }).fullNameEn;
  return counts && typeof name === "string" && name.trim() ? name.trim() : null;
}

type Named = { name: string };
type Payload = { buyers?: Named[]; sellers?: Named[] } & Record<string, unknown>;

/**
 * The one safe fix (S56): in the payload for this deal, replace a buyer's or a seller's name by the KYC-verified
 * spelling when the two differ only by case or spacing. Only the name fields are touched, and only if every party of
 * that side has a verified name and each differs from it by spelling alone (or not at all). Anything else (no verified
 * name, a different word, a primary deal's developer) is `ok: false` and the rejection goes to a person. The stored
 * party records are never edited: the fixed name exists only in the resubmitted payload.
 */
export async function planNameFixes<P>(
  tx: SpaTx,
  deal: Pick<DealRow, "id">,
  kind: RegistryKind,
  payload: P,
  fields: readonly RegistryField[],
): Promise<{ ok: true; payload: P; changed: number } | { ok: false }> {
  const next = structuredClone(payload) as unknown as Payload;
  let changed = 0;
  for (const field of fields) {
    const side = field === "buyer_name" ? "buyers" : field === "seller_name" ? "sellers" : null;
    // A primary registration's seller is the developer, not a party to fix.
    if (!side || (side === "sellers" && kind === "oqood_register")) return { ok: false };
    const list = next[side];
    if (!list?.length) return { ok: false };
    const rows = await tx.db
      .select({ partyId: parties.id })
      .from(dealParties)
      .innerJoin(parties, eq(parties.id, dealParties.partyId))
      .where(and(eq(dealParties.dealId, deal.id), eq(dealParties.role, side === "buyers" ? "buyer" : "seller")))
      .orderBy(asc(dealParties.order));
    if (rows.length !== list.length) return { ok: false };
    let sideChanged = 0;
    for (let i = 0; i < list.length; i++) {
      const verified = await verifiedName(tx, deal.id, rows[i]!.partyId);
      if (!verified) return { ok: false };
      const current = list[i]!.name;
      if (current === verified) continue;
      if (!isSpellingOnly(current, verified)) return { ok: false };
      list[i]!.name = verified;
      sideChanged++;
    }
    if (!sideChanged) return { ok: false };
    changed += sideChanged;
  }
  return changed ? { ok: true, payload: next as unknown as P, changed } : { ok: false };
}
