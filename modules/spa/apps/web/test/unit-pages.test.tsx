import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { UnitForm } from "../components/unit-form";
import { UnitView } from "../components/unit-view";
import { UnitRecord } from "../lib/contracts";
import { COMPLIANCE_WORDS } from "./fixtures";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const unit = (over: Record<string, unknown> = {}) =>
  UnitRecord.parse({
    id: ID(1),
    code: "U-104",
    state: "HELD",
    type: "penthouse",
    bedrooms: 2,
    bathrooms: 2,
    internalSqft: 1180,
    balconySqft: 140,
    floor: 10,
    view: "Marina",
    parkingSpaces: 2,
    description: "A fictional corner unit.",
    project: { id: ID(9), code: "MV-01", name: "Marina Vista", community: "Marina Bay" },
    building: { id: ID(20), code: "A", name: "Tower A" },
    media: [],
    priceHistory: [
      { version: 1, publishedAt: "2026-11-01T06:00:00.000Z", priceFils: 140_000_000 },
      { version: 2, publishedAt: "2026-11-15T06:00:00.000Z", priceFils: 144_200_000 },
    ],
    currentPriceFils: 144_200_000,
    openDeal: { id: ID(40), ref: "D-0004", state: "OFFER_AGREED", stageLabel: "Offer accepted" },
    pastDeals: [{ id: ID(41), ref: "D-0002", state: "CANCELLED" }],
    activity: [
      { id: ID(70), label: "Details changed", at: "2026-11-20T06:00:00.000Z", actor: "Admin", changed: ["view"] },
    ],
    ...over,
  });

describe("S75: the unit page", () => {
  test("a unit without photos shows the placeholder tile, not a broken image", () => {
    const html = render(<UnitView unit={unit()} canWork admin />);
    expect(text(html)).toContain("No photos yet");
    expect(html).not.toContain("<img");
  });

  test("the header has the unit's stage stepper like leasing's", () => {
    const t = text(render(<UnitView unit={unit()} canWork admin />));
    for (const s of ["Available", "Held", "Sold", "Registered", "Handed over"]) expect(t, s).toContain(s);
    expect(render(<UnitView unit={unit()} canWork admin />)).toContain("Unit stage: Held");
  });

  test("the price and project cards sit in the side column beside the sections, as on leasing's unit page", () => {
    const html = render(<UnitView unit={unit()} canWork admin />);
    expect(html).toContain("@[880px]:grid-cols-[minmax(0,1fr)_320px]");
    expect(html).toContain("<aside");
    const aside = html.slice(html.indexOf("<aside"));
    expect(aside).toContain("Price in use");
    expect(aside).toContain("Project");
    expect(html.indexOf('id="activity-h"')).toBeLessThan(html.indexOf("<aside"));
  });

  test("photos come from the media route", () => {
    const html = render(
      <UnitView unit={unit({ media: [{ id: ID(60), caption: "Living room", sort: 0 }] })} canWork admin />,
    );
    expect(html).toContain(`src="/media/${ID(60)}"`);
    expect(html).toContain("Living room");
  });

  test("the price history lists versions oldest first and the price in use is the newest", () => {
    const html = render(<UnitView unit={unit()} canWork admin />);
    const t = text(html);
    expect(t.indexOf("Version 1")).toBeGreaterThan(-1);
    expect(t.indexOf("Version 1")).toBeLessThan(t.indexOf("Version 2"));
    expect(t.indexOf("AED 1,400,000")).toBeLessThan(t.indexOf("AED 1,442,000"));
    expect(t).toContain("Price in use");
  });

  test("the open deal links to the deal, past deals are closed, and the sections read in record order", () => {
    const html = render(<UnitView unit={unit()} canWork admin />);
    expect(html).toContain(`href="/work/deals/${ID(40)}"`);
    expect(text(html)).toContain("D-0002");
    const at = (id: string) => html.indexOf(`id="${id}"`);
    const order = [at("overview-h"), at("price-h"), at("deals-h"), at("activity-h")];
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(order.every((i) => i > -1)).toBe(true);
    expect(html).toContain('aria-label="Breadcrumb"');
  });

  test("words, not codes: Held, Penthouse, 2 bedrooms; no HELD, penthouse or bare id in the text", () => {
    const t = text(render(<UnitView unit={unit()} canWork admin />));
    for (const s of ["Held", "Penthouse", "2 bedrooms", "1,180 sq ft", "Floor 10", "Marina", "Details changed"])
      expect(t, s).toContain(s);
    expect(t).not.toMatch(/\bHELD\b|\bpenthouse\b|OFFER_AGREED|[0-9a-f]{8}-[0-9a-f]{4}-/);
    expect(t).not.toMatch(COMPLIANCE_WORDS);
  });

  test("only an admin sees Edit unit", () => {
    expect(render(<UnitView unit={unit()} canWork admin />)).toContain(`href="/inventory/units/${ID(1)}/edit"`);
    const other = render(<UnitView unit={unit()} canWork admin={false} />);
    expect(other).not.toContain("Edit unit");
    expect(other).not.toContain("/edit");
  });

  test("a unit with nothing set says so instead of printing blanks or null", () => {
    const t = text(
      render(
        <UnitView
          unit={unit({
            type: null,
            bedrooms: null,
            bathrooms: null,
            internalSqft: null,
            balconySqft: null,
            floor: null,
            view: null,
            parkingSpaces: null,
            description: null,
            priceHistory: [],
            currentPriceFils: null,
            openDeal: null,
            pastDeals: [],
            activity: [],
          })}
          canWork
          admin
        />,
      ),
    );
    expect(t).toContain("Not set");
    expect(t).toContain("No price");
    expect(t).toContain("No deals on this unit yet.");
    expect(t).not.toMatch(/\bnull\b|undefined/);
  });
});

describe("S75: the unit form", () => {
  const projects = [{ id: ID(9), name: "Marina Vista", buildings: [{ id: ID(20), code: "A", name: "Tower A" }] }];

  test("edit pre-fills every value and fixes the project and building", () => {
    const html = render(<UnitForm mode="edit" unit={unit()} projects={[]} />);
    expect(html).toContain('value="U-104"');
    expect(html).toContain('value="Marina"');
    expect(html).toContain('value="1180"');
    expect(html).toContain("A fictional corner unit.");
    expect(html).toMatch(/<option value="penthouse" selected/);
    expect(html).toContain("A unit stays in the building it was placed in");
    expect(html).toContain("Save changes");
  });

  test("create offers the project's buildings and the types by their words", () => {
    const html = render(<UnitForm mode="create" projects={projects} projectId={ID(9)} />);
    expect(html).toContain("A · Tower A");
    expect(text(html)).toContain("Apartment");
    expect(text(html)).toContain("Create unit");
    expect(text(html)).not.toMatch(/\bapartment\b/);
  });

  test("the sections are Where, Layout and Description, with a field per column of S75", () => {
    const html = render(<UnitForm mode="create" projects={projects} />);
    for (const s of [
      "Where",
      "Layout",
      "Description",
      "Bedrooms",
      "Bathrooms",
      "Internal area",
      "Balcony",
      "Floor",
      "Parking",
      "View",
    ])
      expect(text(html), s).toContain(s);
  });
});
