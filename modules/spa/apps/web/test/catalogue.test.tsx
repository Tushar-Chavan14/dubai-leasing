import { describe, expect, test } from "bun:test";
import { noToggles } from "./no-toggles.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ListingTable, ListingView } from "../components/listings";
import { ProjectTable, ProjectView } from "../components/projects";
import { WorkFilters } from "../components/work-filters";
import { HomeView } from "../components/home-view";
import {
  parseAedToFils,
  postCatalogue,
  priceListRequest,
  projectRequest,
  buildingRequest,
  unitRequest,
  publishRequest,
} from "../lib/catalogue";
import { ListingRecord, ListingsPage, ProjectRecord, ProjectsList } from "../lib/contracts";
import { parseWorkSearch } from "../lib/work";
import { COMPLIANCE_WORDS } from "./fixtures";

const noop = async () => {};
const ACTIONS = { addBuilding: noop, addUnit: noop, createPriceList: noop, publishPriceList: noop };
const UNITS = <p>units slot</p>;
const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;

const permit = (status: "none" | "valid" | "expiring" | "expired", daysLeft: number | null) => ({
  no: status === "none" ? null : "[PERMIT NO.]",
  issuedOn: null,
  expiresOn: daysLeft === null ? null : "2026-11-26",
  daysLeft,
  status,
});
const listingRow = (over: Record<string, unknown> = {}) => ({
  id: ID(1),
  ref: "L-0001",
  title: "2-bed apartment, Marina Vista",
  community: "Dubai Marina",
  sellerKind: "Individual",
  askingPriceFils: 185_000_000,
  state: "PUBLISHED",
  stateLabel: "Published",
  permit: permit("valid", 40),
  page: { state: "live", label: "Live" },
  offer: null,
  ...over,
});
const project = (over: Record<string, unknown> = {}) => ({
  id: ID(9),
  code: "MV-01",
  name: "Marina Vista [PROJECT]",
  emirate: "dubai",
  anticipatedCompletionOn: "2028-06-30",
  templateKind: "spa",
  template: { name: "Primary SPA", version: 2 },
  escrow: { bankName: "[BANK]", accountMasked: "•••• 3456" },
  buildings: [{ id: ID(20), code: "A", name: "Tower A", units: 2 }],
  units: [
    {
      id: ID(30),
      code: "U-101",
      buildingId: ID(20),
      state: "HELD",
      stateLabel: "Held",
      listPriceFils: 150_000_000,
      deal: { id: ID(40), ref: "D-0001", stage: "OFFER_AGREED", stageLabel: "Offer accepted", open: true },
    },
    {
      id: ID(31),
      code: "U-102",
      buildingId: ID(20),
      state: "AVAILABLE",
      stateLabel: "Available",
      listPriceFils: null,
      deal: null,
    },
  ],
  priceLists: [
    { id: ID(51), version: 2, status: "draft", publishedAt: null, prices: 2, inUse: false },
    { id: ID(50), version: 1, status: "published", publishedAt: "2026-11-01T06:00:00.000Z", prices: 2, inUse: true },
  ],
  ...over,
});

describe("C32: the project table and record (design §4.6)", () => {
  const list = ProjectsList.parse({
    unplacedUnits: 3,
    items: [
      {
        id: ID(9),
        code: "MV-01",
        name: "Marina Vista [PROJECT]",
        emirate: "dubai",
        anticipatedCompletionOn: "2028-06-30",
        buildings: 2,
        units: 9,
        byState: { AVAILABLE: 6, HELD: 2, SOLD: 1, REGISTERED: 0, HANDED_OVER: 0 },
        priceListVersion: 2,
      },
    ],
  });

  test("the table: the name links to the project, buildings, units by state, price list in use, completion", () => {
    const html = render(<ProjectTable projects={list.items} unplaced={list.unplacedUnits} />);
    expect(html).toContain(`href="/inventory/projects/${ID(9)}"`);
    for (const s of ["MV-01", "Marina Vista", "Version 2", "30 Jun 2028", "6 available", "2 held"])
      expect(html).toContain(s);
    expect(html).toContain("3 units are not in a project yet");
  });

  test("no price list in use says so; no projects is an empty state that says how to add one", () => {
    const html = render(<ProjectTable projects={[{ ...list.items[0]!, priceListVersion: null }]} unplaced={0} />);
    expect(html).toContain("No price list published");
    expect(html).not.toContain("not in a project");
    expect(render(<ProjectTable projects={[]} unplaced={0} />)).toContain("No projects yet.");
  });

  test("the record: overview, photos, buildings, the units slot, price lists by version, template, handover, activity", () => {
    const p = ProjectRecord.parse(
      project({
        community: "Marina Bay",
        location: "Waterfront district",
        description: "A fictional waterfront project.",
        activity: [
          {
            id: ID(70),
            label: "Details changed",
            at: "2026-11-20T06:00:00.000Z",
            actor: "Admin",
            changed: ["community"],
          },
        ],
      }),
    );
    const html = render(<ProjectView project={p} viewer="sales_officer" units={UNITS} />);
    for (const s of [
      "Tower A",
      "Marina Bay",
      "Waterfront district",
      "A fictional waterfront project.",
      "units slot",
      "No photo yet",
      "Details changed",
      "community",
      "Version 2",
      "Version 1",
      "Draft",
      "In use",
      "Primary SPA",
      "30 Jun 2028",
    ])
      expect(html).toContain(s);
    // sections in record order: overview, photos, buildings, units, price lists, activity
    const at = (id: string) => html.indexOf(`id="${id}"`);
    expect([at("facts"), at("photos"), at("buildings"), at("units"), at("price-lists"), at("activity")]).toEqual(
      [at("facts"), at("photos"), at("buildings"), at("units"), at("price-lists"), at("activity")].sort(
        (a, b) => a - b,
      ),
    );
    expect(at("facts")).toBeGreaterThan(-1);
    expect(html).not.toMatch(/\b(AVAILABLE|apartment)\b/);
  });

  test("the escrow account is masked on screen: last four only, no full number, no holder", () => {
    const html = render(<ProjectView project={ProjectRecord.parse(project())} viewer="sales_officer" units={UNITS} />);
    expect(html).toContain("•••• 3456");
    expect(html).not.toMatch(/AE\d{2}/);
    expect(html).not.toContain("0331234567890");
    expect(
      render(<ProjectView project={ProjectRecord.parse(project({ escrow: null }))} viewer="admin" units={UNITS} />),
    ).toContain("No escrow account");
  });

  test("read-only for every role but admin: no form, no input, no button", () => {
    for (const role of [
      "sales_officer",
      "sales_manager",
      "sales_admin",
      "legal",
      "finance",
      "compliance_officer",
      "mlro",
    ] as const) {
      const html = render(
        <ProjectView project={ProjectRecord.parse(project())} viewer={role} units={UNITS} actions={ACTIONS} />,
      );
      expect(noToggles(html), role).not.toMatch(/<(form|button|input|select|textarea)\b/);
    }
  });

  test("an admin gets the add forms: building, unit, a new price list with a price per unit, publish on a draft only", () => {
    const html = render(
      <ProjectView project={ProjectRecord.parse(project())} viewer="admin" units={UNITS} actions={ACTIONS} />,
    );
    expect(html).toContain("Add a building");
    expect(html).toContain("Quick add");
    expect(html).toContain(`href="/inventory/units/new?project=${ID(9)}"`);
    expect(html).toContain("New price list");
    expect(html).toContain(`name="price_${ID(30)}"`);
    expect(html).toContain(`name="price_${ID(31)}"`);
    // publish only for the draft (version 2), never for the published one
    expect(html.match(/Publish version/g)?.length).toBe(1);
    expect(html).toContain("Publish version 2");
    expect(html).toContain('name="id"');
  });

  test("an admin form sends the project id it came from and nothing about who or which role", () => {
    const html = render(
      <ProjectView project={ProjectRecord.parse(project())} viewer="admin" units={UNITS} actions={ACTIONS} />,
    );
    expect(html).toContain(`name="projectId" value="${ID(9)}"`);
    expect(html).not.toMatch(/name="(role|actor|user|userId|createdBy)"/);
  });

  test("no AML word and no leasing word on the page", () => {
    const html = render(
      <ProjectView project={ProjectRecord.parse(project())} viewer="admin" units={UNITS} actions={ACTIONS} />,
    );
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
});

describe("C32: the listings table and record (design §4.7)", () => {
  const rows = ListingsPage.parse({
    nextCursor: null,
    items: [
      listingRow(),
      listingRow({
        id: ID(2),
        ref: "L-0002",
        permit: permit("expiring", 5),
        offer: { state: "SENT", label: "Open", validUntil: "2026-11-25" },
        sellerKind: "Co-owners",
      }),
      listingRow({
        id: ID(3),
        ref: "L-0003",
        permit: permit("expired", -2),
        page: { state: "hidden", label: "Hidden: permit not valid" },
      }),
      listingRow({
        id: ID(4),
        ref: "L-0004",
        permit: permit("none", null),
        state: "DRAFT",
        stateLabel: "Draft",
        page: { state: "off", label: "Not published" },
      }),
    ],
  });

  test("the columns of design §4.7 and one row per listing, each ref linking to the record", () => {
    const html = render(<ListingTable listings={rows.items} next={null} />);
    for (const c of ["Ref", "Property", "Seller", "Asking", "State", "Permit", "Page", "Offer"])
      expect(html).toContain(`>${c}<`);
    for (const r of ["L-0001", "L-0002", "L-0003", "L-0004"]) expect(html).toContain(r);
    expect(html).toContain(`href="/listings/${ID(2)}"`);
    expect(html).toContain("AED 1,850,000");
    expect(html).toContain("Co-owners");
  });

  test("the permit column: valid-to date, a warning at seven days or fewer, expired, none", () => {
    const html = render(<ListingTable listings={rows.items} next={null} />);
    expect(html).toContain("Valid to 26 Nov 2026");
    expect(html).toContain("Expires in 5 days");
    expect(html).toContain("Expired 2 days ago");
    expect(html).toContain("No permit");
    expect(
      render(
        <ListingTable
          listings={[
            ListingsPage.parse({ nextCursor: null, items: [listingRow({ permit: permit("expiring", 0) })] }).items[0]!,
          ]}
          next={null}
        />,
      ),
    ).toContain("Expires today");
    expect(
      render(
        <ListingTable
          listings={[
            ListingsPage.parse({ nextCursor: null, items: [listingRow({ permit: permit("expiring", 1) })] }).items[0]!,
          ]}
          next={null}
        />,
      ),
    ).toContain("Expires in 1 day");
  });

  test("page and offer columns", () => {
    const html = render(<ListingTable listings={rows.items} next={null} />);
    expect(html).toContain("Live");
    expect(html).toContain("Hidden: permit not valid");
    expect(html).toContain("Not published");
    expect(html).toContain("Open");
    expect(html).toContain("until 25 Nov 2026");
  });

  test("empty and next page", () => {
    expect(render(<ListingTable listings={[]} next={null} />)).toContain("No listings");
    expect(render(<ListingTable listings={rows.items} next={{ href: "/listings?cursor=abc" }} />)).toContain(
      "Next page",
    );
  });

  const record = (over: Record<string, unknown> = {}) =>
    ListingRecord.parse({
      id: ID(1),
      ref: "L-0001",
      title: "2-bed apartment, Marina Vista",
      community: "Dubai Marina",
      description: "Bright corner unit.",
      bedrooms: 2,
      sizeSqft: 1180,
      askingPriceFils: 185_000_000,
      state: "PUBLISHED",
      stateLabel: "Published",
      agent: "Rania Officer",
      sellerKind: "Co-owners",
      sellers: [
        { name: "Sample Owner One", kind: "person", shareBps: 5000, signed: true },
        { name: "Sample Owner Two", kind: "person", shareBps: 5000, signed: false },
      ],
      ownership: {
        kind: "title_deed",
        matched: true,
        ref: "TD-SAMPLE-1",
        owners: ["Sample Owner One", "Sample Owner Two"],
      },
      documents: [],
      permit: permit("expiring", 5),
      page: { state: "live", label: "Live" },
      offer: {
        state: "SENT",
        label: "Open",
        priceFils: 180_000_000,
        validUntil: "2026-11-25",
        createdAt: "2026-11-18T06:00:00.000Z",
      },
      ...over,
    });

  test("the record shows sellers, with their share and whether they signed, to the sales roles", () => {
    for (const role of ["sales_officer", "sales_manager", "sales_admin"] as const) {
      const html = render(<ListingView listing={record()} viewer={role} />);
      for (const s of [
        "Sample Owner One",
        "50%",
        "Signed",
        "Not signed yet",
        "Title deed",
        "Matched",
        "[PERMIT NO.]",
        "Expires in 5 days",
        "AED 1,800,000",
        "Sellers answer until",
        "25 Nov 2026",
        "Rania Officer",
      ])
        expect(html, role).toContain(s);
    }
  });

  test("the record for admin has no sellers and says why; there is no form on it for anyone", () => {
    const html = render(<ListingView listing={record({ sellers: null, documents: null })} viewer="admin" />);
    expect(html).not.toContain("Sample Owner");
    expect(html).toContain("Sellers are shown to sales roles");
    expect(noToggles(html)).not.toMatch(/<(form|button|input)\b/);
  });

  test("no AML word on the record or the table", () => {
    expect(render(<ListingView listing={record()} viewer="sales_officer" />)).not.toMatch(COMPLIANCE_WORDS);
    expect(render(<ListingTable listings={rows.items} next={null} />)).not.toMatch(COMPLIANCE_WORDS);
  });
});

describe("C32: the Work tabs and Home links per company kind", () => {
  const search = parseWorkSearch({});
  const counts = { deals: 1, tasks: 1, inbox: 0 };
  test("Work shows a Listings tab and an Inventory tab only where the rail has the item", () => {
    const both = render(
      <WorkFilters search={search} counts={counts} catalogue={{ listings: true, inventory: true }} />,
    );
    expect(both).toContain('href="/listings"');
    expect(both).toContain('href="/inventory"');
    const dev = render(
      <WorkFilters search={search} counts={counts} catalogue={{ listings: false, inventory: true }} />,
    );
    expect(dev).toContain('href="/inventory"');
    expect(dev).not.toContain('href="/listings"');
    const brk = render(
      <WorkFilters search={search} counts={counts} catalogue={{ listings: true, inventory: false }} />,
    );
    expect(brk).toContain('href="/listings"');
    expect(brk).not.toContain('href="/inventory"');
    const none = render(<WorkFilters search={search} counts={counts} />);
    expect(none).not.toContain('href="/listings"');
    expect(none).not.toContain('href="/inventory"');
  });

  const summary = { deals: { open: 0, mine: 0, byStage: {} }, tasks: { open: 0 }, inbox: { open: 0 } } as never;
  test("Home links to the screens the role has", () => {
    const html = render(
      <HomeView summary={summary} tasks={[]} gates={[]} catalogue={{ listings: true, inventory: false }} />,
    );
    expect(html).toContain('href="/listings"');
    expect(html).not.toContain('href="/inventory"');
    expect(render(<HomeView summary={summary} tasks={[]} gates={[]} />)).not.toContain('href="/listings"');
  });
});

describe("C32: money typed in dirhams becomes whole fils, by integer arithmetic", () => {
  test("accepts digits with commas and up to two decimals; everything else is null", () => {
    expect(parseAedToFils("1,500,000")).toBe(150_000_000);
    expect(parseAedToFils("1500000.5")).toBe(150_000_050);
    expect(parseAedToFils("0.07")).toBe(7);
    expect(parseAedToFils(" 2 000 000 ")).toBe(200_000_000);
    expect(parseAedToFils("19.99")).toBe(1999);
    for (const bad of ["", "abc", "-5", "0", "0.00", "1.234", "1e6", "AED 5", "1,5,5x", "99999999999999999"])
      expect(parseAedToFils(bad), bad).toBeNull();
  });
});

describe("C32: what each form sends", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  test("a project: code, name, completion date and template kind only; a stuffed role or actor is never read", () => {
    const r = projectRequest(
      form({
        code: " MV-02 ",
        name: "Marina Two",
        anticipatedCompletionOn: "2029-01-31",
        templateKind: "spa",
        role: "admin",
        actor: "user:x",
        developerCompanyId: "x",
      }),
    )!;
    expect(r.path).toBe("/api/projects");
    expect(r.body).toEqual({
      code: "MV-02",
      name: "Marina Two",
      anticipatedCompletionOn: "2029-01-31",
      templateKind: "spa",
    });
    expect(projectRequest(form({ code: "", name: "x" }))).toBeNull();
    expect(projectRequest(form({ code: "A", name: "x", templateKind: "bogus" }))).toBeNull();
    expect(projectRequest(form({ code: "A", name: "x", anticipatedCompletionOn: "" }))!.body).toEqual({
      code: "A",
      name: "x",
    });
  });
  test("a building and a unit go to their project's own route", () => {
    expect(buildingRequest(form({ projectId: ID(9), code: "B", name: "Tower B" }))).toEqual({
      path: `/api/projects/${ID(9)}/buildings`,
      body: { code: "B", name: "Tower B" },
    });
    expect(unitRequest(form({ projectId: ID(9), buildingId: ID(20), code: "U-9" }))).toEqual({
      path: `/api/projects/${ID(9)}/units`,
      body: { buildingId: ID(20), code: "U-9" },
    });
    expect(buildingRequest(form({ projectId: "not-an-id", code: "B", name: "x" }))).toBeNull();
    expect(unitRequest(form({ projectId: ID(9), buildingId: "nope", code: "U" }))).toBeNull();
  });
  test("a price list sends one price per filled unit, in whole fils; an empty or bad price refuses the form", () => {
    const r = priceListRequest(
      form({ projectId: ID(9), [`price_${ID(30)}`]: "1,500,000", [`price_${ID(31)}`]: "", unitId: ID(31) }),
    )!;
    expect(r.path).toBe(`/api/projects/${ID(9)}/price-lists`);
    expect(r.body).toEqual({ items: [{ unitId: ID(30), priceFils: 150_000_000 }] });
    expect(priceListRequest(form({ projectId: ID(9), [`price_${ID(30)}`]: "" }))).toBeNull();
    expect(priceListRequest(form({ projectId: ID(9), [`price_${ID(30)}`]: "12x" }))).toBeNull();
  });
  test("publish goes to the list's own route", () => {
    expect(publishRequest(form({ id: ID(51) }))).toEqual({ path: `/api/price-lists/${ID(51)}/publish`, body: {} });
    expect(publishRequest(form({ id: "nope" }))).toBeNull();
  });
  test("the answer is read in fixed words: done, exists, invalid, refused, signin; engine text never passes through", async () => {
    const send = (status: number) => async () => ({
      status,
      json: async () => ({ id: ID(1), error: "AE070331234567890123456 is secret" }),
    });
    const req = { path: "/api/projects", body: {} };
    expect(await postCatalogue(send(201), req)).toEqual({ result: "done", id: ID(1) });
    expect(await postCatalogue(send(409), req)).toEqual({ result: "exists" });
    expect(await postCatalogue(send(422), req)).toEqual({ result: "invalid" });
    expect(await postCatalogue(send(403), req)).toEqual({ result: "refused" });
    expect(await postCatalogue(send(500), req)).toEqual({ result: "refused" });
    expect(await postCatalogue(send(401), req)).toEqual({ result: "signin" });
    expect(
      await postCatalogue(async () => {
        throw new Error("down");
      }, req),
    ).toEqual({ result: "refused" });
  });
});
