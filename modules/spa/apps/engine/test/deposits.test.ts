import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY, type DealFacts } from "@spa/core";
import { deals, deposits, listingParties, listings, parties, type SpaDatabase, spaApprovals, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import { brokerCommissions, setBroker } from "../src/manager/brokers.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { handDepositToSeller, proposeDepositRelease, recordDeposit, releaseDeposit } from "../src/manager/deposits.ts";
import { failClosedFacts, type FactsLoader } from "../src/manager/facts.ts";
import { publishPolicy } from "../src/manager/policy.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let facts: Partial<DealFacts> = {};
const loader: FactsLoader = {
  deal: async (tx, row, today) => ({ ...(await failClosedFacts.deal(tx, row, today)), ...facts }),
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};
const ctx = (): SpaContext => ({ database, clock: new FixedClock(new Date("2026-11-19T06:00:00Z")), facts: loader });
const users: Record<
  string,
  { id: string; role: "sales_officer" | "sales_manager" | "legal" | "admin" | "finance" | "sales_admin" }
> = {};
const officer = () => `user:${users.officer!.id}` as const;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const cheque = { chequeNo: "001234", bank: "[BANK]", chequeOn: "2026-11-19", holder: "Fictional Brokers LLC" };
const PASS: Partial<DealFacts> = {
  documentsRequested: true,
  kycOk: true,
  companyChecksOk: true,
  // Real since C18 (S50): these tests have no screened parties, so the AML fact is switched off by hand.
  openAmlFlag: false,
  // Real since the C20 review: a resale needs its ownership documents matched or approved (S52).
  ownershipOk: true,
  agreementPrepared: true,
  allSigned: true,
};

async function party(name: string, kind: "person" | "company" = "person") {
  const id = newId();
  await database.db.insert(parties).values({
    id,
    kind,
    fullNameEn: name,
    email: `${id.slice(-6)}@example.test`,
    passportNo: "X0000001",
    createdAt: new Date("2026-11-19T06:00:00Z"),
  });
  return id;
}
async function resale(priceFils = 200_000_000) {
  const listingId = newId();
  await database.db.insert(listings).values({ id: listingId, state: "ACTIVE", permitExpiresOn: "2027-05-01" });
  const seller = await party("Seller");
  await database.db.insert(listingParties).values({ listingId, partyId: seller, order: 1 });
  const buyer = await party("Buyer");
  return createDeal(
    ctx(),
    {
      dealType: "resale_ready",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      listingId,
      priceFils,
      parties: [
        { role: "buyer", partyId: buyer, order: 1 },
        { role: "seller", partyId: seller, order: 1 },
      ],
    },
    officer(),
  );
}
const go = (id: string, event: string, approvalId?: string) =>
  advance(ctx(), { kind: "deal", id }, event as never, { actor: officer(), ...(approvalId ? { approvalId } : {}) });
async function approved(
  gate: "agreement_approval" | "settlement_approval" | "transfer_submission" | "deposit_release" | "cancellation",
  dealId: string,
  by: string,
) {
  // C16 (S48), C19 (S51): a real settlement_approval or agreement_approval is decided only on a built statement or a
  // prepared agreement (settlement.test.ts, prepare.test.ts). These walks test the machine with test facts, so the
  // decision is written as the database would hold it.
  if (gate === "settlement_approval" || gate === "agreement_approval") {
    const id = newId();
    const settlement = gate === "settlement_approval";
    await database.db.insert(spaApprovals).values({
      id,
      gate,
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:${gate}:${id}`,
      title: gate,
      proposal: {},
      approverRole: settlement ? "finance" : "legal",
      status: "approved",
      proposedBy: settlement ? "system:settlement" : "system:prepare",
      decidedBy: (settlement ? users.finance : users.legal)!.id,
      decidedAt: new Date("2026-11-18T06:00:00Z"),
      createdAt: new Date("2026-11-18T06:00:00Z"),
    });
    return id;
  }
  const p = await proposeApproval(ctx(), {
    gate,
    entity: { kind: "deal", id: dealId },
    dedupeKey: `${dealId}:${gate}:${newId()}`,
    title: gate,
    proposal: {},
    proposedBy: officer(),
  });
  await decideApproval(ctx(), p.id, users[by]!, { decision: "approve" });
  return p.id;
}
async function toSigning(id: string) {
  facts = PASS;
  for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(id, e);
  await go(id, "APPROVED", await approved("agreement_approval", id, "legal"));
}

describe.skipIf(!url)("deposit cheque and brokers (C8)", () => {
  beforeEach(async () => {
    facts = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const [k, role] of Object.entries({
      officer: "sales_officer",
      manager: "sales_manager",
      legal: "legal",
      admin: "admin",
      finance: "finance",
      salesadmin: "sales_admin",
    } as const)) {
      users[k] = { id: newId(), role };
      await database.db.insert(spaUsers).values({ ...users[k]!, email: `${k}@spa-demo.test`, name: k });
    }
  });
  afterAll(async () => {
    await database?.close();
  });

  test("the deposit amount comes from the pinned policy; the cheque is masked; recorded once, resale only, before signing ends", async () => {
    const d = await resale(200_000_000);
    await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, depositBps: 500 }, users.admin!);
    const r = await recordDeposit(ctx(), d.id, cheque, officer());
    expect(r.amountFils).toBe(20_000_000);
    const [row] = await database.db.select().from(deposits).where(eq(deposits.dealId, d.id));
    expect([row?.chequeLast4, row?.status]).toEqual(["1234", "held"]);
    expect(await fails(recordDeposit(ctx(), d.id, cheque, officer()))).toEqual({ status: 409, code: "deposit_exists" });
    const u = newId();
    await database.db.insert(await import("@spa/db").then((m) => m.units)).values({ id: u, code: "U-9" });
    const p = await createDeal(
      ctx(),
      {
        dealType: "primary_offplan",
        sellerMortgage: false,
        buyerMortgage: false,
        planTakenOver: false,
        unitId: u,
        priceFils: 1,
        parties: [
          { role: "buyer", partyId: await party("B2"), order: 1 },
          { role: "seller", partyId: await party("S2"), order: 1 },
        ],
      },
      officer(),
    );
    expect(await fails(recordDeposit(ctx(), p.id, cheque, officer()))).toEqual({ status: 422, code: "not_resale" });
  });

  test("a resale can't leave SIGNING without the deposit (real fact)", async () => {
    const d = await resale();
    await toSigning(d.id);
    expect(await fails(go(d.id, "ALL_SIGNED"))).toEqual({ status: 422, code: "guard_failed" });
    await recordDeposit(ctx(), d.id, cheque, officer());
    await go(d.id, "ALL_SIGNED");
    expect((await database.db.select().from(deals).where(eq(deals.id, d.id)))[0]?.state).toBe("NOC");
    expect(await fails(recordDeposit(ctx(), d.id, cheque, officer()))).toEqual({ status: 409, code: "deposit_exists" });
  });

  test("handed to the seller only after the transfer", async () => {
    const d = await resale();
    await toSigning(d.id);
    await recordDeposit(ctx(), d.id, cheque, officer());
    expect(await fails(handDepositToSeller(ctx(), d.id, officer()))).toEqual({ status: 409, code: "not_transferred" });
    facts = { ...PASS, nocOk: true, statementBalanced: true, transferIssued: true };
    await go(d.id, "ALL_SIGNED");
    await go(d.id, "NOC_OK");
    await go(d.id, "SETTLED", await approved("settlement_approval", d.id, "finance"));
    await go(d.id, "TRANSFERRED", await approved("transfer_submission", d.id, "salesadmin"));
    await handDepositToSeller(ctx(), d.id, officer());
    expect((await database.db.select().from(deposits).where(eq(deposits.dealId, d.id)))[0]?.status).toBe(
      "handed_to_seller",
    );
  });

  test("on cancellation the cheque is released only through an approved deposit_release", async () => {
    const d = await resale();
    await recordDeposit(ctx(), d.id, cheque, officer());
    facts = PASS;
    await go(d.id, "CHECKS_STARTED");
    await go(d.id, "CANCEL", await approved("cancellation", d.id, "manager"));
    expect(await fails(releaseDeposit(ctx(), d.id, newId(), officer()))).toEqual({
      status: 409,
      code: "gate_required",
    });
    const p = await proposeDepositRelease(ctx(), d.id, "buyer", officer());
    expect(await fails(releaseDeposit(ctx(), d.id, p.id, officer()))).toEqual({ status: 409, code: "gate_required" });
    await decideApproval(ctx(), p.id, users.manager!, { decision: "approve", note: "MOU clause 7" });
    await releaseDeposit(ctx(), d.id, p.id, officer());
    expect((await database.db.select().from(deposits).where(eq(deposits.dealId, d.id)))[0]?.status).toBe(
      "returned_to_buyer",
    );
    expect(await fails(releaseDeposit(ctx(), d.id, p.id, officer()))).toEqual({
      status: 409,
      code: "deposit_not_held",
    });
  });

  test("brokers per side; commission defaults from the deal's pinned policy, amount by code", async () => {
    const d = await resale(200_000_000);
    await publishPolicy(
      ctx(),
      { ...DEFAULT_SPA_POLICY, commission: { sellerSideBps: 250, buyerSideBps: 250 } },
      users.admin!,
    );
    const agency = await party("Fictional Brokers LLC", "company");
    await setBroker(
      ctx(),
      d.id,
      { side: "seller", agencyPartyId: agency, agentName: "Rania", orn: "[ORN]", brn: "[BRN]" },
      officer(),
    );
    await setBroker(
      ctx(),
      d.id,
      { side: "buyer", agencyPartyId: agency, agentName: "Karim", orn: "[ORN]", brn: "[BRN]", commissionBps: 150 },
      officer(),
    );
    // The buyer-side override waits for the sales manager: until then the policy % applies.
    expect((await brokerCommissions(database.db, d.id)).map((c) => [c.payer, c.amountFils])).toEqual([
      ["seller", 4_000_000],
      ["buyer", 4_000_000],
    ]);
    const [pend] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, d.id));
    expect([pend?.gate, pend?.status, pend?.dedupeKey, pend?.proposal]).toEqual([
      "price_out_of_range",
      "pending",
      `${d.id}:broker_commission:buyer`,
      { side: "buyer", commissionBps: 150, policyBps: 200 },
    ]);
    await decideApproval(ctx(), pend!.id, users.manager!, { decision: "approve" });
    expect(
      await fails(
        setBroker(
          ctx(),
          d.id,
          { side: "seller", agencyPartyId: agency, agentName: "x", orn: "o", brn: "b" },
          officer(),
        ),
      ),
    ).toEqual({ status: 409, code: "broker_exists" });
    expect((await brokerCommissions(database.db, d.id)).map((c) => [c.payer, c.amountFils])).toEqual([
      ["seller", 4_000_000],
      ["buyer", 3_000_000],
    ]);
  });

  test("a rejected commission override never applies; an override equal to policy needs no approval", async () => {
    const d = await resale(200_000_000);
    const agency = await party("Fictional Brokers LLC", "company");
    const base = { agencyPartyId: agency, agentName: "Rania", orn: "[ORN]", brn: "[BRN]" };
    const pol = DEFAULT_SPA_POLICY.commission;
    await setBroker(ctx(), d.id, { ...base, side: "seller", commissionBps: pol.sellerSideBps }, officer());
    expect(await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, d.id))).toHaveLength(0);
    await setBroker(ctx(), d.id, { ...base, side: "buyer", commissionBps: pol.buyerSideBps + 100 }, officer());
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, d.id));
    await decideApproval(ctx(), a!.id, users.manager!, { decision: "reject", note: "too high" });
    const lines = await brokerCommissions(database.db, d.id);
    expect(lines.find((l) => l.payer === "buyer")?.amountFils).toBe(
      Math.floor((200_000_000 * pol.buyerSideBps) / 10_000),
    );
  });

  test("a broker can't be set on a deal in a terminal state", async () => {
    const d = await resale();
    const agency = await party("Fictional Brokers LLC", "company");
    await database.pool.query("update deals set state = 'CANCELLED' where id = $1", [d.id]);
    expect(
      await fails(
        setBroker(
          ctx(),
          d.id,
          { side: "seller", agencyPartyId: agency, agentName: "x", orn: "o", brn: "b" },
          officer(),
        ),
      ),
    ).toEqual({ status: 409, code: "deal_closed" });
  });

  test("a deposit can't be recorded during an AML hold", async () => {
    const d = await resale();
    await database.pool.query("update deals set state = 'AML_HOLD' where id = $1", [d.id]);
    expect(await fails(recordDeposit(ctx(), d.id, cheque, officer()))).toEqual({ status: 409, code: "too_late" });
  });

  const sqlFails = (q: string, args: unknown[] = []) =>
    database.pool.query(q, args).then(
      () => "ok",
      (e: Error) => e.message,
    );

  test("triggers: a deposit's amount can't change and a closed deposit can't reopen", async () => {
    const d = await resale();
    await recordDeposit(ctx(), d.id, cheque, officer());
    expect(await sqlFails("update deposits set amount_fils = 1 where deal_id = $1", [d.id])).toContain("immutable");
    expect(await sqlFails("delete from deposits where deal_id = $1", [d.id])).toContain("never deleted");
    await database.pool.query("update deposits set status = 'handed_to_seller', closed_at = now() where deal_id = $1", [
      d.id,
    ]);
    expect(
      await sqlFails("update deposits set status = 'held', closed_at = now() where deal_id = $1", [d.id]),
    ).toContain("closes once");
  });

  test("no new release is proposed while an approved one waits; releasing re-checks the deal is cancelled", async () => {
    const d = await resale();
    await recordDeposit(ctx(), d.id, cheque, officer());
    facts = PASS;
    await go(d.id, "CHECKS_STARTED");
    await go(d.id, "CANCEL", await approved("cancellation", d.id, "manager"));
    const p = await proposeDepositRelease(ctx(), d.id, "buyer", officer());
    await decideApproval(ctx(), p.id, users.manager!, { decision: "approve" });
    expect(await fails(proposeDepositRelease(ctx(), d.id, "seller", officer()))).toEqual({
      status: 409,
      code: "release_approved",
    });
    await database.pool.query("update deals set state = 'SIGNING' where id = $1", [d.id]);
    expect(await fails(releaseDeposit(ctx(), d.id, p.id, officer()))).toEqual({ status: 409, code: "not_cancelled" });
    await database.pool.query("update deals set state = 'CANCELLED' where id = $1", [d.id]);
    await releaseDeposit(ctx(), d.id, p.id, officer());
    expect((await database.db.select().from(deposits).where(eq(deposits.dealId, d.id)))[0]?.status).toBe(
      "returned_to_buyer",
    );
  });
});
