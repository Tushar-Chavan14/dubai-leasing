import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock } from "@platform/kernel/clock";
import {
  amlCases,
  companies,
  dealEvents,
  dealParties,
  deals,
  listings,
  parties,
  priceLists,
  projects,
  spaApprovals,
  spaTasks,
  units,
  type SpaDatabase,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { failClosedFacts } from "../src/manager/facts.ts";
import { getProject, listProjects } from "../src/manager/inventory.ts";
import { listListings, ListingsQuery } from "../src/manager/listing-reads.ts";
import { companyKind } from "../src/manager/parties.ts";
import { getDealRecord, listDeals, DealsQuery } from "../src/manager/reads.ts";
import { seedSpaDemo } from "../src/seed.ts";
import { spaTemplates, spaUsers } from "@spa/db";
import { getTemplate, getTemplateVersion, listTemplates } from "../src/manager/template-reads.ts";
import { COMPLIANCE_WORDS } from "./reads-fixture.ts";

const url = spaTestDatabaseUrl();
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));

describe.skipIf(!url)("C30: the demo seed fills the Work screens (S58)", () => {
  let database: SpaDatabase;
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    await seedSpaDemo(database, clock, { SPA_DEMO_MODE: true });
  });
  afterAll(async () => {
    await database?.close();
  });
  const all = () => database.db.select().from(deals);

  test("a few deals of each type, at different stages", async () => {
    const rows = await all();
    const byType = (t: string) => rows.filter((d) => d.dealType === t);
    for (const t of ["primary_offplan", "resale_ready", "resale_offplan"])
      expect(byType(t).length).toBeGreaterThanOrEqual(2);
    const stages = new Set(rows.map((d) => d.state));
    for (const s of ["OFFER_AGREED", "PARTY_CHECK", "AGREEMENT_DRAFT", "LEGAL_REVIEW", "AML_HOLD", "CANCELLED"])
      expect(stages.has(s as never)).toBe(true);
    for (const t of ["primary_offplan", "resale_ready", "resale_offplan"])
      expect(new Set(byType(t).map((d) => d.state)).size).toBeGreaterThanOrEqual(2);
  });

  test("M5: leads in every status and viewings today, upcoming and past, with and without an outcome; project agents set", async () => {
    const { rows: leads } = await database.pool.query("select status, source, agent_user_id from spa_leads");
    for (const st of ["new", "contacted", "viewing_booked", "interested", "not_interested", "closed"])
      expect(
        leads.some((l: { status: string }) => l.status === st),
        st,
      ).toBe(true);
    expect(leads.some((l: { source: string }) => l.source === "staff")).toBe(true);
    expect(leads.some((l: { source: string }) => l.source === "listing_chat")).toBe(true);
    const { rows: v } = await database.pool.query("select status, starts_at from spa_viewings");
    const day = (offset: number) => new Date(Date.parse("2026-11-19T00:00:00+04:00") + offset * 86_400_000).getTime();
    const at = (x: { starts_at: Date }) => new Date(x.starts_at).getTime();
    expect(v.some((x) => at(x) >= day(0) && at(x) < day(1))).toBe(true);
    expect(v.some((x) => at(x) >= day(1) && x.status === "booked")).toBe(true);
    expect(v.some((x) => at(x) < day(0) && x.status === "booked")).toBe(true);
    expect(v.some((x) => at(x) < day(0) && x.status === "attended")).toBe(true);
    expect(v.some((x) => x.status === "no_show")).toBe(true);
    expect(v.some((x) => x.status === "cancelled")).toBe(true);
    const { rows: p } = await database.pool.query(
      "select count(*)::int as n from projects where sales_agent_user_id is not null",
    );
    expect(p[0].n).toBeGreaterThanOrEqual(1);
    // Every seeded row went through events: leads have a creation event.
    const { rows: ev } = await database.pool.query(
      "select count(*)::int as n from deal_events where entity_kind = 'lead' and type = 'LEAD_CREATED'",
    );
    expect(ev[0].n).toBe(leads.length);
  });

  test("every deal went through the manager: it has a creation event and an event for each move, with the rulebook version", async () => {
    for (const d of await all()) {
      const events = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, d.id));
      expect(events.some((e) => e.type === "DEAL_CREATED")).toBe(true);
      expect(events.every((e) => e.rulesVersion === d.rulesVersion || e.rulesVersion === null)).toBe(true);
      if (d.state !== "OFFER_AGREED")
        expect(events.filter((e) => e.toState === d.state).length).toBeGreaterThanOrEqual(1);
    }
  });

  test("the hold is a real review: an open case and a pending gate, so sales read 'Compliance review: open'", async () => {
    const [held] = await database.db.select().from(deals).where(eq(deals.state, "AML_HOLD"));
    expect(held).toBeDefined();
    expect((await database.db.select().from(amlCases).where(eq(amlCases.dealId, held!.id))).length).toBe(1);
    expect(
      (await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, held!.id))).some(
        (a) => a.gate === "aml_flag" && a.status === "pending",
      ),
    ).toBe(true);
  });

  test("a deal in default and open tasks, so the flags and the Tasks tab are not empty", async () => {
    expect((await all()).some((d) => d.inDefault)).toBe(true);
    expect(
      (await database.db.select().from(spaTasks).where(eq(spaTasks.status, "open"))).length,
    ).toBeGreaterThanOrEqual(2);
  });

  test("primary and taken-over plans have payment plans; both resale kinds have listings and the primary ones units", async () => {
    const rows = await all();
    const primary = rows.filter((d) => d.dealType === "primary_offplan");
    expect(primary.every((d) => d.unitId && !d.listingId)).toBe(true);
    expect(rows.filter((d) => d.dealType !== "primary_offplan").every((d) => d.listingId && !d.unitId)).toBe(true);
    const ctx = { database, clock, facts: failClosedFacts };
    const officer = (await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer")))[0]!;
    const withPlan: string[] = [];
    for (const d of rows) {
      const rec = await getDealRecord(ctx, { id: officer.id, role: officer.role }, d.id);
      if ("payment_plan" in rec.sections && (rec.sections.payment_plan as unknown[]).length) withPlan.push(d.dealType);
    }
    expect(withPlan).toContain("primary_offplan");
    expect(withPlan).toContain("resale_offplan");
  });

  test("everything is fictional and labelled: sample or fictional names, placeholders, test-only emails", async () => {
    const ps = await database.db.select().from(parties);
    expect(ps.length).toBeGreaterThanOrEqual(10);
    for (const p of ps) {
      if (p.fullNameEn) expect(p.fullNameEn).toMatch(/^(Sample|Fictional|Zorvan Ketterly)/);
      expect(p.email ?? "").toMatch(/\.test$/);
      if (p.passportNo) expect(p.passportNo).toBe("[PASSPORT NO.]");
    }
  });

  test("sales read the seeded deals with no compliance word and no personal number", async () => {
    const ctx = { database, clock, facts: failClosedFacts };
    const officer = (await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer")))[0]!;
    const viewer = { id: officer.id, role: officer.role };
    const page = await listDeals(ctx, viewer, DealsQuery.parse({ limit: "100" }));
    expect(page.items.length).toBe((await all()).length);
    expect(page.items.some((d) => d.stage === "ON_HOLD")).toBe(true);
    const text =
      JSON.stringify(page) + JSON.stringify(await Promise.all(page.items.map((d) => getDealRecord(ctx, viewer, d.id))));
    expect(text).not.toMatch(COMPLIANCE_WORDS);
    expect(text).not.toMatch(/\d{3}-\d{4}-\d{7}-\d/);
  });

  test("C32: a fictional project with buildings, every unit placed, a published price list and a masked escrow account", async () => {
    const ctx = { database, clock, facts: failClosedFacts };
    const [admin] = await database.db.select().from(spaUsers).where(eq(spaUsers.role, "admin"));
    const officer = (await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer")))[0]!;
    const list = await listProjects(ctx, { id: admin!.id, role: "admin" });
    // S78: a second project is seeded for the public site; this test reads the first one.
    expect(list.items.length).toBe(2);
    expect(list.unplacedUnits).toBe(0);
    const project = list.items.find((p) => p.name === "Demo Marina Vista");
    expect(project!.buildings).toBeGreaterThanOrEqual(2);
    expect(project!.units).toBeGreaterThanOrEqual(8);
    expect(project!.priceListVersion).toBeGreaterThanOrEqual(1);
    const rec = await getProject(ctx, { id: officer.id, role: officer.role }, project!.id);
    expect(rec.escrow?.accountMasked).toMatch(/^•••• \d{4}$/);
    expect(JSON.stringify(rec)).not.toMatch(/AE\d{2}/);
    // the demo deals' units are in the project and at least one is held with a deal link
    expect(rec.units.some((u) => u.deal !== null)).toBe(true);
    expect(rec.units.some((u) => u.state === "AVAILABLE" && u.listPriceFils !== null)).toBe(true);
    // prices are in whole dirhams between AED 1m and AED 3m (integer fils)
    for (const u of rec.units) expect(u.listPriceFils! >= 100_000_000 && u.listPriceFils! <= 300_000_000).toBe(true);
    expect(JSON.stringify(rec)).not.toMatch(COMPLIANCE_WORDS);
  });

  test("S75: every demo unit has its details, the project has a community and description, the listing its new fields", async () => {
    const rows = await database.db.select().from(units);
    expect(rows.length).toBeGreaterThanOrEqual(8);
    for (const u of rows) {
      expect(u.type, u.code).not.toBeNull();
      expect(u.bedrooms, u.code).not.toBeNull();
      expect(u.internalSqft, u.code).not.toBeNull();
      expect(u.view, u.code).not.toBeNull();
    }
    expect(rows.filter((u) => u.type === "penthouse")).toHaveLength(2);
    expect(rows.some((u) => u.bedrooms === 0)).toBe(true);
    const [p] = await database.db.select().from(projects).where(eq(projects.code, "MV-01"));
    expect(p!.community).toBeTruthy();
    expect(p!.description).toBeTruthy();
    const [l] = await database.db.select().from(listings).where(eq(listings.ref, "L-0001"));
    expect(l).toMatchObject({ unitType: "apartment", furnished: "semi", bathrooms: 2 });
  });

  test("C32: the company is set, so inventory and listings can both be opened; the demo listings show on the table", async () => {
    const ctx = { database, clock, facts: failClosedFacts };
    const officer = (await database.db.select().from(spaUsers).where(eq(spaUsers.role, "sales_officer")))[0]!;
    const page = await listListings(ctx, { id: officer.id, role: officer.role }, ListingsQuery.parse({}));
    expect(page.items.length).toBe((await database.db.select().from(listings)).length);
    expect(JSON.stringify(page)).not.toMatch(/Sample Owner/);
    expect(await companyKind(database.db)).toBe("both");
    expect((await database.db.select().from(companies)).length).toBe(1);
  });

  test("C34: one fictional template with a version in review and its gate open for legal; no real data", async () => {
    const ctx = { database, clock, facts: failClosedFacts };
    const legal = (await database.db.select().from(spaUsers).where(eq(spaUsers.role, "legal")))[0]!;
    const list = await listTemplates(ctx, { role: "legal" });
    expect(list.items.length).toBe(1);
    expect(list.items[0]!.name).toContain("[SAMPLE]");
    expect(list.items[0]!.latest?.status).toBe("in_review");
    const rec = await getTemplate(ctx, { role: "legal" }, list.items[0]!.id);
    const view = await getTemplateVersion(ctx, { role: "legal" }, rec.versions[0]!.id);
    expect(view.blanks.length).toBeGreaterThanOrEqual(5);
    const gates = (await database.db.select().from(spaApprovals)).filter((a) => a.gate === "template_approval");
    expect(gates.length).toBe(1);
    expect(gates[0]!.status).toBe("pending");
    expect(legal.role).toBe("legal");
    expect(JSON.stringify(view)).not.toMatch(/@|\b784-|\+971/);
  });

  test("running the seed again changes nothing", async () => {
    const before = [
      (await all()).length,
      (await database.db.select().from(listings)).length,
      (await database.db.select().from(units)).length,
      (await database.db.select().from(dealParties)).length,
      (await database.db.select().from(spaTasks)).length,
      (await database.db.select().from(projects)).length,
      (await database.db.select().from(priceLists)).length,
      (await database.db.select().from(spaTemplates)).length,
    ];
    await seedSpaDemo(database, clock, { SPA_DEMO_MODE: true });
    const after = [
      (await all()).length,
      (await database.db.select().from(listings)).length,
      (await database.db.select().from(units)).length,
      (await database.db.select().from(dealParties)).length,
      (await database.db.select().from(spaTasks)).length,
      (await database.db.select().from(projects)).length,
      (await database.db.select().from(priceLists)).length,
      (await database.db.select().from(spaTemplates)).length,
    ];
    expect(after).toEqual(before);
  });
});

describe.skipIf(!url)("seedSpaDemo refuses outside demo mode (review 15)", () => {
  test("without SPA_DEMO_MODE it throws and writes nothing, whoever calls it", async () => {
    const database = await freshSpaDatabase(url!);
    try {
      await expect(seedSpaDemo(database, clock, { SPA_DEMO_MODE: false })).rejects.toThrow(
        "SPA_DEMO_MODE must be true",
      );
      expect(await database.db.select().from(spaUsers)).toHaveLength(0);
      expect(await database.db.select().from(deals)).toHaveLength(0);
      await seedSpaDemo(database, clock, { SPA_DEMO_MODE: true });
      expect((await database.db.select().from(deals)).length).toBeGreaterThan(0);
    } finally {
      await database.close();
    }
  });
});
