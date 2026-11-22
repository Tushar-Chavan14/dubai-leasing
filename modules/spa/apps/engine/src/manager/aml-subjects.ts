import { nameSimilarity, normaliseName, type AmlSubject } from "@spa/helpers";
import {
  beneficialOwners,
  companyChecks,
  dealParties,
  deposits,
  kycRuns,
  parties,
  payments,
  type SpaDb,
} from "@spa/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { DealRow } from "./facts.ts";
import { dealKycParties, PERSON_KYC_ROLES } from "./kyc-facts.ts";

/** The most company layers between a party and a person that code follows (also stops a loop of owners). */
const MAX_LAYERS = 6;

async function ownershipLayers(db: SpaDb, companyId: string): Promise<number> {
  let layers = 0;
  let level = [companyId];
  const seen = new Set(level);
  while (level.length && layers < MAX_LAYERS) {
    layers++;
    const owners = await db
      .select({ id: parties.id, kind: parties.kind })
      .from(beneficialOwners)
      .innerJoin(parties, eq(parties.id, beneficialOwners.personPartyId))
      .where(inArray(beneficialOwners.companyPartyId, level));
    level = owners.filter((o) => o.kind === "company" && !seen.has(o.id)).map((o) => o.id);
    for (const id of level) seen.add(id);
  }
  return layers;
}

/** Layers the latest company check could not resolve (S52): a missing page, an unread percentage, a corporate holder. */
async function unresolvedLayers(db: SpaDb, dealId: string, partyId: string): Promise<number> {
  const [c] = await db
    .select({ layers: companyChecks.layers })
    .from(companyChecks)
    .where(and(eq(companyChecks.dealId, dealId), eq(companyChecks.partyId, partyId)))
    .orderBy(desc(companyChecks.createdAt), desc(companyChecks.id))
    .limit(1);
  return c?.layers ?? 0;
}

/** The source of funds a person gave in their latest KYC run (`kyc_runs.answers`, C17). Empty means not declared. */
async function declaredSource(db: SpaDb, dealId: string, partyId: string): Promise<boolean> {
  const [run] = await db
    .select({ answers: kycRuns.answers })
    .from(kycRuns)
    .where(and(eq(kycRuns.dealId, dealId), eq(kycRuns.partyId, partyId)))
    .orderBy(desc(kycRuns.createdAt), desc(kycRuns.id))
    .limit(1);
  return !!run?.answers?.source_of_funds?.trim();
}

/**
 * Every name code screens for a deal (S50): each buyer, seller, company and beneficial owner, and whoever holds the
 * deposit cheque or paid an instalment if that is not a buyer (a non-party payer). Cash is the confirmed cash total
 * (S55): the sum of that party's counted payments made in cash, which only a finance confirmation creates. A company has
 * no personal source of funds: its owners answer for it. The same list feeds the screening and the `openAmlFlag` fact,
 * so a party or payer added later is unscreened until the next screening.
 */
export async function dealAmlSubjects(db: SpaDb, deal: DealRow): Promise<AmlSubject[]> {
  const list = await dealKycParties(db, deal.id);
  const rows = list.length
    ? await db
        .select({ id: parties.id, kind: parties.kind, nationality: parties.nationality })
        .from(parties)
        .where(
          inArray(
            parties.id,
            list.map((p) => p.partyId),
          ),
        )
    : [];
  const by = new Map(rows.map((r) => [r.id, r]));
  // Payments (S55): confirmed cash per buyer, and every payer who isn't a buyer (any status: a payer is screened even
  // when the money wasn't counted).
  const paid = await db
    .select({
      id: payments.id,
      status: payments.status,
      method: payments.method,
      amountFils: payments.amountFils,
      payerPartyId: payments.payerPartyId,
      payerName: payments.payerNameRead,
      payerIsBuyer: payments.payerIsBuyer,
    })
    .from(payments)
    .where(eq(payments.dealId, deal.id));
  const cashOf = (match: (p: (typeof paid)[number]) => boolean): number =>
    paid
      .filter((p) => p.status === "counted" && p.method === "cash" && match(p))
      .reduce((sum, p) => sum + (p.amountFils ?? 0), 0);
  const out: AmlSubject[] = [];
  for (const p of list) {
    const row = by.get(p.partyId);
    const kind = row?.kind ?? p.kind;
    out.push({
      key: p.partyId,
      partyId: p.partyId,
      name: p.name,
      kind,
      isParty: true,
      country: row?.nationality ?? "",
      sourceOfFundsDeclared:
        kind === "company" || !PERSON_KYC_ROLES.includes(p.role) ? true : await declaredSource(db, deal.id, p.partyId),
      ownershipLayers:
        kind === "company"
          ? (await ownershipLayers(db, p.partyId)) + (await unresolvedLayers(db, deal.id, p.partyId))
          : 0,
      cashFils: cashOf((x) => x.payerPartyId === p.partyId),
    });
  }
  // Payers who are not parties: the cheque holder and whoever paid an instalment, once per name.
  const payers = new Map<string, string>();
  const addPayer = (key: string, name: string) => {
    if (!payers.has(key)) payers.set(key, name);
  };
  const [deposit] = await db.select({ holder: deposits.holder }).from(deposits).where(eq(deposits.dealId, deal.id));
  const buyers = await db
    .select({ name: parties.fullNameEn })
    .from(dealParties)
    .innerJoin(parties, eq(parties.id, dealParties.partyId))
    .where(and(eq(dealParties.dealId, deal.id), eq(dealParties.role, "buyer")));
  // Same name in any order is the buyer; anything else is a third-party payer (the cautious side).
  if (deposit && !buyers.some((b) => nameSimilarity(b.name, deposit.holder) === 1))
    addPayer(`payer:${normaliseName(deposit.holder)}`, deposit.holder);
  for (const p of paid) {
    if (p.payerIsBuyer) continue;
    // A payer whose name couldn't be read is not screened (and so blocks), never skipped.
    const key = p.payerName ? `payer:${normaliseName(p.payerName)}` : `payer:unread:${p.id}`;
    addPayer(key, p.payerName ?? "");
  }
  for (const [key, name] of payers) {
    const cash = paid
      .filter((p) => !p.payerIsBuyer && p.payerName && `payer:${normaliseName(p.payerName)}` === key)
      .filter((p) => p.status === "counted" && p.method === "cash")
      .reduce((sum, p) => sum + (p.amountFils ?? 0), 0);
    out.push({
      key,
      partyId: null,
      name,
      kind: "person",
      isParty: false,
      country: "",
      sourceOfFundsDeclared: false,
      ownershipLayers: 0,
      cashFils: cash,
    });
  }
  return out;
}
