import { createHash } from "node:crypto";
import type { CalendarDate } from "@platform/kernel/dates";
import {
  beneficialOwners,
  dealParties,
  documentRequests,
  documents,
  kycRuns,
  PARTY_DOCUMENT_KINDS,
  parties,
  spaApprovals,
  type SpaDb,
  type SpaTx,
} from "@spa/db";
import { and, desc, eq, inArray, notExists, sql } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { heldRunIds } from "./helper-modes.ts";
import { effectiveKycConfig } from "./kyc-config.ts";

/** Why a party is on a deal's KYC list: the role its documents are read under. */
export type KycPartyRole = "buyer_person" | "seller_person" | "company_party" | "beneficial_owner";
export interface DealKycParty {
  partyId: string;
  name: string;
  kind: "person" | "company";
  role: KycPartyRole;
}

/**
 * The parties a deal asks documents from (S49): every buyer and seller, and the beneficial owners of a company among
 * them. Brokers are not checked here. A person who is also a beneficial owner keeps the role they hold on the deal.
 */
export async function dealKycParties(db: SpaDb, dealId: string): Promise<DealKycParty[]> {
  const rows = await db
    .select({
      id: parties.id,
      name: parties.fullNameEn,
      kind: parties.kind,
      role: dealParties.role,
      order: dealParties.order,
    })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, dealId), inArray(dealParties.role, ["buyer", "seller"])))
    .orderBy(dealParties.role, dealParties.order);
  const out = new Map<string, DealKycParty>();
  for (const r of rows)
    out.set(r.id, {
      partyId: r.id,
      name: r.name,
      kind: r.kind,
      role: r.kind === "company" ? "company_party" : r.role === "buyer" ? "buyer_person" : "seller_person",
    });
  const companies = rows.filter((r) => r.kind === "company").map((r) => r.id);
  if (companies.length) {
    const owners = await db
      .select({ id: parties.id, name: parties.fullNameEn })
      .from(beneficialOwners)
      .innerJoin(parties, eq(parties.id, beneficialOwners.personPartyId))
      .where(inArray(beneficialOwners.companyPartyId, companies))
      .orderBy(parties.fullNameEn, parties.id);
    for (const o of owners)
      if (!out.has(o.id)) out.set(o.id, { partyId: o.id, name: o.name, kind: "person", role: "beneficial_owner" });
  }
  return [...out.values()];
}

/** The roles whose KYC the `kycOk` fact needs: people (a company's own checks are C20's). */
export const PERSON_KYC_ROLES: readonly KycPartyRole[] = ["buyer_person", "seller_person", "beneficial_owner"];

/** A party's documents the person check reads, the latest of each kind (a later upload supersedes an earlier one). */
export async function currentPartyDocuments(db: SpaDb, dealId: string, partyId: string) {
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
        inArray(documents.kind, [...PARTY_DOCUMENT_KINDS]),
        notExists(later),
      ),
    )
    .orderBy(documents.kind, documents.id);
}

/** What a run read, as one hash: the kinds and file hashes of the party's current documents. */
export const docsHashOf = (docs: readonly { kind: string; sha256: string }[]): string =>
  createHash("sha256")
    .update(
      docs
        .map((d) => `${d.kind}:${d.sha256}`)
        .toSorted()
        .join("|"),
    )
    .digest("hex")
    .slice(0, 32);

/** The `documentsRequested` fact (S49), fail-closed: the deal has parties, and every one has a request row. */
export async function documentsRequestedFact(tx: SpaTx, deal: DealRow): Promise<boolean> {
  const list = await dealKycParties(tx.db, deal.id);
  if (!list.length) return false;
  const asked = new Set(
    (
      await tx.db
        .select({ id: documentRequests.partyId })
        .from(documentRequests)
        .where(eq(documentRequests.dealId, deal.id))
    ).map((r) => r.id),
  );
  return list.every((p) => asked.has(p.partyId));
}

/**
 * The `kycOk` fact (S49), fail-closed. Every buyer, seller and beneficial owner has a latest KYC run that passed, or
 * is a review a sales manager approved for that run id; the run is not blocked or waiting on a person; its documents
 * are the ones on file now; it was made under the KYC config in force now (scope and version); and its earliest document expiry is today or later (a document that has expired since never
 * passes, whatever was approved). A deal with no such party is false, not vacuously true.
 */
export async function kycOkFact(tx: SpaTx, deal: DealRow, today: CalendarDate): Promise<boolean> {
  const people = (await dealKycParties(tx.db, deal.id)).filter((p) => PERSON_KYC_ROLES.includes(p.role));
  if (!people.length) return false;
  const approved = await tx.db
    .select({ proposal: spaApprovals.proposal })
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.gate, "kyc_review"),
        eq(spaApprovals.entityKind, "deal"),
        eq(spaApprovals.entityId, deal.id),
        eq(spaApprovals.status, "approved"),
      ),
    );
  const approvedRuns = new Set(approved.map((a) => a.proposal.kycRunId));
  // S59: a result held for a person's look (review mode), or one a person rejected, doesn't count.
  const held = await heldRunIds(tx, deal.id);
  for (const p of people) {
    const [run] = await tx.db
      .select()
      .from(kycRuns)
      .where(and(eq(kycRuns.dealId, deal.id), eq(kycRuns.partyId, p.partyId)))
      .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id))
      .limit(1);
    if (!run || !run.validUntil || run.validUntil < today) return false;
    if (run.runId && held.has(run.runId)) return false;
    // A run counts only under the config in force now (review 14): publishing a stricter one means a re-run.
    const cfg = await effectiveKycConfig(tx.db, p.role, deal.dealType);
    if (run.configVersion !== cfg.version || run.configScope !== cfg.scope) return false;
    // Documents uploaded since the run haven't been read: they must be read before the party counts.
    if (run.docsHash !== docsHashOf(await currentPartyDocuments(tx.db, deal.id, p.partyId))) return false;
    const counts = run.status === "passed" || (run.status === "review" && approvedRuns.has(run.id));
    if (!counts) return false;
  }
  return true;
}
