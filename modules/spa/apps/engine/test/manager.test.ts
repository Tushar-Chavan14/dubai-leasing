import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import type { DealFacts, SpaGateId, SpaRole } from "@spa/core";
import {
  type SpaDatabase,
  dealEvents,
  deals,
  listingParties,
  listings,
  parties as partiesTable,
  spaApprovals,
  spaUsers,
  units,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts, type FactsLoader } from "../src/manager/facts.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ROLES: SpaRole[] = [
  "sales_officer",
  "sales_manager",
  "sales_admin",
  "legal",
  "compliance_officer",
  "mlro",
  "finance",
  "admin",
];
const users = {} as Record<SpaRole, { id: string; role: SpaRole }>;
let facts: Partial<DealFacts> = {};
/** Test facts: the row's type flags plus whatever the test switched on; everything else false. */
const factsFrom: FactsLoader = {
  deal: async (tx, row, today) => ({ ...(await failClosedFacts.deal(tx, row, today)), ...facts }),
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};
const clock = new FixedClock(new Date("2026-11-18T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: factsFrom });
const ALL_TRUE: Partial<DealFacts> = {
  documentsRequested: true,
  kycOk: true,
  companyChecksOk: true,
  // Real since C18 (S50): these tests have no screened parties, so the AML fact is switched off by hand.
  openAmlFlag: false,
  // Real since the C20 review: a resale needs its ownership documents matched or approved (S52).
  ownershipOk: true,
  agreementPrepared: true,
  allSigned: true,
  depositRecorded: true,
  nocOk: true,
  bankLettersConfirmed: true,
  statementBalanced: true,
  transferIssued: true,
  oqoodIssued: true,
  instalmentsPaid: true,
  handoverRecorded: true,
  priceCleared: true,
};
const officer = () => `user:${users.sales_officer.id}` as const;

async function unit(state = "AVAILABLE") {
  const id = newId();
  await database.db.insert(units).values({ id, code: `U-${id.slice(-6)}`, state: state as never });
  return id;
}
/** The seller party of each listing made by `listing()`: resale deals must use the listing's sellers (C7). */
const listingSeller = new Map<string, string>();
async function listing(state = "ACTIVE", withSeller = true) {
  const id = newId();
  await database.db
    .insert(listings)
    .values({ id, ref: `L-${id.slice(-6)}`, state: state as never, permitExpiresOn: "2027-05-01" });
  if (withSeller) {
    const [, seller] = await realParties(database.db);
    await database.db.insert(listingParties).values({ listingId: id, partyId: seller!.partyId, order: 1 });
    listingSeller.set(id, seller!.partyId);
  }
  return id;
}
/** Two fictional parties in the database (deals need real parties, C4). */
async function realParties(db: SpaDatabase["db"]) {
  const ids = [newId(), newId()];
  await db.insert(partiesTable).values(
    ids.map((id, i) => ({
      id,
      kind: "person" as const,
      fullNameEn: `Sample Party ${i}`,
      email: `p${i}@example.test`,
      passportNo: "X0000001",
      createdAt: new Date("2026-11-18T06:00:00Z"),
    })),
  );
  return [
    { role: "buyer" as const, partyId: ids[0]!, order: 1, shareBps: 10_000 },
    { role: "seller" as const, partyId: ids[1]!, order: 1, shareBps: 10_000 },
  ];
}
/** A new buyer, and the listing's own seller when it has one (else a stranger, for the refusal test). */
async function resaleParties(listingId: string) {
  const [buyer, stranger] = await realParties(database.db);
  const seller = listingSeller.get(listingId);
  return [buyer!, seller ? { ...stranger!, partyId: seller } : stranger!];
}
const primaryDeal = async (unitId: string) =>
  createDeal(
    ctx(),
    {
      dealType: "primary_offplan",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      unitId,
      priceFils: 150_000_000,
      parties: await realParties(database.db),
    },
    officer(),
  );
const resaleDeal = async (listingId: string, over: Record<string, unknown> = {}) =>
  createDeal(
    ctx(),
    {
      dealType: "resale_ready",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      listingId,
      priceFils: 200_000_000,
      parties: await resaleParties(listingId),
      ...over,
    },
    officer(),
  );
const stateOf = async (table: typeof deals | typeof units | typeof listings, id: string) =>
  (
    (
      await database.db
        .select()
        .from(table as typeof deals)
        .where(eq((table as typeof deals).id, id))
    )[0] as { state: string }
  ).state;
const eventsOf = async (id: string) =>
  (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, id))).map((e) => e.type);

/** Proposed by the sales officer, decided by the gate's role. */
async function approval(gate: SpaGateId, dealId: string, decision: Record<string, unknown> = { decision: "approve" }) {
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
      status: decision.decision === "reject" ? "rejected" : "approved",
      proposedBy: settlement ? "system:settlement" : "system:prepare",
      decidedBy: (settlement ? users.finance : users.legal).id,
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
    proposedBy: gate === "helper_review" ? `user:${users.sales_manager.id}` : officer(),
  });
  const approver = {
    aml_flag: "compliance_officer",
    agreement_approval: "legal",
    settlement_approval: "finance",
    transfer_submission: "sales_admin",
    oqood_submission: "sales_admin",
    cancellation: "sales_manager",
  }[gate as string] as SpaRole;
  await decideApproval(ctx(), p.id, users[approver], decision);
  return p.id;
}
const go = (id: string, event: string, approvalId?: string) =>
  advance(ctx(), { kind: "deal", id }, event as never, { actor: officer(), ...(approvalId ? { approvalId } : {}) });
const fails = async (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );

describe.skipIf(!url)("SpaManager (spa_test)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const role of ROLES) {
      const id = newId();
      users[role] = { id, role };
      await database.db.insert(spaUsers).values({ id, email: `${role}@spa-demo.test`, name: role, role });
    }
    facts = {};
  });
  afterAll(async () => {
    await database?.close();
  });

  test("createDeal holds the unit and records the event", async () => {
    const u = await unit();
    const d = await primaryDeal(u);
    expect(d.ref).toMatch(/^D-\d{4}$/);
    expect(await stateOf(units, u)).toBe("HELD");
    expect(await stateOf(deals, d.id)).toBe("OFFER_AGREED");
    expect(await eventsOf(d.id)).toEqual(["DEAL_CREATED"]);
    expect(await eventsOf(u)).toEqual(["HOLD"]);
  });
  test("createDeal from a listing moves it under offer", async () => {
    const l = await listing("PUBLISHED");
    await resaleDeal(l);
    expect(await stateOf(listings, l)).toBe("UNDER_OFFER");
    const l2 = await listing("UNDER_OFFER");
    await resaleDeal(l2);
    expect(await stateOf(listings, l2)).toBe("UNDER_OFFER");
  });
  test("createDeal refuses a held unit and writes nothing", async () => {
    const u = await unit("HELD");
    expect(await fails(primaryDeal(u))).toEqual({ status: 409, code: "transition_not_allowed" });
    expect(await database.db.select().from(deals)).toHaveLength(0);
    expect(await database.db.select().from(dealEvents)).toHaveLength(0);
  });

  test("with fail-closed facts a deal stops at PARTY_CHECK", async () => {
    const d = await primaryDeal(await unit());
    expect(await fails(go(d.id, "CHECKS_STARTED"))).toEqual({ status: 422, code: "guard_failed" });
    facts = { documentsRequested: true };
    await go(d.id, "CHECKS_STARTED");
    expect(await fails(go(d.id, "CHECKS_PASSED"))).toEqual({ status: 422, code: "guard_failed" });
    expect(await stateOf(deals, d.id)).toBe("PARTY_CHECK");
  });

  test("a primary deal walks to HANDED_OVER", async () => {
    const u = await unit();
    const d = await primaryDeal(u);
    facts = ALL_TRUE;
    await go(d.id, "CHECKS_STARTED");
    await go(d.id, "CHECKS_PASSED");
    await go(d.id, "PREPARED");
    await go(d.id, "APPROVED", await approval("agreement_approval", d.id));
    await go(d.id, "ALL_SIGNED");
    expect(await stateOf(units, u)).toBe("SOLD");
    await go(d.id, "REGISTERED", await approval("oqood_submission", d.id));
    expect(await stateOf(units, u)).toBe("REGISTERED");
    await go(d.id, "HANDOVER");
    expect(await stateOf(deals, d.id)).toBe("HANDED_OVER");
    expect(await stateOf(units, u)).toBe("HANDED_OVER");
    expect((await eventsOf(d.id)).filter((t) => !t.startsWith("APPROVAL_"))).toEqual([
      "DEAL_CREATED",
      "CHECKS_STARTED",
      "CHECKS_PASSED",
      "PREPARED",
      "APPROVED",
      "ALL_SIGNED",
      "REGISTERED",
      "HANDOVER",
    ]);
  });
  test("a ready resale with a buyer mortgage walks to COMPLETED", async () => {
    const l = await listing();
    const d = await resaleDeal(l, { buyerMortgage: true });
    facts = ALL_TRUE;
    for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(d.id, e);
    await go(d.id, "APPROVED", await approval("agreement_approval", d.id));
    await go(d.id, "ALL_SIGNED");
    await go(d.id, "NOC_OK");
    expect(await stateOf(deals, d.id)).toBe("FINANCE");
    await go(d.id, "FINANCE_OK");
    await go(d.id, "SETTLED", await approval("settlement_approval", d.id));
    await go(d.id, "TRANSFERRED", await approval("transfer_submission", d.id));
    expect(await stateOf(deals, d.id)).toBe("COMPLETED");
    expect(await stateOf(listings, l)).toBe("SOLD");
  });
  test("an off-plan resale with a plan taken over ends in INSTALMENTS then HANDED_OVER", async () => {
    const l = await listing();
    const d = await resaleDeal(l, { dealType: "resale_offplan", planTakenOver: true });
    facts = ALL_TRUE;
    for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(d.id, e);
    await go(d.id, "APPROVED", await approval("agreement_approval", d.id));
    await go(d.id, "ALL_SIGNED");
    await go(d.id, "NOC_OK");
    expect(await stateOf(deals, d.id)).toBe("SETTLEMENT");
    await go(d.id, "SETTLED", await approval("settlement_approval", d.id));
    await go(d.id, "TRANSFERRED", await approval("transfer_submission", d.id));
    expect(await stateOf(deals, d.id)).toBe("INSTALMENTS");
    await go(d.id, "HANDOVER");
    expect(await stateOf(deals, d.id)).toBe("HANDED_OVER");
  });

  test("an unusable approval is refused and nothing is written (Review Focus 1)", async () => {
    const d = await primaryDeal(await unit());
    facts = ALL_TRUE;
    for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(d.id, e);
    const steps = async () => (await eventsOf(d.id)).filter((t) => !t.startsWith("APPROVAL_")).length;
    const before = await steps();
    const pending = (
      await proposeApproval(ctx(), {
        gate: "agreement_approval",
        entity: { kind: "deal", id: d.id },
        dedupeKey: "p1",
        title: "x",
        proposal: {},
        proposedBy: officer(),
      })
    ).id;
    const other = await primaryDeal(await unit());
    const elsewhere = await approval("agreement_approval", other.id);
    const wrongGate = await approval("oqood_submission", d.id);
    const rejected = await approval("agreement_approval", d.id, { decision: "reject", note: "clause 4" });
    for (const id of [undefined, pending, elsewhere, wrongGate, rejected])
      expect(await fails(go(d.id, "APPROVED", id))).toEqual({ status: 409, code: "gate_required" });
    expect(await stateOf(deals, d.id)).toBe("LEGAL_REVIEW");
    expect(await steps()).toBe(before);
    await go(d.id, "RETURNED", rejected);
    expect(await stateOf(deals, d.id)).toBe("AGREEMENT_DRAFT");
    expect(await fails(go(d.id, "PREPARED"))).toBeNull();
    const ok = await approval("agreement_approval", d.id);
    await go(d.id, "APPROVED", ok);
    expect(await fails(go(d.id, "CANCEL", ok))).toEqual({ status: 409, code: "gate_required" });
  });

  test("two concurrent cancels: one wins (Review Focus 2)", async () => {
    const d = await primaryDeal(await unit());
    const r = await Promise.allSettled([go(d.id, "CANCEL"), go(d.id, "CANCEL")]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect((r.find((x) => x.status === "rejected") as PromiseRejectedResult).reason.code).toBe(
      "transition_not_allowed",
    );
    expect((await eventsOf(d.id)).filter((t) => t === "CANCEL")).toHaveLength(1);
  });

  test("another type's branch is refused (Review Focus 3)", async () => {
    facts = ALL_TRUE;
    const r = await resaleDeal(await listing());
    expect(await fails(go(r.id, "REGISTERED"))).toEqual({ status: 409, code: "transition_not_allowed" });
    const p = await primaryDeal(await unit());
    expect(await fails(go(p.id, "NOC_OK"))).toEqual({ status: 409, code: "transition_not_allowed" });
  });

  test("a failing cascade rolls the deal back (Review Focus 4)", async () => {
    const l = await listing();
    const d = await resaleDeal(l);
    facts = ALL_TRUE;
    for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(d.id, e);
    await go(d.id, "APPROVED", await approval("agreement_approval", d.id));
    await go(d.id, "ALL_SIGNED");
    await go(d.id, "NOC_OK");
    await go(d.id, "SETTLED", await approval("settlement_approval", d.id));
    await database.db.update(listings).set({ state: "WITHDRAWN" }).where(eq(listings.id, l));
    const transfer = await approval("transfer_submission", d.id);
    expect(await fails(go(d.id, "TRANSFERRED", transfer))).toEqual({ status: 409, code: "transition_not_allowed" });
    expect(await stateOf(deals, d.id)).toBe("TRANSFER");
    expect(await eventsOf(d.id)).not.toContain("TRANSFERRED");
  });

  test("event payloads are masked (Review Focus 5)", async () => {
    const d = await primaryDeal(await unit());
    await advance(ctx(), { kind: "deal", id: d.id }, "CANCEL", {
      actor: officer(),
      payload: { passportNo: "N1234567", note: "call +971 50 123 4567" },
    });
    const [e] = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CANCEL"));
    const text = JSON.stringify(e!.payload);
    expect(text).not.toContain("N1234567");
    expect(text).not.toContain("123 4567");
    expect((e!.payload as { machineEvent: string }).machineEvent).toBe("CANCEL");
  });

  test("approvals: own proposal, wrong role and admin are refused; stop_and_report opens aml_report", async () => {
    const d = await primaryDeal(await unit());
    const p = await proposeApproval(ctx(), {
      gate: "agreement_approval",
      entity: { kind: "deal", id: d.id },
      dedupeKey: "a1",
      title: "x",
      proposal: {},
      proposedBy: `user:${users.legal.id}`,
    });
    expect(await fails(decideApproval(ctx(), p.id, users.legal, { decision: "approve" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(decideApproval(ctx(), p.id, users.finance, { decision: "approve" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(decideApproval(ctx(), p.id, users.admin, { decision: "approve" }))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(
      (
        await proposeApproval(ctx(), {
          gate: "agreement_approval",
          entity: { kind: "deal", id: d.id },
          dedupeKey: "a1",
          title: "x",
          proposal: {},
          proposedBy: officer(),
        })
      ).created,
    ).toBe(false);
    const aml = await approval("aml_flag", d.id, { decision: "aml", outcome: "stop_and_report", note: "list match" });
    expect(aml).toBeTruthy();
    const all = await database.pool.query(
      "select gate, status, approver_role from spa_approvals where entity_id = $1 and gate = 'aml_report'",
      [d.id],
    );
    expect(all.rows).toEqual([{ gate: "aml_report", status: "pending", approver_role: "mlro" }]);
    expect(
      await fails(decideApproval(ctx(), aml, users.compliance_officer, { decision: "aml", outcome: "clear" })),
    ).toEqual({ status: 409, code: "not_pending" });
  });

  test("final review #2: units and listings move only through a deal", async () => {
    const u = await unit();
    expect(
      await fails(advance(ctx(), { kind: "unit", id: u } as never, "HOLD" as never, { actor: officer() })),
    ).toEqual({
      status: 409,
      code: "deal_only",
    });
    expect(await stateOf(units, u)).toBe("AVAILABLE");
  });
  test("final review #3: one open deal per listing and per unit", async () => {
    const l = await listing();
    await resaleDeal(l);
    expect(await fails(resaleDeal(l))).toEqual({ status: 409, code: "open_deal_exists" });
    const r = await database.pool.query(
      "select indexname from pg_indexes where tablename = 'deals' and indexname in ('deals_open_unit_uq','deals_open_listing_uq') order by 1",
    );
    expect(r.rows.map((x: { indexname: string }) => x.indexname)).toEqual([
      "deals_open_listing_uq",
      "deals_open_unit_uq",
    ]);
  });
  test("final review #4: dedupe only while pending; entity must exist; concurrent proposals don't throw", async () => {
    const d = await primaryDeal(await unit());
    const base = {
      gate: "agreement_approval" as const,
      entity: { kind: "deal" as const, id: d.id },
      title: "x",
      proposal: {},
      proposedBy: officer(),
    };
    const first = await proposeApproval(ctx(), { ...base, dedupeKey: "k" });
    await decideApproval(ctx(), first.id, users.legal, { decision: "reject", note: "fix clause 4" });
    const again = await proposeApproval(ctx(), { ...base, dedupeKey: "k" });
    expect(again.created).toBe(true);
    expect(again.id).not.toBe(first.id);
    const [a, b] = await Promise.all([
      proposeApproval(ctx(), { ...base, dedupeKey: "race" }),
      proposeApproval(ctx(), { ...base, dedupeKey: "race" }),
    ]);
    expect(a.id).toBe(b.id);
    expect(
      await fails(proposeApproval(ctx(), { ...base, entity: { kind: "deal", id: newId() }, dedupeKey: "ghost" })),
    ).toEqual({ status: 404, code: "not_found" });
  });
  test("final review #5: a caller's payload can't overwrite the audit fields", async () => {
    const d = await primaryDeal(await unit());
    await advance(ctx(), { kind: "deal", id: d.id }, "CANCEL", {
      actor: officer(),
      payload: { machineEvent: "FORGED", approvalId: "x" },
    });
    const [e] = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CANCEL"));
    expect((e!.payload as { machineEvent: string }).machineEvent).toBe("CANCEL");
    expect((e!.payload as { approvalId?: string }).approvalId).toBeUndefined();
  });
  test("final review #1: AML decisions leave no outcome on the timeline; the report approval has a neutral title", async () => {
    const d = await primaryDeal(await unit());
    await approval("aml_flag", d.id, { decision: "aml", outcome: "stop_and_report", note: "list match" });
    const decided = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "APPROVAL_DECIDED"));
    expect(JSON.stringify(decided.map((e) => e.payload))).not.toContain("report");
    const r = await database.pool.query("select title from spa_approvals where gate = 'aml_report'");
    expect(r.rows[0].title).toBe("Compliance review");
  });
  test("cancelling releases the unit or listing; INSTALMENTS can't be cancelled", async () => {
    const u = await unit();
    const d = await primaryDeal(u);
    await go(d.id, "CANCEL");
    expect(await stateOf(units, u)).toBe("AVAILABLE");
    const l = await listing();
    const r = await resaleDeal(l);
    facts = ALL_TRUE;
    await go(r.id, "CHECKS_STARTED");
    expect(await fails(go(r.id, "CANCEL"))).toEqual({ status: 409, code: "gate_required" });
    await go(r.id, "CANCEL", await approval("cancellation", r.id));
    expect(await stateOf(listings, l)).toBe("ACTIVE");
    const u2 = await unit();
    const p = await primaryDeal(u2);
    for (const e of ["CHECKS_STARTED", "CHECKS_PASSED", "PREPARED"]) await go(p.id, e);
    await go(p.id, "APPROVED", await approval("agreement_approval", p.id));
    await go(p.id, "ALL_SIGNED");
    await go(p.id, "REGISTERED", await approval("oqood_submission", p.id));
    expect(await fails(go(p.id, "CANCEL", await approval("cancellation", p.id)))).toEqual({
      status: 409,
      code: "transition_not_allowed",
    });
  });
  test("C7 deferred: the same party can't be buyer and seller; resale sellers must be the listing's", async () => {
    const u = await unit();
    const [b] = await realParties(database.db);
    expect(
      await fails(
        createDeal(
          ctx(),
          {
            dealType: "primary_offplan",
            sellerMortgage: false,
            buyerMortgage: false,
            planTakenOver: false,
            unitId: u,
            priceFils: 1,
            parties: [b!, { ...b!, role: "seller" }],
          },
          officer(),
        ),
      ),
    ).toEqual({ status: 422, code: "invalid_deal" });
    const l = await listing("ACTIVE", false);
    expect(await fails(resaleDeal(l))).toEqual({ status: 422, code: "sellers_not_listing" });
  });
});
