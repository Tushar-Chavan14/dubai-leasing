import type { CalendarDate } from "@platform/kernel/dates";
import type { DealFacts, ListingGuardContext } from "@spa/core";
import {
  type deals,
  deposits,
  listingOwners,
  listingParties,
  type listings,
  listingSignatures,
  spaApprovals,
  type SpaTx,
} from "@spa/db";
import { amlFlaggedByRuleFact, openAmlFlagFact } from "./aml-facts.ts";
import { companyChecksOkFact, hasCompanyPartyFact } from "./company-facts.ts";
import { documentsRequestedFact, kycOkFact } from "./kyc-facts.ts";
import { ownershipKey } from "./names.ts";
import { priceClearedFact } from "./price-facts.ts";
import { ownershipOkFact } from "./ownership-facts.ts";
import { bankLettersFact, nocOkFact } from "./noc-facts.ts";
import { instalmentsPaidFact } from "./payment-facts.ts";
import { agreementPreparedFact } from "./prepare-facts.ts";
import { oqoodIssuedFact, transferIssuedFact } from "./registry-facts.ts";
import { allSignedFact } from "./signing-facts.ts";
import { statementBalancedFact } from "./settlement-facts.ts";
import { and, count, eq } from "drizzle-orm";

export type DealRow = typeof deals.$inferSelect;
export type ListingRow = typeof listings.$inferSelect;

/** What the loader needs from outside the database. */
export interface FactsEnv {
  /** The screening adapter's current list version: a screening made under another one counts as stale (S50). */
  amlListVersion?: string | null | undefined;
}

/** What the guards read. Each later phase replaces the false facts with real checks (S35). */
export interface FactsLoader {
  deal(tx: SpaTx, row: DealRow, today: CalendarDate, env?: FactsEnv): Promise<DealFacts>;
  listing(tx: SpaTx, row: ListingRow, today: CalendarDate): Promise<ListingGuardContext>;
}

/** Deal facts not built yet are "not done" (S35); listing facts are real since C5. */
export const failClosedFacts: FactsLoader = {
  async deal(tx, row, today, env = {}): Promise<Required<DealFacts>> {
    // Real since C8: a resale's deposit cheque is held.
    const [deposit] = await tx.db.select({ status: deposits.status }).from(deposits).where(eq(deposits.dealId, row.id));
    return {
      type: row.dealType,
      sellerMortgage: row.sellerMortgage,
      buyerMortgage: row.buyerMortgage,
      planTakenOver: row.planTakenOver,
      // Real since C17 (S49): every buyer and seller has a request; every person has a passed, current KYC run.
      documentsRequested: await documentsRequestedFact(tx, row),
      // Real since M6 (S81): no price or booking approval is pending or refused.
      priceCleared: await priceClearedFact(tx, row),
      kycOk: await kycOkFact(tx, row, today),
      // Real since C20 (S52): every company has a passed check (or an approved review of that run) on the documents on
      // file, licence still valid. The guard asks for it only when a company is on the deal.
      companyChecksOk: await companyChecksOkFact(tx, row, today),
      hasCompanyParty: await hasCompanyPartyFact(tx, row),
      // Real since the C20 review (S52 amendment): a resale's ownership documents matched, or a manager approved them.
      ownershipOk: await ownershipOkFact(tx, row),
      // Real since C18 (S50): an unscreened party, an open case or a pending compliance gate blocks; a flagging hit
      // that no cleared hit covers raises the flag.
      openAmlFlag: await openAmlFlagFact(tx, row, today, env),
      amlFlaggedByRule: await amlFlaggedByRuleFact(tx, row),
      // Real since C19 (S51): a live agreement whose values hash is this deal's hash now.
      agreementPrepared: await agreementPreparedFact(tx, row),
      // Real since C28 (S54): the live approved agreement's envelope is complete and the deal still matches it.
      allSigned: await allSignedFact(tx, row),
      depositRecorded: deposit?.status === "held",
      // Real since C15: records a person entered (S47).
      nocOk: await nocOkFact(tx, row, today),
      bankLettersConfirmed: await bankLettersFact(tx, row, today),
      // Real since C16: finance approved a statement whose inputs still hash the same (S48).
      statementBalanced: await statementBalancedFact(tx, row),
      // Real since C27 (S53): the registry issued a number (an `issued` registrations row of the right kind).
      transferIssued: await transferIssuedFact(tx, row),
      oqoodIssued: await oqoodIssuedFact(tx, row),
      // Real since C22 (S55): every plan row is covered by finance-confirmed payments into the escrow account.
      instalmentsPaid: await instalmentsPaidFact(tx, row),
      // Not built yet: the handover step is a later chunk.
      handoverRecorded: false,
    };
  },
  // Built in C5: every seller signed; owners matched by code or a sales manager approved `seller_verification`.
  async listing(tx, row, today) {
    const [{ n: sellers } = { n: 0 }] = await tx.db
      .select({ n: count() })
      .from(listingParties)
      .where(eq(listingParties.listingId, row.id));
    const [{ n: signed } = { n: 0 }] = await tx.db
      .select({ n: count() })
      .from(listingSignatures)
      .where(eq(listingSignatures.listingId, row.id));
    // An approved `seller_verification` counts only for the document it was given for (review #2).
    let verified = false;
    if (!row.ownershipMatched && row.ownershipKind && row.ownershipRef) {
      const owners = await tx.db
        .select({ name: listingOwners.nameAsOnDocument })
        .from(listingOwners)
        .where(eq(listingOwners.listingId, row.id));
      const key = ownershipKey(
        row.ownershipKind,
        row.ownershipRef,
        owners.map((o) => o.name),
      );
      const approved = await tx.db
        .select({ proposal: spaApprovals.proposal })
        .from(spaApprovals)
        .where(
          and(
            eq(spaApprovals.gate, "seller_verification"),
            eq(spaApprovals.entityKind, "listing"),
            eq(spaApprovals.entityId, row.id),
            eq(spaApprovals.status, "approved"),
          ),
        );
      verified = approved.some((a) => a.proposal.documentKey === key);
    }
    return {
      today,
      agreementSigned: sellers > 0 && signed === sellers,
      ownershipMatched: row.ownershipMatched || verified,
      permitExpiresOn: row.permitExpiresOn,
    };
  },
};
