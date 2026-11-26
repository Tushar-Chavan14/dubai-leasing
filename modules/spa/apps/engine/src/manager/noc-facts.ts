import type { CalendarDate } from "@platform/kernel/dates";
import { type NocCode, type NocRecordInput as NocInput, nocChecks, selectNocRule } from "@spa/core";
import { bankLetters, dealParties, type deals, nocRecords, parties, spaApprovals, type SpaTx } from "@spa/db";
import { and, eq, ne } from "drizzle-orm";
import { heldDocumentIds } from "./helper-modes.ts";
import { normaliseName } from "./names.ts";
import { policyAt } from "./policy.ts";

type DealRow = typeof deals.$inferSelect;
type NocRow = typeof nocRecords.$inferSelect;

/** The checks of a NOC's fields against the deal as it stands today (its sellers, unit, target date, pinned policy). */
export async function checkNoc(tx: SpaTx, deal: DealRow, record: NocInput, today: CalendarDate): Promise<NocCode[]> {
  const sellers = await tx.db
    .select({ name: parties.fullNameEn })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, deal.id), eq(dealParties.role, "seller")));
  const policy = await policyAt(tx.db, deal.policyVersion);
  return nocChecks(
    record,
    {
      type: deal.dealType,
      unitNo: deal.unitNo,
      sellerNames: sellers.map((s) => s.name),
      targetTransferOn: deal.targetTransferOn,
      priceFils: deal.priceFils,
    },
    selectNocRule(policy.nocRules, deal.projectCode),
    today,
    normaliseName,
  );
}

/** The deal's current NOC record (not superseded), with its checks run now. */
export async function currentNoc(
  tx: SpaTx,
  deal: DealRow,
  today: CalendarDate,
): Promise<{ record: NocRow; codes: NocCode[] } | null> {
  const [record] = await tx.db
    .select()
    .from(nocRecords)
    .where(and(eq(nocRecords.dealId, deal.id), ne(nocRecords.status, "superseded")));
  if (!record) return null;
  return { record, codes: await checkNoc(tx, deal, record, today) };
}

/**
 * The `nocOk` fact (S47), fail-closed. A resale's current NOC, valid today, whose checks (run now, so a later change
 * of target date counts) all pass, or whose every blocker an approved `noc_review` for this record covered.
 * An expired NOC never passes, whatever a person approved.
 */
export async function nocOkFact(tx: SpaTx, deal: DealRow, today: CalendarDate): Promise<boolean> {
  if (deal.dealType === "primary_offplan") return false;
  const cur = await currentNoc(tx, deal, today);
  if (!cur || cur.record.expiresOn < today) return false;
  // A record a reader wrote counts only after a person confirmed it (`confirmNoc` writes a person's record, review 5).
  if (cur.record.source !== "manual") return false;
  // S59: a read held for a person's look (review mode), or one a person rejected, doesn't count, even once confirmed.
  if ((await heldDocumentIds(tx, deal.id)).has(cur.record.documentId)) return false;
  if (!cur.codes.length) return true;
  const approved = await tx.db
    .select({ proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "noc_review"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, deal.id),
        eq(spaApprovals.status, "approved"),
      ),
    );
  return approved.some((a) => {
    const covered = Array.isArray(a.proposal.codes) ? (a.proposal.codes as string[]) : [];
    return a.proposal.nocRecordId === cur.record.id && cur.codes.every((c) => covered.includes(c));
  });
}

/**
 * The `bankLettersConfirmed` fact (S47, review 5 and 8), fail-closed. A seller mortgage needs a current liability
 * letter, and a buyer mortgage a current pre-approval and final offer, each with an amount and an end date a person
 * confirmed, the date on or after the target date and today. Valuations and release letters don't gate. A reader's or
 * the entering person's first value never counts: a row exists only once `confirmBankAmount` wrote it.
 */
export async function bankLettersFact(tx: SpaTx, deal: DealRow, today: CalendarDate): Promise<boolean> {
  if (deal.dealType === "primary_offplan" || (!deal.sellerMortgage && !deal.buyerMortgage)) return false;
  const letters = await tx.db
    .select()
    .from(bankLetters)
    .where(and(eq(bankLetters.dealId, deal.id), eq(bankLetters.status, "current")));
  const heldDocs = await heldDocumentIds(tx, deal.id);
  const confirmed = (kind: string) =>
    letters.find(
      (l) =>
        l.kind === kind &&
        l.amountFils !== null &&
        l.confirmedBy !== null &&
        l.confirmedAt !== null &&
        // S59: a read held for a person's look (review mode), or one a person rejected, doesn't count.
        !heldDocs.has(l.documentId),
    );
  if (deal.sellerMortgage) {
    const l = confirmed("liability_letter");
    // A letter with no end date, or a deal with no target date, can't be shown valid.
    if (!l?.validUntil || !deal.targetTransferOn) return false;
    if (l.validUntil < deal.targetTransferOn || l.validUntil < today) return false;
  }
  if (deal.buyerMortgage) {
    // The same for the buyer's letters: both must be confirmed by a person, with the end date the person typed.
    for (const kind of ["pre_approval", "final_offer"]) {
      const l = confirmed(kind);
      if (!l?.validUntil || !deal.targetTransferOn) return false;
      if (l.validUntil < deal.targetTransferOn || l.validUntil < today) return false;
    }
  }
  return true;
}
