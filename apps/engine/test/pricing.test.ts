import { defaultCompanyPolicy } from "@leasing/core";
import { beforeEach, describe, expect, test } from "bun:test";
import type { CalendarDate } from "@leasing/core";
import { newId } from "@leasing/core";
import { contractRules, type Database, leases, rentRules, sriAverages, units, withTx } from "@leasing/db";
import { eq } from "drizzle-orm";
import { offerRentFloorFils } from "@leasing/helpers";
import { findRentRule, findSri, offerPolicyAndRuleFor, offerPolicyFor, priceRangeFor } from "../src/manager/pricing.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { lookupSri } from "../src/manager/sri.ts";
import { freshDatabase, leaseCsv, noDb, testContext, testCompany } from "./harness.ts";

const TODAY = "2026-10-27" as CalendarDate;

describe.skipIf(noDb)("pricing: rent rule, SRI and range lookups", () => {
  let database: Database;
  let companyId: string;
  let otherId: string;

  beforeEach(async () => {
    database = await freshDatabase();
    companyId = await testCompany(database, { slug: "price-co", name: "Price Co", rules: false });
    otherId = await testCompany(database, { slug: "other-co", name: "Other Co", rules: false });
  });

  const rule = async (over: Partial<typeof rentRules.$inferInsert> = {}) => {
    const id = over.id ?? newId();
    await database.db.insert(rentRules).values({
      companyId,
      category: "residential",
      emirate: "dubai",
      minPctBp: -500,
      maxPctBp: 500,
      createdBy: "test",
      ...over,
      id,
    });
    return id;
  };
  const sri = async (over: Partial<typeof sriAverages.$inferInsert> = {}) => {
    const id = newId();
    await database.db.insert(sriAverages).values({
      id,
      community: "Dubai Marina",
      category: "residential",
      bedrooms: 1,
      avgAnnualRentFils: 10_000_000,
      source: "mock",
      effectiveFrom: "2025-01-01" as CalendarDate,
      createdBy: "test",
      ...over,
    });
    return id;
  };
  const unit = (over: Partial<typeof units.$inferSelect> = {}) =>
    ({
      companyId,
      category: "residential",
      subtype: "apartment",
      community: "Dubai Marina",
      emirate: "dubai",
      areaSqft: 800,
      bedrooms: 1,
      ...over,
    }) as typeof units.$inferSelect;
  const run = <T>(fn: (tx: Parameters<Parameters<typeof withTx>[1]>[0]) => Promise<T>) => withTx(database, fn);

  test("picks the community rule over the subtype rule over the category rule", async () => {
    const category = await rule();
    const subtype = await rule({ subtype: "apartment" });
    const community = await rule({ community: "Dubai Marina" });
    expect((await run((tx) => findRentRule(tx, unit())))?.id).toBe(community);
    expect((await run((tx) => findRentRule(tx, unit({ community: "JVC" }))))?.id).toBe(subtype);
    expect((await run((tx) => findRentRule(tx, unit({ community: "JVC", subtype: "villa" }))))?.id).toBe(category);
    expect((await run((tx) => findRentRule(tx, unit({ community: "JVC", subtype: null }))))?.id).toBe(category);
  });

  test("the newest of two equal rules wins", async () => {
    const older = await rule();
    await database.db
      .update(rentRules)
      .set({ createdAt: new Date("2026-01-01T00:00:00Z") })
      .where(eq(rentRules.id, older));
    const newer = await rule();
    expect((await run((tx) => findRentRule(tx, unit())))?.id).toBe(newer);
  });

  test("with equal createdAt the larger id wins", async () => {
    const at = new Date("2026-01-01T00:00:00Z");
    const [lo, hi] = [newId(), newId()].sort() as [string, string];
    await rule({ id: hi, createdAt: at });
    await rule({ id: lo, createdAt: at });
    expect((await run((tx) => findRentRule(tx, unit())))?.id).toBe(hi);
  });

  test("ignores inactive rules and rules of another company, category or emirate", async () => {
    await rule({ active: false });
    await rule({ companyId: otherId });
    await rule({ category: "commercial" });
    await rule({ emirate: "abu_dhabi" });
    expect(await run((tx) => findRentRule(tx, unit()))).toBeNull();
    const own = await rule();
    expect((await run((tx) => findRentRule(tx, unit())))?.id).toBe(own);
  });

  test("residential SRI is matched by bedrooms and takes the latest row in effect", async () => {
    await sri({ bedrooms: 2, avgAnnualRentFils: 15_000_000 });
    await sri({ avgAnnualRentFils: 9_000_000, effectiveFrom: "2025-01-01" as CalendarDate });
    const latest = await sri({ avgAnnualRentFils: 10_000_000, effectiveFrom: "2026-06-01" as CalendarDate });
    await sri({ avgAnnualRentFils: 99_000_000, effectiveFrom: "2027-01-01" as CalendarDate }); // not in effect yet
    const found = await run((tx) => findSri(tx, unit(), TODAY));
    expect(found).toMatchObject({ id: latest, avgAnnualRentFils: 10_000_000, label: "SRI Dubai Marina 1-bed" });
    expect((await run((tx) => findSri(tx, unit({ bedrooms: 2 }), TODAY)))?.avgAnnualRentFils).toBe(15_000_000);
    expect(await run((tx) => findSri(tx, unit({ bedrooms: 3 }), TODAY))).toBeNull();
  });

  test("the same community name in two emirates gets each emirate's own row", async () => {
    const dxb = await sri({ emirate: "dubai", community: "Al Nahda", avgAnnualRentFils: 6_000_000 });
    const shj = await sri({ emirate: "sharjah", community: "Al Nahda", avgAnnualRentFils: 4_000_000 });
    const d = await run((tx) => findSri(tx, unit({ emirate: "dubai", community: "Al Nahda" }), TODAY));
    const s = await run((tx) => findSri(tx, unit({ emirate: "sharjah", community: "Al Nahda" }), TODAY));
    expect(d).toMatchObject({ id: dxb, label: "SRI Al Nahda 1-bed" });
    expect(s).toMatchObject({ id: shj, avgAnnualRentFils: 4_000_000, label: "Rent index Al Nahda 1-bed" });
    expect(await run((tx) => findSri(tx, unit({ emirate: "ajman", community: "Al Nahda" }), TODAY))).toBeNull();
  });

  test("commercial SRI is matched with bedrooms IS NULL and gives a per-sqft value", async () => {
    await sri({ bedrooms: 1 }); // residential row for the same community: never matched
    const id = await sri({
      category: "commercial",
      bedrooms: null,
      avgAnnualRentFils: null,
      avgAnnualRentPerSqftFils: 15_000,
    });
    const office = unit({ category: "commercial", subtype: "office", bedrooms: null });
    expect(await run((tx) => findSri(tx, office, TODAY))).toMatchObject({
      id,
      avgAnnualRentFils: null,
      avgAnnualRentPerSqftFils: 15_000,
    });
    expect(await run((tx) => findSri(tx, unit({ category: "retail", bedrooms: null }), TODAY))).toBeNull();
  });

  test("priceRangeFor combines the rule and the SRI, and reports what it used", async () => {
    const ruleId = await rule();
    const sriId = await sri();
    const r = await run((tx) => priceRangeFor(tx, unit(), TODAY));
    expect(r).toMatchObject({ ruleId, sriId, sriLabel: "SRI Dubai Marina 1-bed" });
    expect(r.range).toMatchObject({ min: 9_500_000, max: 10_500_000 });
    // No rule: no range.
    expect((await run((tx) => priceRangeFor(tx, unit({ companyId: otherId }), TODAY))).range).toBeNull();
  });

  test("offer discount per rent rule (D63): the unit's rule sets it, else the company default; never below the band", async () => {
    await rule({ maxOfferDiscountPct: 5, community: "Dubai Marina" });
    await rule({ emirate: "sharjah", maxOfferDiscountPct: null });
    await sri();
    const marina = await run((tx) => offerPolicyAndRuleFor(tx, unit(), TODAY));
    expect(marina).toMatchObject({ discountFrom: "rent rule" });
    expect(marina.policy).toMatchObject({ maxRentDiscountPercent: 5, offerFloorMinFils: 9_500_000 });
    // Asking AED 100,000 less 5% = 95,000, the band's lowest: the floor stops there.
    expect(offerRentFloorFils(10_000_000, marina.policy)).toBe(9_500_000);
    // Asking at the band's bottom: a 5% discount would go under the band, so the band's lowest is the floor.
    expect(offerRentFloorFils(9_500_000, marina.policy)).toBe(9_500_000);
    // Asking above the band (approved by a manager): the discount applies from the asking rent.
    expect(offerRentFloorFils(12_000_000, marina.policy)).toBe(11_400_000);
    // Asking below the band (approved by a manager): the band floor doesn't push it up.
    expect(offerRentFloorFils(9_000_000, marina.policy)).toBe(8_550_000);
    // A rule with no discount, and a unit with no rule: the company default.
    const sharjah = await run((tx) => offerPolicyAndRuleFor(tx, unit({ emirate: "sharjah" }), TODAY));
    expect(sharjah.discountFrom).toBe("company default");
    expect(sharjah.policy.maxRentDiscountPercent).toBe(defaultCompanyPolicy.maxRentDiscountPercent);
    const none = await run((tx) => offerPolicyAndRuleFor(tx, unit({ companyId: otherId }), TODAY));
    expect(none).toMatchObject({ discountFrom: "company default", rentRuleId: null });
    expect(none.policy.offerFloorMinFils).toBeNull();
  });

  test("offerPolicyFor returns the contract rule's cheque range", async () => {
    await database.db.insert(contractRules).values({
      id: newId(),
      companyId,
      category: "residential",
      tenures: ["annual"],
      minCheques: 2,
      maxCheques: 6,
      createdBy: "test",
    });
    const policy = await run((tx) => offerPolicyFor(tx, unit(), TODAY));
    expect(policy).toMatchObject({ minCheques: 2, maxCheques: 6 });
    expect(policy.offerDefaultCheques).toBeGreaterThanOrEqual(2);
    expect(policy.offerDefaultCheques).toBeLessThanOrEqual(6);
    // Another company has no contract rule: the company policy stands.
    const plain = await run((tx) => offerPolicyFor(tx, unit({ companyId: otherId }), TODAY));
    expect(plain.maxCheques).not.toBe(6);
  });
  test("contract rules per emirate (D58): another emirate never applies; the unit's emirate beats any emirate", async () => {
    const cr = (over: Partial<typeof contractRules.$inferInsert>) =>
      database.db.insert(contractRules).values({
        id: newId(),
        companyId,
        category: "residential",
        tenures: ["annual"],
        minCheques: 1,
        maxCheques: 4,
        createdBy: "test",
        ...over,
      });
    await cr({ emirate: "dubai", maxCheques: 6 });
    // A Sharjah unit gets no Dubai rule: the company defaults stand.
    const sharjah = await run((tx) => offerPolicyFor(tx, unit({ emirate: "sharjah" }), TODAY));
    expect(sharjah.maxCheques).not.toBe(6);
    // An any-emirate apartment rule is newer and more specific by type, but the Dubai rule names the unit's emirate.
    await cr({ subtype: "apartment", maxCheques: 3 });
    expect((await run((tx) => offerPolicyFor(tx, unit(), TODAY))).maxCheques).toBe(6);
    expect((await run((tx) => offerPolicyFor(tx, unit({ emirate: "sharjah" }), TODAY))).maxCheques).toBe(3);
  });

  test("lookupSri gives no residential average for a commercial unit, even with bedrooms set", async () => {
    const t = testContext(database, "2026-10-19T04:00:00Z");
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "SRI-1", start_on: "2026-06-01", end_on: "2027-05-31" }]),
      "import",
      companyId,
    );
    const [u] = await database.db.select().from(units).where(eq(units.code, "SRI-1"));
    await database.db.update(units).set({ community: "Dubai Marina", bedrooms: 1 }).where(eq(units.id, u!.id));
    await sri();
    const [lease] = await database.db.select().from(leases).where(eq(leases.unitId, u!.id));
    const look = () => run((tx) => lookupSri(tx, { id: lease!.id, endOn: lease!.endOn }, TODAY));
    expect(await look()).toMatchObject({ avgAnnualRentFils: 10_000_000, source: "table" });
    await database.db.update(units).set({ category: "commercial", subtype: "office" }).where(eq(units.id, u!.id));
    expect(await look()).toBeNull();
  });
});
