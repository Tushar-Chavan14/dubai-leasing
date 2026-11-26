import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { dealMachine } from "@spa/core";
import {
  dealBrokers,
  dealEvents,
  dealParties,
  deals,
  parties,
  signatories,
  spaApprovals,
  spaLeads,
  spaUsers,
  units,
  type SpaDatabase,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { discountCheck, registrationFee, salesRulebookOn } from "@spa/rulebook";
import { and, eq } from "drizzle-orm";
import { advance } from "../src/manager/advance.ts";
import { decideApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { computeQuote, quoteDeal, startDeal } from "../src/manager/deal-start.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addBuilding, addUnit, createPriceList, createProject, publishPriceList } from "../src/manager/inventory.ts";
import { createParty, setCompany } from "../src/manager/parties.ts";
import { setPaymentPlan } from "../src/manager/sheet.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const LIST = 150_000_000;

describe.skipIf(!url)("M6: starting a primary deal (S81)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  let seq = 0;
  const fail = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string; reasons?: string[] }) => e,
    );

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    ctx = { database, clock, facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
  });
  afterAll(async () => {
    await database?.close();
  });

  /** A fresh available unit on a published price list at AED 1,500,000. */
  const unit = async () => {
    const p = await createProject(ctx, { code: `P${++seq}`, name: "Marina Heights" }, users.admin!);
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, users.admin!);
    const u = await addUnit(ctx, p.id, { buildingId: b.id, code: `U-${seq}` }, users.admin!);
    const pl = await createPriceList(ctx, p.id, { items: [{ unitId: u.id, priceFils: LIST }] }, users.admin!);
    await publishPriceList(ctx, pl.id, users.admin!);
    return u.id;
  };
  const person = (n: string, over: object = {}) => ({
    kind: "person" as const,
    fullNameEn: n,
    email: `${n.replace(/\W/g, "").toLowerCase()}${++seq}@example.test`,
    nationality: "Testland",
    ...over,
  });
  const company = (n: string) => ({
    kind: "company" as const,
    tradeName: n,
    email: `${n.replace(/\W/g, "").toLowerCase()}${++seq}@example.test`,
    licenceNo: "[LICENCE NO.]",
    licenceExpiresOn: "2027-12-31",
    issuingAuthority: "DED",
    signatory: { fullNameEn: `${n} Signer`, email: `signer${++seq}@example.test`, authority: "poa" as const },
  });
  const start = async (over: Record<string, unknown> = {}, who = users.officer!) =>
    startDeal(ctx, { unitId: await unit(), buyers: [person("Buyer One")], ...over }, who);
  const unitState = async (id: string) => (await database.db.select().from(units).where(eq(units.id, id)))[0]!.state;

  test("with no developer party on file the deal is refused (409) and nothing is made", async () => {
    const unitId = await unit();
    const before = (await database.db.select().from(parties)).length;
    expect((await fail(startDeal(ctx, { unitId, buyers: [person("No Dev Buyer")] }, users.officer!)))?.code).toBe(
      "developer_party_missing",
    );
    expect((await database.db.select().from(parties)).length).toBe(before);
    expect(await unitState(unitId)).toBe("AVAILABLE");
    // the developer's company party, named like the install's company, is then found by name
    await createParty(
      ctx,
      {
        kind: "company",
        email: "sales@developer.spa-demo.test",
        details: {
          tradeName: "Fictional Developments LLC",
          licenceNo: "[LICENCE NO.]",
          licenceExpiresOn: "2027-12-31",
          issuingAuthority: "DED",
        },
      },
      "system",
    );
    expect((await startDeal(ctx, { unitId, buyers: [person("Dev Buyer")] }, users.officer!)).gates).toEqual([]);
  });

  test("a person and a company buyer: the deal opens in OFFER_AGREED, the unit is HELD, the developer is the seller", async () => {
    const unitId = await unit();
    const r = await startDeal(
      ctx,
      { unitId, buyers: [person("Alice Buyer", { shareBps: 6000 }), { ...company("Beta Holdings"), shareBps: 4000 }] },
      users.officer!,
    );
    expect(r.gates).toEqual([]);
    expect(r.ref).toMatch(/^D-/);
    const [d] = await database.db.select().from(deals).where(eq(deals.id, r.id));
    expect(d).toMatchObject({ state: "OFFER_AGREED", dealType: "primary_offplan", priceFils: LIST, unitId });
    expect(await unitState(unitId)).toBe("HELD");
    const links = await database.db.select().from(dealParties).where(eq(dealParties.dealId, r.id));
    expect(links.filter((l) => l.role === "buyer")).toHaveLength(2);
    expect(links.filter((l) => l.role === "seller")).toHaveLength(1);
    // the company buyer's signatory exists
    expect((await database.db.select().from(signatories)).length).toBeGreaterThan(0);
    const types = (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, r.id))).map((e) => e.type);
    expect(types).toContain("DEAL_CREATED");
    // the deal and its buyers are written by the user: every PARTY_CREATED has an actor
    const created = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "PARTY_CREATED"));
    expect(created.every((e) => e.actor.startsWith("user:") || e.actor.startsWith("system"))).toBe(true);
    // a second deal reuses the developer party: one seller party for every primary deal
    const r2 = await start();
    const sellers = async (id: string) =>
      (await database.db.select().from(dealParties).where(eq(dealParties.dealId, id))).filter(
        (l) => l.role === "seller",
      );
    expect((await sellers(r2.id))[0]!.partyId).toBe((await sellers(r.id))[0]!.partyId);
  });

  test("bad input is refused: no buyer, five buyers, shares not 100%, a person without a nationality", async () => {
    const unitId = await unit();
    for (const buyers of [
      [],
      [1, 2, 3, 4, 5].map((i) => person(`B${i}`)),
      [person("S1", { shareBps: 5000 }), person("S2", { shareBps: 4000 })],
      [person("S3", { shareBps: 5000 }), person("S4")],
      [{ ...person("No Nation"), nationality: "" }],
    ])
      expect((await fail(startDeal(ctx, { unitId, buyers }, users.officer!)))?.status).toBe(422);
    expect(await unitState(unitId)).toBe("AVAILABLE");
  });

  test("a price below the allowed discount still creates the deal and opens price_out_of_range; nothing moves until a manager approves", async () => {
    const r = await start({ priceFils: 130_000_000 });
    expect(r.gates).toEqual(["price_out_of_range"]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, r.id));
    expect(a).toMatchObject({ gate: "price_out_of_range", status: "pending", approverRole: "sales_manager" });
    expect(a!.proposal).toMatchObject({ kind: "price", priceFils: 130_000_000, listPriceFils: LIST });
    const step = await fail(advance(ctx, { kind: "deal", id: r.id }, "CHECKS_STARTED", { actor: "system:driver" }));
    expect(step?.code).toBe("guard_failed");
    expect(step?.reasons?.join(" ")).toContain("outside policy");
    // nobody decides their own proposal, and no other role decides it
    expect((await fail(decideApproval(ctx, a!.id, users.officer!, { decision: "approve" })))?.status).toBe(403);
    expect((await fail(decideApproval(ctx, a!.id, users.finance!, { decision: "approve" })))?.status).toBe(403);
    await decideApproval(ctx, a!.id, users.manager!, { decision: "approve" });
    const again = await fail(advance(ctx, { kind: "deal", id: r.id }, "CHECKS_STARTED", { actor: "system:driver" }));
    // the price no longer blocks; the documents still do
    expect(again?.reasons?.join(" ")).not.toContain("outside policy");
    expect(again?.reasons?.join(" ")).toContain("Documents");
  });

  test("a manager's own proposal is decided by another manager; a refused price keeps blocking the first step", async () => {
    const r = await start({ priceFils: 100_000_000 }, users.manager!);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, r.id));
    expect((await fail(decideApproval(ctx, a!.id, users.manager!, { decision: "approve" })))?.status).toBe(403);
    const second = { id: newId(), role: "sales_manager" as const };
    await database.db.insert(spaUsers).values({ ...second, email: "manager2@spa-demo.test", name: "manager2" });
    await decideApproval(ctx, a!.id, second, { decision: "reject", note: "too low" });
    const step = await fail(advance(ctx, { kind: "deal", id: r.id }, "CHECKS_STARTED", { actor: "system:driver" }));
    expect(step?.reasons?.join(" ")).toContain("outside policy");
  });

  test("a booking below the minimum opens a gate; once approved the payment plan may use exactly that share", async () => {
    const r = await start({ bookingFils: 7_500_000 });
    expect(r.gates).toEqual(["price_out_of_range"]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, r.id));
    expect(a!.proposal).toMatchObject({
      kind: "booking",
      bookingFils: 7_500_000,
      bookingBps: 500,
      minBookingBps: 1000,
    });
    const plan = {
      instalments: [
        { label: "Booking", shareBps: 500, dueOn: "2026-12-01" },
        { label: "Handover", shareBps: 9500, milestone: "Handover" },
      ],
    };
    expect((await fail(setPaymentPlan(ctx, r.id, plan, users.officer!)))?.status).toBe(422);
    await decideApproval(ctx, a!.id, users.manager!, { decision: "approve" });
    expect(await setPaymentPlan(ctx, r.id, plan, users.officer!)).toEqual({ rows: 2 });
    // below the approved share is still refused
    const lower = {
      instalments: [
        { label: "Booking", shareBps: 400, dueOn: "2026-12-01" },
        { label: "Handover", shareBps: 9600, milestone: "Handover" },
      ],
    };
    expect((await fail(setPaymentPlan(ctx, r.id, lower, users.officer!)))?.status).toBe(422);
  });

  test("a price gate and a booking gate together make two approvals; neither can be edited, only approved or rejected", async () => {
    const r = await start({ priceFils: 130_000_000, bookingFils: 5_000_000 });
    expect(r.gates).toEqual(["price_out_of_range"]);
    const rows = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, r.id));
    expect(rows.map((a) => (a.proposal as { kind: string }).kind).toSorted()).toEqual(["booking", "price"]);
    const second = { id: newId(), role: "sales_manager" as const };
    await database.db.insert(spaUsers).values({ ...second, email: `m${newId().slice(-6)}@spa-demo.test`, name: "m" });
    for (const a of rows)
      expect(
        (await fail(decideApproval(ctx, a.id, users.manager!, { decision: "edit", proposal: { bookingBps: 100 } })))
          ?.code,
      ).toBe("edit_not_allowed");
    // approving only the price still leaves the booking blocking the first step
    const price = rows.find((a) => (a.proposal as { kind: string }).kind === "price")!;
    await decideApproval(ctx, price.id, users.manager!, { decision: "approve" });
    const step = await fail(advance(ctx, { kind: "deal", id: r.id }, "CHECKS_STARTED", { actor: "system:driver" }));
    expect(step?.reasons?.join(" ")).toContain("outside policy");
    void second;
  });

  test("a home with no price-list price needs approval for whatever price is typed, and refuses a deal with no price at all", async () => {
    const p = await createProject(ctx, { code: `P${++seq}`, name: "No List" }, users.admin!);
    const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, users.admin!);
    const u = await addUnit(ctx, p.id, { buildingId: b.id, code: `U-${++seq}` }, users.admin!);
    expect((await fail(startDeal(ctx, { unitId: u.id, buyers: [person("No Price")] }, users.officer!)))?.code).toBe(
      "no_price",
    );
    const r = await startDeal(
      ctx,
      { unitId: u.id, priceFils: 100_000_000, buyers: [person("Priceless")] },
      users.officer!,
    );
    expect(r.gates).toEqual(["price_out_of_range"]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, r.id));
    expect(a!.proposal).toMatchObject({ kind: "price", listPriceFils: null, priceFils: 100_000_000 });
  });

  test("a booking at the minimum and a price at the discount limit open no gate", async () => {
    const r = await start({ bookingFils: 15_000_000, priceFils: 142_500_000 });
    expect(r.gates).toEqual([]);
  });

  test("two agents start a deal on the same unit at once: one deal, the other gets 409 with the existing deal", async () => {
    const unitId = await unit();
    const results = await Promise.all(
      [users.officer!, users.manager!].map((u) =>
        startDeal(ctx, { unitId, buyers: [person("Race Buyer")] }, u).then(
          (r) => ({ ok: r }),
          (e: { status?: number; code?: string; reasons?: string[] }) => ({ err: e }),
        ),
      ),
    );
    const won = results.filter((r) => "ok" in r);
    const lost = results.filter((r) => "err" in r);
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    const e = (lost[0] as { err: { status?: number; code?: string; reasons?: string[] } }).err;
    expect([e.status, e.code]).toEqual([409, "open_deal_exists"]);
    const w = (won[0] as { ok: { id: string; ref: string } }).ok;
    expect(e.reasons).toEqual([w.id, w.ref]);
    expect((await database.db.select().from(deals).where(eq(deals.unitId, unitId))).length).toBe(1);
  });

  test("a unit that is not available can't start a deal, and nothing is left behind", async () => {
    const unitId = await unit();
    await start({ unitId });
    const before = (await database.db.select().from(parties)).length;
    expect((await fail(startDeal(ctx, { unitId, buyers: [person("Late Buyer")] }, users.officer!)))?.code).toBe(
      "open_deal_exists",
    );
    expect((await database.db.select().from(parties)).length).toBe(before);
  });

  test("a broker is set with the deal; the policy commission opens no gate, another % does", async () => {
    const broker = {
      agencyName: "Fictional Agency LLC",
      agencyEmail: "agency@example.test",
      agentName: "Ali Agent",
      orn: "1234",
      brn: "5678",
    };
    const ok = await start({ broker });
    expect(ok.gates).toEqual([]);
    const [b] = await database.db.select().from(dealBrokers).where(eq(dealBrokers.dealId, ok.id));
    expect(b).toMatchObject({ side: "buyer", agentName: "Ali Agent" });
    const over = await start({ broker: { ...broker, commissionBps: 300 } });
    expect(over.gates).toEqual(["price_out_of_range"]);
  });

  test("a lead becomes converted with its deal; a lead about another home or already converted is refused", async () => {
    const unitId = await unit();
    const leadId = newId();
    await database.db.insert(spaLeads).values({
      id: leadId,
      propertyKind: "unit",
      unitId,
      name: "Lead Person",
      email: "lead.person@example.test",
      source: "form",
      status: "interested",
      agentUserId: users.officer!.id,
      consentAt: clock.now(),
      createdAt: clock.now(),
      updatedAt: clock.now(),
    });
    const other = await unit();
    expect((await fail(startDeal(ctx, { unitId: other, buyers: [person("X")], leadId }, users.officer!)))?.code).toBe(
      "lead_mismatch",
    );
    const r = await startDeal(ctx, { unitId, buyers: [person("Lead Person")], leadId }, users.officer!);
    const [lead] = await database.db.select().from(spaLeads).where(eq(spaLeads.id, leadId));
    expect(lead).toMatchObject({ status: "converted", dealId: r.id });
    const ev = await database.db
      .select()
      .from(dealEvents)
      .where(and(eq(dealEvents.entityId, leadId), eq(dealEvents.type, "LEAD_STATUS")));
    expect(ev.at(-1)).toMatchObject({ fromState: "interested", toState: "converted" });
    expect((await fail(startDeal(ctx, { unitId, buyers: [person("Y")], leadId }, users.officer!)))?.code).toBe(
      "open_deal_exists",
    );
    const spare = await unit();
    expect((await fail(startDeal(ctx, { unitId: spare, buyers: [person("Y")], leadId }, users.officer!)))?.code).toBe(
      "lead_finished",
    );
  });

  test("roles: a non-sales role gets 403, as does a brokerage company; a resale can't start here (no listingId)", async () => {
    for (const k of ["finance", "legal", "compliance", "mlro", "admin"])
      expect((await fail(startDeal(ctx, { unitId: await unit(), buyers: [person("R")] }, users[k]!)))?.status).toBe(
        403,
      );
    expect((await fail(quoteDeal(ctx, users.finance!, { unitId: await unit() })))?.status).toBe(403);
    // a listingId makes no deal: the unit is required
    expect((await fail(startDeal(ctx, { listingId: newId(), buyers: [person("R2")] }, users.officer!)))?.status).toBe(
      422,
    );
    const forBrokerage = await unit();
    await setCompany(ctx, { name: "Fictional Agency", kind: "brokerage" }, "system");
    try {
      expect(
        (await fail(startDeal(ctx, { unitId: forBrokerage, buyers: [person("R3")] }, users.officer!)))?.status,
      ).toBe(403);
    } finally {
      await setCompany(ctx, { name: "Fictional Developments LLC", kind: "developer" }, "system");
    }
  });

  test("the quote matches the rulebook and policy for three inputs", async () => {
    const unitId = await unit();
    const rb = salesRulebookOn("dubai", clock.today())!;
    for (const price of [LIST, 142_500_000, 120_000_000]) {
      const q = await quoteDeal(ctx, users.officer!, { unitId, priceFils: String(price), bookingFils: "10000000" });
      const dc = discountCheck(LIST, price, 500);
      const fee = registrationFee(price, rb);
      expect(q).toMatchObject({
        listPriceFils: LIST,
        priceFils: price,
        discountBps: dc.discountBps,
        withinPolicy: dc.ok,
        bookingMinBps: rb.minBookingBps,
        bookingMinFils: Math.floor((price * rb.minBookingBps) / 10_000),
        bookingOk: false,
        dldFeeFils: fee.ok ? fee.totalFils : null,
      });
    }
    // pure: no price list, no price
    expect(
      computeQuote({ listPriceFils: null }, rb, {
        maxDiscountBps: 500,
        commission: { buyerSideBps: 1, sellerSideBps: 2 },
      }).withinPolicy,
    ).toBe(false);
    expect(dealMachine.entity).toBe("deal");
  });
});
