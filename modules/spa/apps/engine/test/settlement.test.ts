import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY, type DealFacts } from "@spa/core";
import {
  bankLetters,
  dealBrokers,
  dealEvents,
  deals,
  deposits,
  listingParties,
  listings,
  parties,
  settlementLines,
  settlements,
  type SpaDatabase,
  spaApprovals,
  spaUsers,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { dubaiSales2026_01, type SalesRulebook } from "@spa/rulebook";
import { and, asc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import { brokerCommissions, setBroker } from "../src/manager/brokers.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { type FactsLoader, failClosedFacts } from "../src/manager/facts.ts";
import {
  confirmBankAmount,
  type DocumentStore,
  nocExpirySweep,
  recordBankLetter,
  recordNoc,
  setDealUnit,
  setTargetTransferDate,
  uploadDocument,
} from "../src/manager/noc.ts";
import { publishPolicy } from "../src/manager/policy.ts";
import { requestSettlementRefresh } from "../src/manager/settlement.ts";
import { markScreened } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
afterAll(async () => {
  await database?.close();
});
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
/** Every rulebook value confirmed (fictional numbers): the real 2026-01 rulebook still has pending fees (S36). */
const RB = {
  ...dubaiSales2026_01,
  trusteeFeeFils: 400_000,
  oqoodTransferFeeFils: 100_000,
  mortgageRegistrationBps: 25,
  mortgageRegistrationAdminFils: 29_000,
  amlCashThresholdFils: 5_500_000,
  pending: [],
} as unknown as SalesRulebook;
/** Test facts: the real ones plus what a test switches on (the transfer itself is C17). */
let override: Partial<DealFacts> = {};
const facts: FactsLoader = {
  deal: async (tx, row, today) => ({ ...(await failClosedFacts.deal(tx, row, today)), ...override }),
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};
const ctx = (): SpaContext => ({ database, clock, facts, rulebook: () => RB });
/** The registry's own rulebook, whose trustee fee and mortgage fees are pending. */
const ctxPending = (): SpaContext => ({ database, clock, facts });
type U = {
  id: string;
  role:
    | "sales_officer"
    | "sales_manager"
    | "sales_admin"
    | "admin"
    | "finance"
    | "legal"
    | "compliance_officer"
    | "mlro";
};
const users: Record<string, U> = {};
const officer = () => users.officer!;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string; reasons?: string[] }) => ({ status: e.status, code: e.code }),
  );
const failsWith = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string; reasons?: string[] }) => ({
      status: e.status,
      code: e.code,
      reasons: e.reasons,
    }),
  );
const store: DocumentStore = {
  async put(bytes, ext) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { sha256, path: `${sha256.slice(0, 2)}/${sha256}.${ext}`, bytes: bytes.byteLength };
  },
};
const PDF = new TextEncoder().encode("%PDF-1.4 fictional");

async function party(name: string, kind: "person" | "company" = "person") {
  const id = newId();
  await database.db.insert(parties).values({
    id,
    kind,
    fullNameEn: name,
    email: `${id.slice(-6)}@example.test`,
    ...(kind === "person" ? { passportNo: "X0000001" } : {}),
    createdAt: new Date("2026-11-19T06:00:00Z"),
  });
  return id;
}
interface Opts {
  type?: "resale_ready" | "resale_offplan";
  seller?: boolean;
  buyer?: boolean;
  plan?: boolean;
  price?: number;
}
/** A resale forced into `NOC` with its deposit held (the earlier steps are other chunks); unit A-101, target 2027-01-15. */
async function resaleInNoc(o: Opts = {}) {
  const listingId = newId();
  await database.db.insert(listings).values({ id: listingId, state: "ACTIVE", permitExpiresOn: "2027-05-01" });
  const s1 = await party("Seller One");
  const s2 = await party("Seller Two");
  await database.db.insert(listingParties).values([
    { listingId, partyId: s1, order: 1 },
    { listingId, partyId: s2, order: 2 },
  ]);
  const buyer = await party("Buyer");
  const price = o.price ?? 200_000_000;
  const d = await createDeal(
    ctx(),
    {
      dealType: o.type ?? "resale_ready",
      sellerMortgage: o.seller ?? false,
      buyerMortgage: o.buyer ?? false,
      planTakenOver: o.plan ?? false,
      listingId,
      priceFils: price,
      parties: [
        { role: "buyer", partyId: buyer, order: 1 },
        { role: "seller", partyId: s1, order: 1 },
        { role: "seller", partyId: s2, order: 2 },
      ],
    },
    "system",
  );
  await database.db.update(deals).set({ state: "NOC" }).where(eq(deals.id, d.id));
  await markScreened(database, d.id);
  await database.db.insert(deposits).values({
    dealId: d.id,
    amountFils: Math.floor(price / 10),
    chequeLast4: "1234",
    bank: "Fictional Bank",
    chequeOn: "2026-11-01",
    holder: "Buyer",
    recordedAt: new Date("2026-11-19T06:00:00Z"),
  });
  await setDealUnit(ctx(), d.id, { unitNo: "A-101", projectCode: "P1" }, officer());
  await setTargetTransferDate(ctx(), d.id, "2027-01-15", users.manager!);
  return d.id;
}
const doc = (dealId: string, kind = "noc") =>
  uploadDocument(ctx(), store, dealId, { kind: kind as never, fileName: "f.pdf", bytes: PDF }, officer());
const nocInput = async (dealId: string, o: Record<string, unknown> = {}) => ({
  documentId: (await doc(dealId)).id,
  unitNo: "A-101",
  sellerNames: ["Seller One", "Seller Two"],
  issuedOn: "2026-11-01",
  expiresOn: "2027-03-01",
  serviceChargesCleared: true,
  ...o,
});
async function letter(dealId: string, kind: "liability_letter" | "pre_approval" | "final_offer", amount?: number) {
  const side = kind === "liability_letter" ? "seller" : "buyer";
  const l = await recordBankLetter(
    ctx(),
    dealId,
    {
      side,
      kind,
      documentId: (await doc(dealId, kind)).id,
      issuedOn: "2026-11-10",
      validUntil: "2027-02-01",
      ...(amount ? { amountReadFils: amount } : {}),
    },
    officer(),
  );
  return amount ? (await confirmBankAmount(ctx(), l.id, amount, officer(), "2027-02-01")).id : l.id;
}
/** A resale through NOC (and letters) into SETTLEMENT, where code builds the statement. */
async function inSettlement(o: Opts & { payoff?: number; loan?: number } = {}) {
  const id = await resaleInNoc(o);
  await recordNoc(
    ctx(),
    id,
    await nocInput(id, o.type === "resale_offplan" ? { paidFils: 80_000_000 } : {}),
    officer(),
  );
  if (o.seller || o.buyer) {
    if (o.seller) await letter(id, "liability_letter", o.payoff ?? 89_500_000);
    if (o.buyer) {
      await letter(id, "pre_approval", 100_000_000);
      await letter(id, "final_offer", o.loan ?? 100_000_000);
    }
  }
  expect(await state(id)).toBe("SETTLEMENT");
  return id;
}
const state = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const stmts = (id: string) =>
  database.db.select().from(settlements).where(eq(settlements.dealId, id)).orderBy(asc(settlements.version));
const lineRows = async (settlementId: string) =>
  (
    await database.db
      .select()
      .from(settlementLines)
      .where(eq(settlementLines.settlementId, settlementId))
      .orderBy(asc(settlementLines.seq))
  ).map((l) => [l.code, l.payer, l.payee, l.amountFils] as const);
const approvalsOf = (id: string, status?: string) =>
  database.db
    .select()
    .from(spaApprovals)
    .where(
      and(
        eq(spaApprovals.entityId, id),
        eq(spaApprovals.gate, "settlement_approval"),
        ...(status ? [eq(spaApprovals.status, status as never)] : []),
      ),
    );
const events = async (dealId: string, type: string) =>
  database.db
    .select()
    .from(dealEvents)
    .where(and(eq(dealEvents.entityId, dealId), eq(dealEvents.type, type)));
const factsOf = (id: string) =>
  withSpaTx(database, async (tx) =>
    failClosedFacts.deal(tx, (await tx.db.select().from(deals).where(eq(deals.id, id)))[0]!, clock.today()),
  );
const approveStatement = async (id: string) => {
  const [a] = await approvalsOf(id, "pending");
  await decideApproval(ctx(), a!.id, users.finance!, { decision: "approve" });
  return a!.id;
};

async function seedUsers() {
  for (const [k, role] of Object.entries({
    officer: "sales_officer",
    manager: "sales_manager",
    salesadmin: "sales_admin",
    admin: "admin",
    finance: "finance",
    legal: "legal",
    compliance: "compliance_officer",
    mlro: "mlro",
  } as const)) {
    users[k] = { id: newId(), role };
    await database.db.insert(spaUsers).values({ ...users[k]!, email: `${k}@spa-demo.test`, name: k });
  }
}

describe.skipIf(!url)("settlement statement and settlement_approval (C16)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    override = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
    await seedUsers();
  });

  test("entering SETTLEMENT builds version 1 by code, with each line's source, and opens settlement_approval for finance", async () => {
    const id = await inSettlement();
    const [s] = await stmts(id);
    expect([s?.version, s?.status, s?.rulesVersion, s?.policyVersion, s?.createdBy]).toEqual([
      1,
      "proposed",
      RB.version,
      0,
      "system:settlement",
    ]);
    expect(await lineRows(s!.id)).toEqual([
      ["price:deposit", "buyer", "seller", 20_000_000],
      ["price:balance_to_seller", "buyer", "seller", 180_000_000],
      ["fee:dld_fee", "buyer", "dld", 8_000_000],
      ["fee:trustee_fee", "buyer", "trustee", 400_000],
    ]);
    expect([s?.priceFils, s?.buyerPaysFils, s?.sellerReceivesFils]).toEqual([200_000_000, 208_400_000, 200_000_000]);
    const lines = await database.db
      .select()
      .from(settlementLines)
      .where(eq(settlementLines.settlementId, s!.id))
      .orderBy(asc(settlementLines.seq));
    expect(lines.map((l) => l.sourceRef)).toEqual([
      `deposit:${id}`,
      `deal:${id}`,
      `rulebook:${RB.version}`,
      `rulebook:${RB.version}`,
    ]);
    expect(lines.every((l) => l.source.length > 0)).toBe(true);
    const [a] = await approvalsOf(id);
    expect([a?.status, a?.approverRole, a?.proposedBy, a?.dedupeKey, s?.approvalId]).toEqual([
      "pending",
      "finance",
      "system:settlement",
      `${s!.id}:settlement_approval`,
      a?.id,
    ]);
    expect(a?.proposal).toMatchObject({ settlementId: s!.id, version: 1, inputHash: s!.inputHash });
    const [ev] = await events(id, "SETTLEMENT_PROPOSED");
    expect([ev?.actor, ev?.rulesVersion]).toEqual(["system:settlement", RB.version]);
  });

  test("rebuilding with nothing changed stores nothing new (safe to run twice)", async () => {
    const id = await inSettlement();
    expect(await requestSettlementRefresh(ctx(), id, officer())).toMatchObject({
      ok: true,
      version: 1,
      created: false,
    });
    await nocExpirySweep(ctx());
    await nocExpirySweep(ctx());
    expect(await stmts(id)).toHaveLength(1);
    expect(await approvalsOf(id)).toHaveLength(1);
    expect(await events(id, "SETTLEMENT_PROPOSED")).toHaveLength(1);
  });

  test("both mortgages: the confirmed payoff and loan are used; the loan pays the seller's bank first; each source is its letter", async () => {
    const id = await inSettlement({ seller: true, buyer: true });
    const [s] = await stmts(id);
    expect(await lineRows(s!.id)).toEqual([
      ["price:deposit", "buyer", "seller", 20_000_000],
      ["price:seller_payoff", "bank_buyer", "bank_seller", 89_500_000],
      ["price:balance_to_seller", "bank_buyer", "seller", 10_500_000],
      ["price:balance_to_seller", "buyer", "seller", 80_000_000],
      ["fee:dld_fee", "buyer", "dld", 8_000_000],
      ["fee:trustee_fee", "buyer", "trustee", 400_000],
      ["fee:mortgage_registration", "buyer", "dld", 279_000],
    ]);
    const current = await database.db.select().from(bankLetters).where(eq(bankLetters.status, "current"));
    const idOf = (k: string) => current.find((l) => l.kind === k)!.id;
    const lines = await database.db
      .select()
      .from(settlementLines)
      .where(eq(settlementLines.settlementId, s!.id))
      .orderBy(asc(settlementLines.seq));
    expect(lines.slice(1, 4).map((l) => l.sourceRef)).toEqual([
      `bank_letter:${idOf("final_offer")}`,
      `bank_letter:${idOf("final_offer")}`,
      `deal:${id}`,
    ]);
    const sum = (f: (l: (typeof lines)[number]) => boolean) => lines.filter(f).reduce((a, l) => a + l.amountFils, 0);
    expect(sum((l) => l.code.startsWith("price:"))).toBe(200_000_000);
  });

  test("brokers: commission by bpsOfFloor on the price, the payer from the broker row, the broker as payee", async () => {
    const id = await inSettlement();
    const agency = await party("Fictional Brokers LLC", "company");
    const base = { agencyPartyId: agency, agentName: "Rania", orn: "[ORN]", brn: "[BRN]" };
    await setBroker(ctx(), id, { ...base, side: "seller" }, officer().id as never);
    await setBroker(ctx(), id, { ...base, side: "buyer" }, `user:${officer().id}`);
    const all = await stmts(id);
    expect(all.map((s) => [s.version, s.status])).toEqual([
      [1, "stale"],
      [2, "stale"],
      [3, "proposed"],
    ]);
    const rows = await lineRows(all[2]!.id);
    expect(rows.filter((r) => r[0] === "commission")).toEqual([
      ["commission", "seller", "broker", 4_000_000],
      ["commission", "buyer", "broker", 4_000_000],
    ]);
    expect([all[2]!.buyerPaysFils, all[2]!.sellerReceivesFils]).toEqual([212_400_000, 196_000_000]);
    const refs = (
      await database.db.select().from(settlementLines).where(eq(settlementLines.settlementId, all[2]!.id))
    ).filter((l) => l.code === "commission");
    expect(refs.map((l) => l.sourceRef).toSorted()).toEqual(["broker:buyer", "broker:seller"]);
  });

  test("a commission override counts only once its approval is approved, and the statement is rebuilt then", async () => {
    const id = await inSettlement();
    const agency = await party("Fictional Brokers LLC", "company");
    await setBroker(
      ctx(),
      id,
      { side: "seller", agencyPartyId: agency, agentName: "Rania", orn: "[ORN]", brn: "[BRN]", commissionBps: 100 },
      `user:${officer().id}`,
    );
    let live = (await stmts(id)).at(-1)!;
    // Pending: the policy's 2% applies, not the asked 1%.
    expect((await lineRows(live.id)).filter((r) => r[0] === "commission")).toEqual([
      ["commission", "seller", "broker", 4_000_000],
    ]);
    const [pend] = await database.db
      .select()
      .from(spaApprovals)
      .where(and(eq(spaApprovals.entityId, id), eq(spaApprovals.gate, "price_out_of_range")));
    await decideApproval(ctx(), pend!.id, users.manager!, { decision: "approve" });
    live = (await stmts(id)).at(-1)!;
    expect(live.status).toBe("proposed");
    expect((await lineRows(live.id)).filter((r) => r[0] === "commission")).toEqual([
      ["commission", "seller", "broker", 2_000_000],
    ]);
  });

  test("a commission override is used only with an approved price_out_of_range of this deal, side and % (review 13)", async () => {
    const id = await inSettlement();
    const agency = await party("Fictional Brokers LLC", "company");
    await database.db.insert(dealBrokers).values({
      dealId: id,
      side: "seller",
      agencyPartyId: agency,
      agentName: "Rania",
      orn: "[ORN]",
      brn: "[BRN]",
      commissionBps: 100,
      payer: "seller",
    });
    const mk = async (o: { gate?: string; entityId?: string; proposal?: Record<string, unknown>; status?: string }) => {
      const a = newId();
      await database.db.insert(spaApprovals).values({
        id: a,
        gate: (o.gate ?? "price_out_of_range") as never,
        entityKind: "deal",
        entityId: o.entityId ?? id,
        dedupeKey: `k:${a}`,
        title: "x",
        proposal: o.proposal ?? { side: "seller", commissionBps: 100 },
        approverRole: "sales_manager",
        proposedBy: "system",
        status: (o.status ?? "approved") as never,
        decidedBy: users.manager!.id,
        decidedAt: new Date("2026-11-19T06:00:00Z"),
        createdAt: new Date("2026-11-19T06:00:00Z"),
      });
      return a;
    };
    const used = async () => (await brokerCommissions(database.db, id))[0]!.amountFils;
    const policy = 4_000_000; // 2% of 200,000,000 fils
    const reset = async () => {
      await database.pool.query(`alter table deal_brokers disable trigger user`);
      await database.db.update(dealBrokers).set({ commissionApprovalId: null }).where(eq(dealBrokers.dealId, id));
      await database.pool.query(`alter table deal_brokers enable trigger user`);
    };
    const link = (a: string) =>
      database.db.update(dealBrokers).set({ commissionApprovalId: a }).where(eq(dealBrokers.dealId, id));
    expect(await used()).toBe(policy);
    for (const w of [
      { gate: "cancellation" },
      { entityId: newId() },
      { proposal: { side: "buyer", commissionBps: 100 } },
      { proposal: { side: "seller", commissionBps: 101 } },
      { status: "rejected" },
    ]) {
      await reset();
      await link(await mk(w));
      expect(await used()).toBe(policy);
    }
    await reset();
    await link(await mk({}));
    expect(await used()).toBe(2_000_000);
  });

  test("an unconfirmed amount or a missing letter gives reasons and stores nothing; the fact stays false", async () => {
    const id = await resaleInNoc({ seller: true });
    await recordNoc(ctx(), id, await nocInput(id), officer());
    await letter(id, "liability_letter"); // typed nothing, unconfirmed
    await database.db.update(deals).set({ state: "SETTLEMENT" }).where(eq(deals.id, id));
    const r = await requestSettlementRefresh(ctx(), id, officer());
    expect(r).toEqual({ ok: false, reasons: ["The seller's bank payoff isn't confirmed by a person."] });
    expect(await stmts(id)).toHaveLength(0);
    expect(await approvalsOf(id)).toHaveLength(0);
    expect((await factsOf(id)).statementBalanced).toBe(false);
    // The read route shows what to fix.
    const view = await app().request(`/api/deals/${id}/settlement`, { headers: as(users.finance!) });
    expect(((await view.json()) as { reasons: string[]; statement: unknown }).reasons).toEqual([
      "The seller's bank payoff isn't confirmed by a person.",
    ]);
    // No letter at all.
    await database.db.update(bankLetters).set({ status: "superseded" }).where(eq(bankLetters.dealId, id));
    expect(await requestSettlementRefresh(ctx(), id, officer())).toEqual({
      ok: false,
      reasons: ["The seller's mortgage has no liability letter on file."],
    });
  });

  test("a pending rulebook fee refuses with its reason and no statement is shown (S36)", async () => {
    const id = await resaleInNoc();
    await recordNoc(ctxPending(), id, await nocInput(id), officer());
    expect(await state(id)).toBe("SETTLEMENT");
    expect(await stmts(id)).toHaveLength(0);
    const r = await requestSettlementRefresh(ctxPending(), id, officer());
    expect(r).toMatchObject({ ok: false });
    expect(!r.ok && r.reasons.join(" ")).toContain("trusteeFeeFils awaits legal confirmation");
    expect(await approvalsOf(id)).toHaveLength(0);
    // Once the value is confirmed (a new rulebook version in a real deployment), the same deal builds.
    expect(await requestSettlementRefresh(ctx(), id, officer())).toMatchObject({ ok: true, version: 1 });
  });

  test("with no statement, statementBalanced is false and SETTLED is refused", async () => {
    const id = await resaleInNoc();
    await recordNoc(ctxPending(), id, await nocInput(id), officer());
    expect((await factsOf(id)).statementBalanced).toBe(false);
    const p = await proposeApproval(ctx(), {
      gate: "settlement_approval",
      entity: { kind: "deal", id },
      dedupeKey: `${id}:handmade`,
      title: "x",
      proposal: {},
      proposedBy: `user:${officer().id}`,
    });
    await decideApproval(ctx(), p.id, users.finance!, { decision: "approve" }).catch(() => {});
    expect(await fails(advance(ctx(), { kind: "deal", id }, "SETTLED", { actor: "system", approvalId: p.id }))).toEqual(
      {
        status: 422,
        code: "guard_failed",
      },
    );
  });

  test("finance approves a fresh statement: it is approved, the deal moves to TRANSFER and the approval is consumed", async () => {
    const id = await inSettlement();
    expect((await factsOf(id)).statementBalanced).toBe(false); // proposed, not yet approved
    const approvalId = await approveStatement(id);
    const [s] = await stmts(id);
    expect([s?.status, s?.decidedAt?.toISOString()]).toEqual(["approved", clock.now().toISOString()]);
    expect(await state(id)).toBe("TRANSFER");
    const [ev] = await events(id, "SETTLED");
    expect([ev?.actor, ev?.fromState, ev?.toState]).toEqual(["system:settlement", "SETTLEMENT", "TRANSFER"]);
    expect(ev?.payload).toMatchObject({ approvalId, settlementId: s!.id, version: 1 });
    const [a] = await approvalsOf(id);
    expect(a?.consumedByEventId).toBe(ev!.id);
    expect((await factsOf(id)).statementBalanced).toBe(true);
  });

  test("only finance decides; not the proposer, not sales, legal or admin; editing is refused; a rejection retires it", async () => {
    const id = await inSettlement();
    const [a] = await approvalsOf(id, "pending");
    for (const who of ["officer", "manager", "salesadmin", "legal", "admin", "compliance", "mlro"])
      expect(await fails(decideApproval(ctx(), a!.id, users[who]!, { decision: "approve" }))).toEqual({
        status: 403,
        code: "forbidden",
      });
    expect(await fails(decideApproval(ctx(), a!.id, users.finance!, { decision: "edit", proposal: {} }))).toEqual({
      status: 422,
      code: "edit_not_allowed",
    });
    expect((await stmts(id))[0]?.status).toBe("proposed");
    // A finance user can't approve a proposal they made themselves.
    const own = await proposeApproval(ctx(), {
      gate: "settlement_approval",
      entity: { kind: "deal", id },
      dedupeKey: `${id}:own`,
      title: "own",
      proposal: {},
      proposedBy: `user:${users.finance!.id}`,
    });
    expect(await fails(decideApproval(ctx(), own.id, users.finance!, { decision: "approve" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
    await decideApproval(ctx(), a!.id, users.finance!, { decision: "reject", note: "fee looks wrong" });
    expect((await stmts(id))[0]?.status).toBe("superseded");
    expect(await state(id)).toBe("SETTLEMENT");
    expect((await factsOf(id)).statementBalanced).toBe(false);
    // Nothing is rebuilt by itself (the same inputs were rejected); a person asks, and a new version is proposed.
    expect(await stmts(id)).toHaveLength(1);
    expect(await fails(requestSettlementRefresh(ctx(), id, users.legal!))).toEqual({ status: 403, code: "forbidden" });
    expect(await requestSettlementRefresh(ctx(), id, officer())).toMatchObject({ ok: true, version: 2, created: true });
    expect(await approvalsOf(id, "pending")).toHaveLength(2); // the hand-made own proposal and the new one
  });

  test("re-confirming a bank amount after approval makes the approval stale; finance can't approve the stale version", async () => {
    const id = await inSettlement({ seller: true });
    clock.set(new Date("2027-03-02T06:00:00Z")); // the NOC has expired, so approving can't move the deal on
    await markScreened(database, id, clock.now()); // screenings are fresh (S50)
    const firstApproval = await approveStatement(id);
    expect(await state(id)).toBe("SETTLEMENT");
    expect((await stmts(id))[0]?.status).toBe("approved");
    const [lt] = await database.db
      .select()
      .from(bankLetters)
      .where(
        and(eq(bankLetters.dealId, id), eq(bankLetters.kind, "liability_letter"), eq(bankLetters.status, "current")),
      );
    await confirmBankAmount(ctx(), lt!.id, 89_500_000, officer(), "2027-06-30"); // same amount, new row
    const all = await stmts(id);
    expect(all.map((s) => [s.version, s.status])).toEqual([
      [1, "stale"],
      [2, "proposed"],
    ]);
    expect((await events(id, "SETTLEMENT_STALE"))[0]?.payload).toMatchObject({
      settlementId: all[0]!.id,
      wasStatus: "approved",
    });
    expect((await factsOf(id)).statementBalanced).toBe(false);
    // The old approval can't carry the deal on: the live statement is not approved.
    override = { nocOk: true };
    expect(
      await fails(advance(ctx(), { kind: "deal", id }, "SETTLED", { actor: "system", approvalId: firstApproval })),
    ).toEqual({
      status: 422,
      code: "guard_failed",
    });
    // The new version waits for finance; approving it is fine.
    const [pending] = await approvalsOf(id, "pending");
    expect(pending?.dedupeKey).toBe(`${all[1]!.id}:settlement_approval`);
    await decideApproval(ctx(), pending!.id, users.finance!, { decision: "approve" });
    expect(await state(id)).toBe("TRANSFER");
  });

  test("an approved statement waits while the mortgage's bank letter has expired; re-confirming with a later date lets a new one move on (review 8)", async () => {
    const id = await inSettlement({ seller: true }); // NOC valid to 2027-03-01, liability letter to 2027-02-01
    clock.set(new Date("2027-02-10T06:00:00Z"));
    await markScreened(database, id, clock.now());
    await approveStatement(id);
    expect((await stmts(id))[0]?.status).toBe("approved");
    expect(await state(id)).toBe("SETTLEMENT");
    expect((await factsOf(id)).bankLettersConfirmed).toBe(false);
    const [lt] = await database.db
      .select()
      .from(bankLetters)
      .where(
        and(eq(bankLetters.dealId, id), eq(bankLetters.kind, "liability_letter"), eq(bankLetters.status, "current")),
      );
    await confirmBankAmount(ctx(), lt!.id, 89_500_000, officer(), "2027-02-28");
    expect((await factsOf(id)).bankLettersConfirmed).toBe(true);
    const [pending] = await approvalsOf(id, "pending");
    await decideApproval(ctx(), pending!.id, users.finance!, { decision: "approve" });
    expect(await state(id)).toBe("TRANSFER");
  });

  test("the database lets a statement become approved only through its own approved settlement_approval for the same deal (review 12)", async () => {
    const id = await inSettlement();
    const [st] = await stmts(id);
    const q = (sql: string, params: unknown[] = []) => database.pool.query(sql, params);
    const mk = async (o: { gate: string; entityId?: string }) => {
      const a = newId();
      await database.db.insert(spaApprovals).values({
        id: a,
        gate: o.gate as never,
        entityKind: "deal",
        entityId: o.entityId ?? id,
        dedupeKey: `k:${a}`,
        title: "x",
        proposal: {},
        approverRole: "finance",
        proposedBy: "system",
        status: "approved",
        decidedBy: users.finance!.id,
        decidedAt: new Date("2026-11-19T06:00:00Z"),
        createdAt: new Date("2026-11-19T06:00:00Z"),
      });
      return a;
    };
    const relink = async (approvalId: string) => {
      await q(`alter table settlements disable trigger user`);
      await q(`update settlements set approval_id = $2 where id = $1`, [st!.id, approvalId]);
      await q(`alter table settlements enable trigger user`);
    };
    const approve = () => q(`update settlements set status = 'approved' where id = $1`, [st!.id]);
    // Its own approval is still pending.
    await expect(approve()).rejects.toThrow(/settlements/);
    // An approved approval of another gate, or of another deal, doesn't do.
    await relink(await mk({ gate: "price_out_of_range" }));
    await expect(approve()).rejects.toThrow(/settlement_approval/);
    await relink(await mk({ gate: "settlement_approval", entityId: newId() }));
    await expect(approve()).rejects.toThrow(/settlement_approval/);
    // The right one does.
    await relink(await mk({ gate: "settlement_approval" }));
    await approve();
    expect((await stmts(id))[0]!.status).toBe("approved");
  });

  test("a change made behind the manager's back is caught at approval: 422 settlement_stale, nothing changes", async () => {
    const id = await inSettlement({ seller: true });
    const [lt] = await database.db
      .select()
      .from(bankLetters)
      .where(
        and(eq(bankLetters.dealId, id), eq(bankLetters.kind, "liability_letter"), eq(bankLetters.status, "current")),
      );
    await database.db.update(bankLetters).set({ status: "superseded" }).where(eq(bankLetters.id, lt!.id));
    await database.db.insert(bankLetters).values({ ...lt!, id: newId(), amountFils: 90_000_000, status: "current" });
    const [a] = await approvalsOf(id, "pending");
    expect(await fails(decideApproval(ctx(), a!.id, users.finance!, { decision: "approve" }))).toEqual({
      status: 422,
      code: "settlement_stale",
    });
    expect((await approvalsOf(id, "pending")).map((x) => x.id)).toEqual([a!.id]);
    expect((await stmts(id))[0]?.status).toBe("proposed");
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("a statement whose price lines no longer add up can't be approved: 422 settlement_unbalanced", async () => {
    const id = await inSettlement();
    const client = await database.pool.connect();
    try {
      // Only a superuser can switch the triggers off; this is the "hand-edited database" case.
      await client.query("set session_replication_role = replica");
      await client.query("delete from settlement_lines where code = 'price:deposit'");
    } finally {
      await client.query("set session_replication_role = origin").catch(() => {});
      client.release();
    }
    const [a] = await approvalsOf(id, "pending");
    expect(await fails(decideApproval(ctx(), a!.id, users.finance!, { decision: "approve" }))).toEqual({
      status: 422,
      code: "settlement_unbalanced",
    });
    expect(await state(id)).toBe("SETTLEMENT");
  });

  test("a cancelled deal's statement is superseded and its pending approval cancelled; the deposit is left to S40", async () => {
    const id = await inSettlement();
    const c = await proposeApproval(ctx(), {
      gate: "cancellation",
      entity: { kind: "deal", id },
      dedupeKey: `${id}:cancellation`,
      title: "cancel",
      proposal: {},
      proposedBy: `user:${officer().id}`,
    });
    await decideApproval(ctx(), c.id, users.manager!, { decision: "approve" });
    await advance(ctx(), { kind: "deal", id }, "CANCEL", { actor: `user:${users.manager!.id}`, approvalId: c.id });
    expect(await state(id)).toBe("CANCELLED");
    expect((await stmts(id)).map((s) => s.status)).toEqual(["superseded"]);
    expect((await approvalsOf(id)).map((a) => a.status)).toEqual(["cancelled"]);
    expect((await events(id, "SETTLEMENT_SUPERSEDED"))[0]?.payload).toMatchObject({ reason: "deal cancelled" });
    expect((await database.db.select().from(deposits).where(eq(deposits.dealId, id)))[0]?.status).toBe("held");
    expect((await factsOf(id)).statementBalanced).toBe(false);
    expect(
      await fails(decideApproval(ctx(), (await approvalsOf(id))[0]!.id, users.finance!, { decision: "approve" })),
    ).toEqual({
      status: 409,
      code: "not_pending",
    });
  });

  test("after TRANSFER the inputs are fixed: confirming an amount or setting a broker is refused with 409", async () => {
    const id = await inSettlement({ seller: true });
    await approveStatement(id);
    expect(await state(id)).toBe("TRANSFER");
    const [lt] = await database.db
      .select()
      .from(bankLetters)
      .where(
        and(eq(bankLetters.dealId, id), eq(bankLetters.kind, "liability_letter"), eq(bankLetters.status, "current")),
      );
    expect(await fails(confirmBankAmount(ctx(), lt!.id, 80_000_000, officer(), "2027-02-01"))).toEqual({
      status: 409,
      code: "statement_fixed",
    });
    const agency = await party("Fictional Brokers LLC", "company");
    expect(
      await fails(
        setBroker(
          ctx(),
          id,
          { side: "seller", agencyPartyId: agency, agentName: "R", orn: "o", brn: "b" },
          `user:${officer().id}`,
        ),
      ),
    ).toEqual({ status: 409, code: "statement_fixed" });
    expect((await stmts(id)).map((s) => s.status)).toEqual(["approved"]);
  });

  test("a policy published later doesn't touch a deal pinned to the old one: nothing goes stale", async () => {
    const id = await inSettlement();
    const [s] = await stmts(id);
    await publishPolicy(
      ctx(),
      { ...DEFAULT_SPA_POLICY, commission: { sellerSideBps: 300, buyerSideBps: 300 } },
      users.admin!,
    );
    // The deal keeps its pinned policy (version 0): nothing goes stale.
    await requestSettlementRefresh(ctx(), id, officer());
    expect((await stmts(id)).map((x) => [x.id, x.status])).toEqual([[s!.id, "proposed"]]);
    expect(s?.policyVersion).toBe(0);
  });
});

describe.skipIf(!url)("a NOC that expires after NOC_OK blocks settlement and transfer (S48)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    override = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
    await seedUsers();
  });

  const transferApproval = async (id: string) => {
    const p = await proposeApproval(ctx(), {
      gate: "transfer_submission",
      entity: { kind: "deal", id },
      dedupeKey: `${id}:transfer_submission`,
      title: "transfer",
      proposal: {},
      proposedBy: `user:${officer().id}`,
    });
    await decideApproval(ctx(), p.id, users.salesadmin!, { decision: "approve" });
    return p.id;
  };

  test("SETTLEMENT: an approved statement waits while the NOC is expired; a replacement NOC lets the deal move on", async () => {
    const id = await inSettlement();
    clock.set(new Date("2027-03-02T06:00:00Z"));
    await markScreened(database, id, clock.now()); // screenings are fresh (S50)
    const approvalId = await approveStatement(id);
    expect(await state(id)).toBe("SETTLEMENT");
    expect((await approvalsOf(id))[0]?.consumedByEventId).toBeNull();
    const r = await failsWith(advance(ctx(), { kind: "deal", id }, "SETTLED", { actor: "system", approvalId }));
    expect(r).toMatchObject({ status: 422, code: "guard_failed" });
    expect(r?.reasons?.join(" ")).toContain("NOC");
    // The daily sweep leaves it alone and writes the expiry event once.
    await nocExpirySweep(ctx());
    await nocExpirySweep(ctx());
    expect(await state(id)).toBe("SETTLEMENT");
    expect(await events(id, "NOC_EXPIRED")).toHaveLength(1);
    // A person enters a replacement NOC (allowed in SETTLEMENT); the approved statement then moves the deal.
    await recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2027-06-01" }), officer());
    expect(await state(id)).toBe("TRANSFER");
    expect(await events(id, "SETTLED")).toHaveLength(1);
  });

  test("job: the daily sweep retries an approved statement the guards refused, once", async () => {
    const id = await inSettlement();
    override = { nocOk: false };
    await approveStatement(id);
    expect(await state(id)).toBe("SETTLEMENT");
    override = {};
    await nocExpirySweep(ctx());
    expect(await state(id)).toBe("TRANSFER");
    await nocExpirySweep(ctx());
    expect(await events(id, "SETTLED")).toHaveLength(1);
  });

  test("TRANSFER (complete): a NOC that expired in TRANSFER blocks the transfer step until a replacement is entered", async () => {
    const id = await inSettlement();
    await approveStatement(id);
    expect(await state(id)).toBe("TRANSFER");
    override = { transferIssued: true }; // issuing the transfer is C17; the NOC fact stays real
    const approvalId = await transferApproval(id);
    expect(await state(id)).toBe("TRANSFER");
    clock.set(new Date("2027-03-02T06:00:00Z"));
    await markScreened(database, id, clock.now()); // screenings are fresh (S50)
    const r = await failsWith(advance(ctx(), { kind: "deal", id }, "TRANSFERRED", { actor: "system", approvalId }));
    expect(r).toMatchObject({ status: 422, code: "guard_failed" });
    expect(r?.reasons?.join(" ")).toContain("NOC");
    expect(await state(id)).toBe("TRANSFER");
    await recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2027-06-01" }), officer());
    await advance(ctx(), { kind: "deal", id }, "TRANSFERRED", { actor: "system", approvalId });
    expect(await state(id)).toBe("COMPLETED");
  });

  test("TRANSFER (plan taken over): the same block applies to the step to INSTALMENTS", async () => {
    const id = await inSettlement({ type: "resale_offplan", plan: true });
    await approveStatement(id);
    expect(await state(id)).toBe("TRANSFER");
    override = { transferIssued: true };
    const approvalId = await transferApproval(id);
    clock.set(new Date("2027-03-02T06:00:00Z"));
    await markScreened(database, id, clock.now()); // screenings are fresh (S50)
    expect(
      await failsWith(advance(ctx(), { kind: "deal", id }, "TRANSFERRED", { actor: "system", approvalId })),
    ).toMatchObject({
      status: 422,
      code: "guard_failed",
    });
    await recordNoc(ctx(), id, await nocInput(id, { expiresOn: "2027-06-01", paidFils: 80_000_000 }), officer());
    await advance(ctx(), { kind: "deal", id }, "TRANSFERRED", { actor: "system", approvalId });
    expect(await state(id)).toBe("INSTALMENTS");
  });
});

const SECRET = "s".repeat(40);
const NOW = Date.now();
const app = () =>
  createApp({
    database,
    jobs: { boss: {} as never, lastHeartbeat: () => null },
    clock: new SpaDemoClock(database, false),
    sessionSecret: SECRET,
    demoMode: false,
    nowMs: () => NOW,
    rulebook: () => RB,
  });
const as = (u: { id: string } | null): Record<string, string> =>
  u ? { authorization: `Bearer ${issueToken(SECRET, u.id, NOW)}` } : {};

describe.skipIf(!url)("settlement routes (C16)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    override = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
    await seedUsers();
  });

  test("GET needs a signed-in user; sales, legal and finance read it, admin, compliance and MLRO don't", async () => {
    const id = await inSettlement();
    const a = app();
    expect((await a.request(`/api/deals/${id}/settlement`)).status).toBe(401);
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance"])
      expect((await a.request(`/api/deals/${id}/settlement`, { headers: as(users[who]!) })).status).toBe(200);
    for (const who of ["admin", "compliance", "mlro"])
      expect((await a.request(`/api/deals/${id}/settlement`, { headers: as(users[who]!) })).status).toBe(403);
  });

  test("GET returns the lines with their sources, the status, the version history and no reasons when built", async () => {
    const id = await inSettlement({ seller: true });
    const res = await app().request(`/api/deals/${id}/settlement`, { headers: as(users.finance!) });
    const body = (await res.json()) as {
      deal: { state: string; priceFils: number };
      statement: {
        version: number;
        status: string;
        buyerPaysFils: number;
        lines: { code: string; source: string; sourceRef: string | null; amountFils: number }[];
      };
      history: unknown[];
      reasons: string[];
    };
    expect(body.deal).toMatchObject({ state: "SETTLEMENT", priceFils: 200_000_000 });
    expect(body.statement).toMatchObject({ version: 1, status: "proposed" });
    expect(body.statement.lines.map((l) => l.code)).toEqual([
      "price:deposit",
      "price:seller_payoff",
      "price:balance_to_seller",
      "fee:dld_fee",
      "fee:trustee_fee",
    ]);
    expect(body.statement.lines.every((l) => l.source && l.sourceRef)).toBe(true);
    expect(body.statement.lines.find((l) => l.code === "price:seller_payoff")?.sourceRef).toStartWith("bank_letter:");
    expect(body.history).toHaveLength(1);
    expect(body.reasons).toEqual([]);
  });

  test("GET: an unknown deal or a bad id is 404", async () => {
    const a = app();
    expect((await a.request(`/api/deals/${newId()}/settlement`, { headers: as(users.finance!) })).status).toBe(404);
    expect((await a.request(`/api/deals/not-an-id/settlement`, { headers: as(users.finance!) })).status).toBe(404);
  });

  test("POST refresh: officer and finance may ask; legal may not; outside SETTLEMENT it is 409", async () => {
    const id = await inSettlement();
    const a = app();
    const post = (u: { id: string }) =>
      a.request(`/api/deals/${id}/settlement/refresh`, { method: "POST", headers: as(u) });
    expect((await post(users.legal!)).status).toBe(403);
    expect((await post(users.officer!)).status).toBe(200);
    expect(((await (await post(users.finance!)).json()) as { created: boolean }).created).toBe(false);
    await approveStatement(id);
    expect((await post(users.officer!)).status).toBe(409);
  });
});
