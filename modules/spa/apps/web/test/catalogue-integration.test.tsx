/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { noToggles } from "./no-toggles.ts";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { railItems, type CompanyKind } from "@spa/core";
import { renderToStaticMarkup as render } from "react-dom/server";
import { addDays, FixedClock, issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import type { SpaContext } from "../../engine/src/manager/context.ts";
import { failClosedFacts } from "../../engine/src/manager/facts.ts";
import { setEscrowAccount } from "../../engine/src/manager/escrow.ts";
import {
  addBuilding,
  addUnit,
  createPriceList,
  createProject,
  publishPriceList,
} from "../../engine/src/manager/inventory.ts";
import {
  createListingDraft,
  listingStep,
  recordListingSignature,
  recordOwnership,
} from "../../engine/src/manager/listings.ts";
import { createParty, setCompany } from "../../engine/src/manager/parties.ts";
import { seedUsers, type U } from "../../engine/test/prepare-fixtures.ts";
import { HomeView } from "../components/home-view";
import { ListingTable, ListingView } from "../components/listings";
import { ProjectTable, ProjectView } from "../components/projects";
import { UnitsBrowser } from "../components/units-browser";
import { WorkFilters } from "../components/work-filters";
import { loadListing, loadListings, loadProject, loadProjects, loadUnits, type Get } from "../lib/loaders";
import { parseWorkSearch } from "../lib/work";
import { COMPLIANCE_WORDS } from "./fixtures";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const IBAN = "AE070331234567890123456";
const OWNER = "Hidden Owner Name";
const DOC = "TD-SECRET-123";
const PASSPORT = "P7654321";
const LEASING = /\b(leas(e|es|ing)|tenan\w*|landlords?|ejari|rental)\b/i;
const KINDS: CompanyKind[] = ["developer", "brokerage", "both"];
const ROLES = [
  ["officer", "sales_officer"],
  ["manager", "sales_manager"],
  ["salesadmin", "sales_admin"],
  ["legal", "legal"],
  ["finance", "finance"],
  ["compliance", "compliance_officer"],
  ["mlro", "mlro"],
  ["admin", "admin"],
] as const;

/** The real engine routes, the real role and company-kind filter and the real page code, end to end, on the test database. */
describe.skipIf(!url)(
  "C32: the Inventory and Listings screens against the real engine, per role and company kind",
  () => {
    let database: SpaDatabase;
    let app: ReturnType<typeof createApp>;
    let ctx: SpaContext;
    let users: Record<string, U>;
    let projectId = "";
    let listingId = "";
    const getAs =
      (role: string): Get =>
      async (path, schema) => {
        const res = await app.request(path, {
          headers: { authorization: `Bearer ${issueToken(SECRET, users[role]!.id, NOW)}` },
        });
        if ([400, 403, 404].includes(res.status)) return null;
        expect(res.status).toBe(200);
        return schema.parse(await res.json());
      };
    const kind = (k: CompanyKind) => setCompany(ctx, { name: "Fictional Co", kind: k }, "system");

    beforeAll(async () => {
      database = await freshSpaDatabase(url!);
      users = await seedUsers(database);
      ctx = { database, clock: new FixedClock(new Date(NOW)), facts: failClosedFacts };
      // The app reads "today" from its own clock (the machine's day), so the permit is set relative to it.
      const appClock = new SpaDemoClock(database, false);
      await appClock.refresh();
      app = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: appClock,
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
      });
      await kind("both");
      const admin = users.admin!;
      const p = await createProject(
        ctx,
        { code: "MV-01", name: "Marina Vista", anticipatedCompletionOn: "2028-06-30" },
        admin,
      );
      projectId = p.id;
      const b = await addBuilding(ctx, p.id, { code: "A", name: "Tower A" }, admin);
      const u1 = await addUnit(ctx, p.id, { buildingId: b.id, code: "U-101" }, admin);
      const u2 = await addUnit(ctx, p.id, { buildingId: b.id, code: "U-102" }, admin);
      const l = await createPriceList(
        ctx,
        p.id,
        {
          items: [
            { unitId: u1.id, priceFils: 150_000_000 },
            { unitId: u2.id, priceFils: 160_000_000 },
          ],
        },
        admin,
      );
      await publishPriceList(ctx, l.id, admin);
      await setEscrowAccount(
        ctx,
        { projectCode: "MV-01", accountHolder: "Escrow Holder", iban: IBAN, bankName: "[BANK]" },
        admin,
      );
      const actor = `user:${users.officer!.id}` as const;
      const owner = await createParty(
        ctx,
        { kind: "person", fullNameEn: OWNER, nationality: "Testland", email: "o@example.test", passportNo: PASSPORT },
        actor,
      );
      const listing = await createListingDraft(
        ctx,
        {
          title: "2-bed apartment, Marina Vista",
          community: "Dubai Marina",
          propertyDescription: "Bright corner unit.",
          askingPriceFils: 185_000_000,
          permitNo: "[PERMIT NO.]",
          permitExpiresOn: addDays(appClock.today(), 5),
          sellers: [{ role: "seller", partyId: owner.id, order: 1, shareBps: 10_000 }],
        },
        users.officer!,
      );
      listingId = listing.id;
      await recordOwnership(ctx, listing.id, { kind: "title_deed", ref: DOC, ownersAsOnDocument: [OWNER] }, actor);
      await recordListingSignature(ctx, listing.id, owner.id, actor);
      await listingStep(ctx, listing.id, "VERIFY", { actor });
      await listingStep(ctx, listing.id, "ACTIVATE", { actor });
      await listingStep(ctx, listing.id, "PUBLISH", { actor });
    });
    afterAll(async () => {
      await database?.close();
    });

    test("the rail and the engine agree for every role and company kind: a screen the rail shows opens, one it hides is refused", async () => {
      for (const k of KINDS) {
        await kind(k);
        for (const [key, role] of ROLES) {
          const rail = railItems(role, k).map((i) => i.screen);
          const inv = await loadProjects(getAs(key));
          const lst = await loadListings(getAs(key), "all", undefined);
          expect(inv !== null, `${key}/${k} inventory`).toBe(rail.includes("inventory"));
          expect(lst !== null, `${key}/${k} listings`).toBe(rail.includes("listings"));
          expect((await loadProject(getAs(key), projectId)) !== null, `${key}/${k} project`).toBe(
            rail.includes("inventory"),
          );
          expect((await loadListing(getAs(key), listingId)) !== null, `${key}/${k} listing`).toBe(
            rail.includes("listings"),
          );
        }
      }
      await kind("both");
    });

    test("a developer company has no Listings item and a brokerage no Inventory item, on Work and Home as well", async () => {
      const counts = { deals: 0, tasks: 0, inbox: 0 };
      const summary = { deals: { open: 0, mine: 0, byStage: {} }, tasks: { open: 0 }, inbox: { open: 0 } } as never;
      for (const [k, inv, lst] of [
        ["developer", true, false],
        ["brokerage", false, true],
        ["both", true, true],
      ] as const) {
        const rail = railItems("sales_officer", k);
        const catalogue = {
          listings: rail.some((i) => i.screen === "listings"),
          inventory: rail.some((i) => i.screen === "inventory"),
        };
        expect(catalogue).toEqual({ listings: lst, inventory: inv });
        for (const html of [
          render(<WorkFilters search={parseWorkSearch({})} counts={counts} catalogue={catalogue} />),
          render(<HomeView summary={summary} tasks={[]} gates={[]} catalogue={catalogue} />),
        ]) {
          expect(html.includes('href="/inventory"')).toBe(inv);
          expect(html.includes('href="/listings"')).toBe(lst);
        }
      }
    });

    test("Inventory pages: the project, its units and the price in use; escrow masked; no AML or other-module word; no holder, no full number", async () => {
      for (const [key, role] of ROLES.filter(([, r]) =>
        ["sales_officer", "sales_manager", "sales_admin", "admin"].includes(r),
      )) {
        const list = (await loadProjects(getAs(key)))!;
        const rec = (await loadProject(getAs(key), projectId))!;
        const units = (await loadUnits(getAs(key), new URLSearchParams({ project: projectId })))!;
        const browser = render(
          <UnitsBrowser
            page={units}
            filters={{}}
            canWork={role !== "admin"}
            canAdd={false}
            nextHref={null}
            scope={{ projectId, action: `/inventory/projects/${projectId}` }}
          />,
        );
        const view = render(<ProjectView project={rec} viewer={role} units={<p>units</p>} />);
        const html = render(<ProjectTable projects={list.items} unplaced={list.unplacedUnits} />) + view + browser;
        for (const s of [
          "MV-01",
          "Marina Vista",
          "Tower A",
          "U-101",
          "AED 1,500,000",
          "AED 1,600,000",
          "Version 1",
          "In use",
          "•••• 3456",
          "30 Jun 2028",
        ])
          expect(html, `${key} ${s}`).toContain(s);
        for (const s of [IBAN, "AE07", "0331234567890", "Escrow Holder"]) expect(html).not.toContain(s);
        expect(html).not.toMatch(COMPLIANCE_WORDS);
        expect(html).not.toMatch(LEASING);
        expect(noToggles(view)).not.toMatch(/<(form|button|input)\b/);
      }
    });

    test("Listings pages: a row per listing with permit warning, page and no owner name; the record shows sellers to sales roles only", async () => {
      for (const [key, role] of ROLES.filter(([, r]) =>
        ["sales_officer", "sales_manager", "sales_admin", "admin"].includes(r),
      )) {
        const page = (await loadListings(getAs(key), "all", undefined))!;
        const table = render(<ListingTable listings={page.items} next={null} />);
        for (const s of [
          "L-0001",
          "Marina Vista",
          "Individual",
          "AED 1,850,000",
          "Published",
          "Expires in 5 days",
          "Live",
          "No offer",
        ])
          expect(table, `${key} ${s}`).toContain(s);
        for (const s of [OWNER, DOC, PASSPORT]) expect(table).not.toContain(s);
        const rec = render(<ListingView listing={(await loadListing(getAs(key), listingId))!} viewer={role} />);
        expect(rec).not.toContain(PASSPORT);
        // M3 (S77): the document number and its owners are for the sales roles; the admin sees neither.
        if (role === "admin") expect(rec).not.toContain(DOC);
        else expect(rec).toContain(DOC);
        if (role === "admin") {
          expect(rec).not.toContain(OWNER);
          expect(rec).toContain("Sellers are shown to sales roles");
        } else {
          expect(rec).toContain(OWNER);
          expect(rec).toContain("Signed");
        }
        for (const html of [table, rec]) {
          expect(html).not.toMatch(COMPLIANCE_WORDS);
          expect(html).not.toMatch(LEASING);
        }
      }
    });

    test("scope=mine reaches the engine", async () => {
      expect((await loadListings(getAs("officer"), "mine", undefined))!.items.length).toBe(0);
      expect((await loadListings(getAs("officer"), "all", undefined))!.items.length).toBe(1);
    });
  },
);
