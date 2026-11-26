import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY } from "@spa/core";
import {
  agreements,
  dealBrokers,
  dealParties,
  deals,
  parties,
  paymentPlanRows,
  type SpaDatabase,
  spaApprovals,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { publishPolicy } from "../src/manager/policy.ts";
import { buildDealSheet, setPaymentPlan } from "../src/manager/sheet.ts";
import { broker, dealInDraft, RB, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U> = {};
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts, rulebook: () => RB });
const ctxPending = (): SpaContext => ({ database, clock, facts: failClosedFacts });
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const sheetOf = (dealId: string, c: SpaContext = ctx()) =>
  withSpaTx(database, async (tx) =>
    buildDealSheet(c, tx, (await tx.db.select().from(deals).where(eq(deals.id, dealId)))[0]!),
  );
const PLAN = {
  instalments: [
    { label: "Booking", shareBps: 1000, dueOn: "2026-12-01" },
    { label: "On completion of the structure", shareBps: 4000, milestone: "Structure complete" },
    { label: "On handover", shareBps: 5000, dueOn: "2028-06-30" },
  ],
};

describe.skipIf(!url)("the deal's data sheet and payment plan (C19, S51)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("parties: a person prints name, nationality, passport, email and share; a company its licence and signatory", async () => {
    const { dealId, buyerIds, sellerIds } = await dealInDraft(ctx(), database, { buyers: ["Buyer One", "Buyer Two"] });
    const s = await sheetOf(dealId);
    expect(s.purchasers.map((p) => p.purchaser_name)).toEqual(["Buyer One", "Buyer Two"]);
    expect(s.purchasers[0]).toMatchObject({ purchaser_nationality: "Fictionalian", purchaser_passport_no: "X0000001" });
    expect(s.sellers).toHaveLength(1);
    expect(s.sellers[0]).toMatchObject({
      seller_name: "Fictional Developments LLC",
      seller_licence_no: "LIC-0001",
      seller_signatory_name: "Fictional Developments LLC Signer",
      seller_signatory_title: "Director",
    });
    expect(s.sources["purchaser.1.purchaser_name"]).toBe(`party:${buyerIds[0]}`);
    expect(s.sources["purchaser.2.purchaser_name"]).toBe(`party:${buyerIds[1]}`);
    expect(s.sources["seller.1.seller_licence_no"]).toBe(`party:${sellerIds[0]}`);
    expect(s.sources["seller.1.seller_signatory_name"]).toMatch(/^party:/);
  });

  test("shares come from the deal's party rows", async () => {
    const { dealId } = await dealInDraft(ctx(), database, { buyers: ["Buyer One", "Buyer Two"] });
    await database.db.update(dealParties).set({ shareBps: 6000 }).where(eq(dealParties.dealId, dealId));
    const s = await sheetOf(dealId);
    expect(s.purchasers.map((p) => p.purchaser_share)).toEqual([6000, 6000]);
    expect(s.sources["purchaser.1.purchaser_share"]).toBe(`deal:${dealId}`);
  });

  test("money: price and its words from the deal, the fee from the pinned rulebook, the booking from the plan", async () => {
    const { dealId } = await dealInDraft(ctx(), database, { price: 125_000_000 });
    await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
    const s = await sheetOf(dealId);
    expect(s.values.price).toBe(125_000_000);
    expect(s.sources.price).toBe("deal");
    expect(typeof s.values.price_words).toBe("string");
    expect(s.sources.price_words).toBe("code:price");
    expect(s.values.dld_fee).toBe(5_000_000);
    expect(s.sources.dld_fee).toBe(`rulebook:${RB.version}:registrationFee`);
    expect(s.values.booking_amount).toBe(12_500_000);
    expect(s.sources.booking_amount).toBe("plan:1");
    expect(s.plan.map((r) => r.amountFils)).toEqual([12_500_000, 50_000_000, 62_500_000]);
    expect(s.plan.map((r) => r.number)).toEqual([1, 2, 3]);
    expect(s.plan[1]).toMatchObject({ dueOn: null, milestone: "Structure complete" });
    expect(s.sources.payment_plan).toBe("deal:plan");
  });

  test("a pending rulebook value leaves the fee out, with the reason and no guess", async () => {
    const { dealId } = await dealInDraft(ctx(), database);
    const s = await sheetOf(dealId, ctxPending());
    expect(s.values.dld_fee).toBeUndefined();
    expect(s.unavailable.dld_fee).toContain("awaits legal confirmation");
  });

  test("a unit number the person set wins; a primary deal falls back to its unit's code", async () => {
    const a = await dealInDraft(ctx(), database, { unitNo: "A-101" });
    expect((await sheetOf(a.dealId)).values.unit_no).toBe("A-101");
    expect((await sheetOf(a.dealId)).sources.unit_no).toBe("deal");
    const b = await dealInDraft(ctx(), database);
    const s = await sheetOf(b.dealId);
    expect(String(s.values.unit_no)).toMatch(/^U-/);
    expect(s.sources.unit_no).toMatch(/^unit:/);
  });

  test("a resale: deposit from the policy %, title deed from the listing, transfer date, a confirmed loan only", async () => {
    await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, depositBps: 500 }, users.admin!);
    const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready", price: 200_000_000 });
    await database.db.update(deals).set({ targetTransferOn: "2027-01-15" }).where(eq(deals.id, dealId));
    const s = await sheetOf(dealId);
    expect(s.values.deposit_amount).toBe(10_000_000);
    expect(s.sources.deposit_amount).toBe("policy:1");
    expect(s.values.title_deed_no).toBe("TD-FICT-1");
    expect(s.sources.title_deed_no).toMatch(/^listing:/);
    expect(s.values.transfer_date).toBe("2027-01-15");
    expect(s.values.loan_amount).toBeUndefined();
    expect(s.values.booking_amount).toBeUndefined();
  });

  test("a primary deal has no resale-only values", async () => {
    const { dealId } = await dealInDraft(ctx(), database);
    const s = await sheetOf(dealId);
    expect(s.values.deposit_amount).toBeUndefined();
    expect(s.values.title_deed_no).toBeUndefined();
  });

  test("one broker fills the broker keys; two are ambiguous and fill none", async () => {
    const { dealId } = await dealInDraft(ctx(), database);
    await broker(database, dealId, "seller", "Sample Realty");
    const one = await sheetOf(dealId);
    expect(one.values).toMatchObject({
      broker_agency: "Sample Realty",
      broker_agent_name: "Sample Realty Agent",
      broker_orn: "ORN-seller",
      broker_brn: "BRN-seller",
      broker_commission: DEFAULT_SPA_POLICY.commission.sellerSideBps,
    });
    expect(one.sources.broker_agency).toMatch(/^party:/);
    expect(one.ambiguous).toEqual([]);
    await broker(database, dealId, "buyer", "Other Realty");
    const two = await sheetOf(dealId);
    expect(two.values.broker_agency).toBeUndefined();
    expect(two.ambiguous).toEqual(["broker"]);
  });

  test("a broker's unapproved override % is not printed: the policy % is", async () => {
    const { dealId } = await dealInDraft(ctx(), database);
    await broker(database, dealId, "seller", "Sample Realty", 777);
    const s = await sheetOf(dealId);
    expect(s.values.broker_commission).toBe(DEFAULT_SPA_POLICY.commission.sellerSideBps);
  });

  test("every value in the sheet has a source, and nothing from another deal is in it", async () => {
    const other = await dealInDraft(ctx(), database, {
      buyers: ["Zed Elsewhere"],
      price: 999_000_000,
      unitNo: "Z-999",
    });
    await setPaymentPlan(ctx(), other.dealId, PLAN, users.officer!);
    const { dealId } = await dealInDraft(ctx(), database, { price: 125_000_000, unitNo: "A-101" });
    await broker(database, dealId, "seller", "Sample Realty");
    await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
    const s = await sheetOf(dealId);
    const keys = new Set(Object.keys(s.sources));
    for (const k of Object.keys(s.values))
      if (s.values[k] !== null && s.values[k] !== undefined) expect(keys.has(k)).toBe(true);
    s.purchasers.forEach((p, i) =>
      Object.keys(p).forEach((k) => expect(keys.has(`purchaser.${i + 1}.${k}`)).toBe(true)),
    );
    s.sellers.forEach((p, i) => Object.keys(p).forEach((k) => expect(keys.has(`seller.${i + 1}.${k}`)).toBe(true)));
    expect(JSON.stringify(s)).not.toContain("Zed Elsewhere");
    expect(JSON.stringify(s)).not.toContain("Z-999");
    expect(JSON.stringify(s)).not.toContain("999000000");
  });

  test("the values hash is stable, and changes with a party, the price, the plan, a broker or the unit", async () => {
    const { dealId, buyerIds } = await dealInDraft(ctx(), database, { unitNo: "A-101" });
    await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
    const h0 = (await sheetOf(dealId)).valuesHash;
    expect(h0).toMatch(/^[0-9a-f]{64}$/);
    expect((await sheetOf(dealId)).valuesHash).toBe(h0);
    const hashes = new Set([h0]);
    await database.db.update(parties).set({ fullNameEn: "Buyer Renamed" }).where(eq(parties.id, buyerIds[0]!));
    hashes.add((await sheetOf(dealId)).valuesHash);
    await database.db.update(deals).set({ unitNo: "A-102" }).where(eq(deals.id, dealId));
    hashes.add((await sheetOf(dealId)).valuesHash);
    await broker(database, dealId, "seller", "Sample Realty");
    hashes.add((await sheetOf(dealId)).valuesHash);
    await database.db.update(paymentPlanRows).set({ label: "First payment" }).where(eq(paymentPlanRows.dealId, dealId));
    hashes.add((await sheetOf(dealId)).valuesHash);
    await database.db.update(dealBrokers).set({ agentName: "New Agent" }).where(eq(dealBrokers.dealId, dealId));
    hashes.add((await sheetOf(dealId)).valuesHash);
    expect(hashes.size).toBe(6);
  });

  describe("database guards (C14-C20 review)", () => {
    test.each(["noc_records", "bank_letters", "payment_plan_rows", "deal_brokers"])(
      "TRUNCATE is refused on %s",
      async (table) => {
        // `payments` (C22) references the plan rows, so their truncate needs cascade to reach the trigger.
        const cascade = table === "payment_plan_rows" ? " cascade" : "";
        await expect(database.pool.query(`truncate ${table}${cascade}`)).rejects.toThrow(
          new RegExp(`${table}.*TRUNCATE refused|payments rows are evidence`),
        );
      },
    );
    const approvalFor = async (
      dealId: string,
      o: { gate?: string; status?: string; proposal?: Record<string, unknown>; entityId?: string } = {},
    ) => {
      const id = newId();
      await database.db.insert(spaApprovals).values({
        id,
        gate: (o.gate ?? "price_out_of_range") as never,
        entityKind: "deal",
        entityId: o.entityId ?? dealId,
        dedupeKey: `k:${id}`,
        title: "x",
        proposal: o.proposal ?? {},
        approverRole: "sales_manager",
        proposedBy: "system",
        status: (o.status ?? "approved") as never,
        ...(o.status === "pending"
          ? {}
          : { decidedBy: users.manager!.id, decidedAt: new Date("2026-11-19T06:00:00Z") }),
        createdAt: new Date("2026-11-19T06:00:00Z"),
      });
      return id;
    };
    const q = (sql: string, params: unknown[] = []) => database.pool.query(sql, params);
    test("a broker row is never deleted; the approval link is write-once; bps and side are fixed once linked", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      await broker(database, dealId, "seller", "Sample Realty", 150);
      await expect(q(`delete from deal_brokers where deal_id = $1`, [dealId])).rejects.toThrow(/deal_brokers/);
      // Unlinked: bps and agent can still be corrected; linking happens once.
      await q(`update deal_brokers set commission_bps = 160 where deal_id = $1`, [dealId]);
      const a1 = await approvalFor(dealId);
      const a2 = await approvalFor(dealId);
      await q(`update deal_brokers set commission_approval_id = $2 where deal_id = $1`, [dealId, a1]);
      await expect(
        q(`update deal_brokers set commission_approval_id = $2 where deal_id = $1`, [dealId, a2]),
      ).rejects.toThrow(/linked once/);
      await expect(
        q(`update deal_brokers set commission_approval_id = null where deal_id = $1`, [dealId]),
      ).rejects.toThrow(/linked once/);
      await expect(q(`update deal_brokers set commission_bps = 170 where deal_id = $1`, [dealId])).rejects.toThrow(
        /fixed once/,
      );
      await expect(q(`update deal_brokers set side = 'buyer' where deal_id = $1`, [dealId])).rejects.toThrow(
        /fixed once/,
      );
      await q(`update deal_brokers set agent_name = 'Other Agent' where deal_id = $1`, [dealId]);
    });
    test("commission_status is gone: the approval row is the only record of whether an override is approved", async () => {
      const r = await q(
        `select 1 from information_schema.columns where table_name = 'deal_brokers' and column_name = 'commission_status'`,
      );
      expect(r.rowCount).toBe(0);
    });
    test("an override is printed only with an approved price_out_of_range for this deal, this side and this %", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      const policyBps = DEFAULT_SPA_POLICY.commission.sellerSideBps;
      await broker(database, dealId, "seller", "Sample Realty", 777);
      const link = (id: string) =>
        database.db.update(dealBrokers).set({ commissionApprovalId: id }).where(eq(dealBrokers.dealId, dealId));
      const printed = async () => (await sheetOf(dealId)).values.broker_commission;
      expect(await printed()).toBe(policyBps);
      const right = { side: "seller", commissionBps: 777, policyBps };
      // Wrong gate, wrong deal, wrong side, wrong %, not approved: each leaves the policy % in place.
      const wrong = [
        { gate: "cancellation", proposal: right },
        { entityId: newId(), proposal: right },
        { proposal: { ...right, side: "buyer" } },
        { proposal: { ...right, commissionBps: 778 } },
        { proposal: right, status: "pending" },
        { proposal: right, status: "rejected" },
      ];
      for (const w of wrong) {
        await database.pool.query(`alter table deal_brokers disable trigger user`);
        await database.db.update(dealBrokers).set({ commissionApprovalId: null }).where(eq(dealBrokers.dealId, dealId));
        await database.pool.query(`alter table deal_brokers enable trigger user`);
        await link(await approvalFor(dealId, w));
        expect(await printed()).toBe(policyBps);
      }
      await database.pool.query(`alter table deal_brokers disable trigger user`);
      await database.db.update(dealBrokers).set({ commissionApprovalId: null }).where(eq(dealBrokers.dealId, dealId));
      await database.pool.query(`alter table deal_brokers enable trigger user`);
      await link(await approvalFor(dealId, { proposal: right }));
      expect(await printed()).toBe(777);
    });
  });

  describe("setPaymentPlan", () => {
    test("stores rows whose amounts add up to the price, by the rulebook's validatePlan (remainder to the last row)", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { price: 100_000_001 });
      const r = await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      expect(r.rows).toBe(3);
      const rows = await database.db.select().from(paymentPlanRows).where(eq(paymentPlanRows.dealId, dealId));
      expect(rows.reduce((a, x) => a + x.amountFils, 0)).toBe(100_000_001);
      expect(rows.toSorted((a, b) => a.seq - b.seq).map((x) => x.enteredBy)).toEqual(
        Array(3).fill(`user:${users.officer!.id}`),
      );
    });

    test("replaces the previous rows; shares must add up; a primary booking below the minimum is refused", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      await setPaymentPlan(
        ctx(),
        dealId,
        { instalments: [{ label: "All at once", shareBps: 10_000, dueOn: "2026-12-01" }] },
        users.officer!,
      );
      expect(await database.db.select().from(paymentPlanRows).where(eq(paymentPlanRows.dealId, dealId))).toHaveLength(
        1,
      );
      const short = { instalments: [{ label: "Part", shareBps: 5000, dueOn: "2026-12-01" }] };
      expect(await fails(setPaymentPlan(ctx(), dealId, short, users.officer!))).toEqual({
        status: 422,
        code: "invalid_plan",
      });
      const lowBooking = {
        instalments: [
          { label: "Booking", shareBps: 500, dueOn: "2026-12-01" },
          { label: "Rest", shareBps: 9500, dueOn: "2027-12-01" },
        ],
      };
      expect(await fails(setPaymentPlan(ctx(), dealId, lowBooking, users.officer!))).toEqual({
        status: 422,
        code: "invalid_plan",
      });
      // Nothing changed by the refusals.
      expect(await database.db.select().from(paymentPlanRows).where(eq(paymentPlanRows.dealId, dealId))).toHaveLength(
        1,
      );
    });

    test("a resale's first instalment may be below the booking minimum (the booking rule is primary only)", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_offplan" });
      const p = {
        instalments: [
          { label: "Part", shareBps: 500, dueOn: "2026-12-01" },
          { label: "Rest", shareBps: 9500, dueOn: "2027-12-01" },
        ],
      };
      expect((await setPaymentPlan(ctx(), dealId, p, users.officer!)).rows).toBe(2);
    });

    test("only sales roles and admin; unknown deal 404; not after the deal is closed; bad input 422", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      expect(await fails(setPaymentPlan(ctx(), dealId, PLAN, users.legal!))).toEqual({
        status: 403,
        code: "forbidden",
      });
      expect(await fails(setPaymentPlan(ctx(), dealId, PLAN, users.finance!))).toEqual({
        status: 403,
        code: "forbidden",
      });
      expect(await fails(setPaymentPlan(ctx(), newId(), PLAN, users.officer!))).toMatchObject({ status: 404 });
      expect(await fails(setPaymentPlan(ctx(), dealId, { instalments: [] }, users.officer!))).toEqual({
        status: 422,
        code: "invalid_plan",
      });
      await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, dealId));
      expect(await fails(setPaymentPlan(ctx(), dealId, PLAN, users.officer!))).toEqual({
        status: 409,
        code: "deal_closed",
      });
    });

    test("fixed once an agreement is live; free again when it is superseded", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      const [tv] = await database.pool
        .query(
          `insert into spa_templates (id, name, document_kind, created_by, created_at) values (gen_random_uuid(), 'T', 'spa', 'u', now()) returning id`,
        )
        .then((r) => r.rows);
      const v = await database.pool.query(
        `insert into spa_template_versions (id, template_id, version, doc_id, doc_hash, sections, blanks, look, party_blocks, signature_roles, checks, rules_version, created_by, created_at)
         values (gen_random_uuid(), $1, 1, 'd', 'h', '{}', '[]', '{}', '[]', '{}', '[]', 'r', 'u', now()) returning id`,
        [tv.id],
      );
      const id = newId();
      await database.db.insert(agreements).values({
        id,
        dealId,
        kind: "spa",
        version: 1,
        templateVersionId: v.rows[0].id,
        status: "prepared",
        docHash: "d",
        storageKey: "k",
        valuesHash: "v",
        fieldSources: {},
        rulesVersion: "r",
        policyVersion: 0,
        preparedBy: "system:prepare",
        preparedAt: new Date(),
      });
      expect(await fails(setPaymentPlan(ctx(), dealId, PLAN, users.officer!))).toEqual({
        status: 409,
        code: "plan_fixed",
      });
      await database.pool.query("update agreements set status = 'superseded' where id = $1", [id]);
      expect((await setPaymentPlan(ctx(), dealId, PLAN, users.officer!)).rows).toBe(3);
    });

    test("an event records who set the plan and how many rows, never the amounts", async () => {
      const { dealId } = await dealInDraft(ctx(), database);
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      const { rows } = await database.pool.query(
        "select actor, payload, rules_version from deal_events where entity_id = $1 and type = 'PAYMENT_PLAN_SET'",
        [dealId],
      );
      expect(rows).toHaveLength(1);
      expect(rows[0].actor).toBe(`user:${users.officer!.id}`);
      expect(rows[0].payload).toEqual({ rows: 3 });
      expect(rows[0].rules_version).toBe(RB.version);
    });
  });
});
