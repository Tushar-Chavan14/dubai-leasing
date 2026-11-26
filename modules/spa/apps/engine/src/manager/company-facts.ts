import type { CalendarDate } from "@platform/kernel/dates";
import { companyChecks, documents, spaApprovals, type SpaDb, type SpaTx } from "@spa/db";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import { heldRunIds } from "./helper-modes.ts";
import { dealKycParties, docsHashOf } from "./kyc-facts.ts";
import type { DealRow } from "./facts.ts";

/** The documents a company check reads (S52): kinds uploaded for the company party. */
export const COMPANY_CHECK_KINDS = ["trade_licence", "memorandum", "poa", "board_resolution"] as const;

/** A company party's current documents for the check: the latest of each kind (a later upload supersedes). */
export async function currentCompanyDocuments(db: SpaDb, dealId: string, partyId: string) {
  const later = db
    .select({ one: sql`1` })
    .from(sql`${documents} as d2`)
    .where(sql`d2.supersedes_id = ${documents.id}`);
  return db
    .select()
    .from(documents)
    .where(
      and(
        eq(documents.dealId, dealId),
        eq(documents.partyId, partyId),
        inArray(documents.kind, [...COMPANY_CHECK_KINDS]),
        notExists(later),
      ),
    )
    .orderBy(documents.kind, documents.id);
}

/** A company is a buyer or seller on the deal (S52): only then do company checks gate `PARTY_CHECK`. */
export async function hasCompanyPartyFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  return (await dealKycParties(tx.db, deal.id)).some((p) => p.role === "company_party");
}

/** The latest check of one company on a deal. */
export async function latestCompanyCheck(db: SpaDb, dealId: string, partyId: string) {
  const [c] = await db
    .select()
    .from(companyChecks)
    .where(and(eq(companyChecks.dealId, dealId), eq(companyChecks.partyId, partyId)))
    .orderBy(desc(companyChecks.createdAt), desc(companyChecks.id))
    .limit(1);
  return c;
}

/**
 * The `companyChecksOk` fact (S52), fail-closed. Every company buyer or seller has a latest check that `passed`, or is
 * a `review` whose own run id a sales manager approved (`seller_verification`); it was made on the documents on file now
 * (a later upload must be checked first); and its licence is still valid today, whatever was approved. A `needs_human`
 * check never counts. A deal with no company party is false: the guard asks for the fact only when `hasCompanyParty`.
 */
export async function companyChecksOkFact(tx: SpaTx, deal: DealRow, today: CalendarDate): Promise<boolean> {
  const companies = (await dealKycParties(tx.db, deal.id)).filter((p) => p.role === "company_party");
  if (!companies.length) return false;
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
  const approvedRuns = new Set(approved.map((a) => a.proposal.companyCheckId));
  // S59: a result held for a person's look (review mode), or one a person rejected, doesn't count.
  const held = await heldRunIds(tx, deal.id);
  for (const p of companies) {
    const c = await latestCompanyCheck(tx.db, deal.id, p.partyId);
    if (!c || !c.licenceExpiresOn || c.licenceExpiresOn < today) return false;
    if (c.runId && held.has(c.runId)) return false;
    if (c.docsHash !== docsHashOf(await currentCompanyDocuments(tx.db, deal.id, p.partyId))) return false;
    const counts = c.status === "passed" || (c.status === "review" && approvedRuns.has(c.id));
    if (!counts) return false;
  }
  return true;
}
