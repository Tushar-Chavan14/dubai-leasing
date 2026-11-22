/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { buildWorld, EID, PASSPORT, PHONE, type World } from "../../engine/test/reads-fixture.ts";
import { DealRecord } from "../components/deal-record";
import { DealTable } from "../components/deal-table";
import { HomeView } from "../components/home-view";
import { loadDeals, loadHome, loadRecordPage, type Get } from "../lib/loaders";
import { parseWorkSearch } from "../lib/work";
import { COMPLIANCE_WORDS } from "./fixtures";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

/** The real engine routes, the real role filter and the real page code, end to end, on the test database. */
describe.skipIf(!url)("C30: pages render what the engine returns, per role", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  const getAs =
    (role: keyof World["users"]): Get =>
    async (path, schema) => {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${issueToken(SECRET, w.users[role]!.id, NOW)}` },
      });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  const SALES = [
    ["officer", "sales_officer"],
    ["manager", "sales_manager"],
    ["salesadmin", "sales_admin"],
    ["legal", "legal"],
    ["finance", "finance"],
  ] as const;

  test("the Work list renders both deal types with no compliance word and no personal number, for every role that sees Work", async () => {
    for (const [key, role] of SALES) {
      const page = (await loadDeals(getAs(key), parseWorkSearch({})))!;
      expect(page.items.length).toBe(2);
      const html = render(<DealTable deals={page.items} next={null} viewer={role} />);
      expect(html).toContain("Primary off-plan");
      expect(html).toContain("Ready resale");
      expect(html).toContain("On hold · review open");
      expect(html).toContain("Compliance review");
      expect(html).not.toMatch(COMPLIANCE_WORDS);
      for (const s of [PASSPORT, EID, PHONE]) expect(html).not.toContain(s);
    }
  });

  test("the filters reach the engine: hold, type and search", async () => {
    const get = getAs("officer");
    expect((await loadDeals(get, parseWorkSearch({ hold: "1" })))!.items.map((d) => d.type)).toEqual(["resale_ready"]);
    expect((await loadDeals(get, parseWorkSearch({ type: "primary_offplan" })))!.items.length).toBe(1);
    expect((await loadDeals(get, parseWorkSearch({ q: "Buyer One" })))!.items.length).toBe(1);
    expect((await loadDeals(get, parseWorkSearch({ q: "nobody-by-this-name" })))!.items.length).toBe(0);
    expect((await loadDeals(get, parseWorkSearch({ stage: "AML_HOLD" })))!.items.length).toBe(2);
    expect((await loadDeals(get, parseWorkSearch({ stage: "ON_HOLD" })))!.items.length).toBe(1);
  });

  test("a deal on hold with an open review: sales roles read 'Compliance review' and no compliance word anywhere on the page", async () => {
    for (const [key, role] of SALES) {
      const r = (await loadRecordPage(getAs(key), w.held.dealId, undefined))!;
      const html = render(<DealRecord record={r.record} events={r.events.items} nextEvents={null} viewer={role} />);
      expect(html).toContain("Compliance review");
      expect(html).toContain("On hold · review open");
      expect(html).toContain("Developer NOC");
      expect(html).not.toContain("Oqood");
      expect(html).not.toMatch(COMPLIANCE_WORDS);
      for (const s of [PASSPORT, EID, PHONE]) expect(html).not.toContain(s);
      expect(html).not.toMatch(/<(form|button|input)\b/);
    }
  });

  test("a primary deal renders its plan and its own steps", async () => {
    const r = (await loadRecordPage(getAs("officer"), w.plain.dealId, undefined))!;
    const html = render(
      <DealRecord record={r.record} events={r.events.items} nextEvents={null} viewer="sales_officer" />,
    );
    expect(html).toContain("Oqood registration");
    expect(html).not.toContain("Developer NOC");
  });

  test("compliance roles and admin have no Work screen: the engine still answers them, the page 404s before asking (rail rule)", async () => {
    const { railItems } = await import("@spa/core");
    for (const role of ["compliance_officer", "mlro", "admin"] as const)
      expect(railItems(role).some((i) => i.screen === "work")).toBe(false);
  });

  test("an unknown deal is not found", async () => {
    expect(await loadRecordPage(getAs("officer"), "0198a1b2-0000-7000-8000-00000000ffff", undefined)).toBeNull();
  });

  test("Home reads the summary and what waits for the role", async () => {
    const home = (await loadHome(getAs("officer")))!;
    const html = render(<HomeView summary={home.summary} tasks={home.tasks} gates={home.gates} />);
    expect(html).toContain("Waiting for you");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
    expect(home.summary.deals.open).toBe(2);
  });
});
