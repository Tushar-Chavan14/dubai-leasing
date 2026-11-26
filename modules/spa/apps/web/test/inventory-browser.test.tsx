import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { UnitsBrowser } from "../components/units-browser";
import { UnitsPage } from "../lib/contracts";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const row = (over: Record<string, unknown> = {}) => ({
  id: ID(1),
  code: "U-101",
  state: "AVAILABLE",
  type: "apartment",
  bedrooms: 0,
  internalSqft: 480,
  view: "Marina",
  floor: 3,
  project: { id: ID(9), name: "Marina Vista" },
  building: { id: ID(20), name: "Tower A" },
  priceFils: 125_000_000,
  coverMediaId: null,
  openDeal: null,
  ...over,
});
const page = (
  items: unknown[] = [
    row(),
    row({
      id: ID(2),
      code: "U-102",
      state: "HELD",
      bedrooms: 2,
      type: "villa",
      priceFils: null,
      openDeal: { id: ID(40), ref: "D-0007", state: "OFFER_AGREED", stageLabel: "Offer accepted" },
    }),
  ],
) =>
  UnitsPage.parse({
    items,
    next: null,
    facets: {
      projects: [{ id: ID(9), name: "Marina Vista" }],
      types: ["apartment", "villa"],
      beds: [0, 2],
      states: { AVAILABLE: 1, HELD: 1 },
    },
  });

describe("S75: the Units browser of Inventory", () => {
  test("words, not codes: Studio, Apartment and Available; no AVAILABLE, apartment or id in the text", () => {
    const html = render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />);
    const t = text(html);
    for (const s of ["Studio", "Apartment", "Available", "Held", "Villa", "Marina Vista", "Tower A", "480 sq ft"])
      expect(t, s).toContain(s);
    expect(t).not.toMatch(/AVAILABLE|HELD|\bapartment\b|\bvilla\b/);
    expect(t).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/);
  });

  test("the price is in dirhams; a unit with no price says so", () => {
    const t = text(render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />));
    expect(t).toContain("AED 1,250,000");
    expect(t).toContain("No price");
  });

  test("a unit with an open deal shows a chip with its ref and the stage in words, like leasing's lease chip", () => {
    const t = text(render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />));
    expect(t).toContain("Deal D-0007 · Offer accepted");
    expect(t).not.toContain("OFFER_AGREED");
  });

  test("the card reads like leasing's: code with the status pill, project and building, facts, price on its own line", () => {
    const html = render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />);
    expect(html).toMatch(/<b[^>]*>U-101<\/b><span[^>]*>Available<\/span>/);
    expect(html).toContain("Marina Vista, Tower A");
    expect(html).toContain("No photos yet");
    // the state is not drawn on the photo
    expect(html).not.toMatch(/absolute top-3 left-3/);
  });

  test("status chips with counts replace the status dropdown", () => {
    const html = render(
      <UnitsBrowser page={page()} filters={{ state: "HELD" }} canWork canAdd={false} nextHref={null} />,
    );
    const t = text(html);
    for (const s of ["All 2", "Available 1", "Held 1", "Sold 0", "Registered 0", "Handed over 0"])
      expect(t, s).toContain(s);
    expect(html).toMatch(/aria-checked="true"[^>]*>Held 1</);
    expect(html).not.toContain("Any status");
    expect(html).toContain("More filters");
  });

  test("only an admin gets New unit", () => {
    expect(text(render(<UnitsBrowser page={page()} filters={{}} canWork canAdd nextHref={null} />))).toContain(
      "New unit",
    );
    expect(
      text(render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />)),
    ).not.toContain("New unit");
  });

  test("cards link to the unit page and a photo comes through the media route", () => {
    const html = render(
      <UnitsBrowser page={page([row({ coverMediaId: ID(60) })])} filters={{}} canWork canAdd={false} nextHref={null} />,
    );
    expect(html).toContain(`href="/inventory/units/${ID(1)}"`);
    expect(html).toContain(`src="/media/${ID(60)}"`);
    expect(html).not.toContain("data/spa-media");
  });

  test("the filter bar offers what exists, keeps the chosen values and can be cleared", () => {
    const html = render(
      <UnitsBrowser
        page={page()}
        filters={{ type: "villa", beds: "2", q: "10" }}
        canWork
        canAdd={false}
        nextHref={null}
      />,
    );
    expect(html).toContain("All projects");
    expect(text(html)).toContain("2 bed");
    expect(html).toMatch(/<option value="villa" selected/);
    expect(html).toContain("Clear filters");
    expect(html).toContain('method="get"');
  });

  test("empty states: no units, and no match for the filters", () => {
    expect(
      text(render(<UnitsBrowser page={page([])} filters={{}} canWork canAdd={false} nextHref={null} />)),
    ).toContain("No units yet");
    expect(
      text(render(<UnitsBrowser page={page([])} filters={{ type: "villa" }} canWork canAdd={false} nextHref={null} />)),
    ).toContain("No units match");
  });

  test("on a project page the project filter is gone and the form stays on that page", () => {
    const html = render(
      <UnitsBrowser
        page={page()}
        filters={{}}
        canWork
        canAdd
        nextHref={null}
        scope={{ projectId: ID(9), action: `/inventory/projects/${ID(9)}#units` }}
      />,
    );
    expect(html).not.toContain("All projects");
    expect(html).toContain(`action="/inventory/projects/${ID(9)}#units"`);
    expect(html).toContain(`href="/inventory/units/new?project=${ID(9)}"`);
  });

  test("a next page link is drawn only when there is one", () => {
    expect(
      render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref="/inventory?cursor=abc" />),
    ).toContain('href="/inventory?cursor=abc"');
    expect(
      text(render(<UnitsBrowser page={page()} filters={{}} canWork canAdd={false} nextHref={null} />)),
    ).not.toContain("Next page");
  });
});
