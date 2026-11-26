import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroPanel } from "../src/catalogue/hero-panel";
import { finderValues } from "../src/catalogue/finder-values";
import { type NavLink, isCurrent } from "../src/catalogue/nav-match";
import { PropertyCard } from "../src/catalogue/property-card";
import { StaffUnitCard } from "../src/catalogue/staff-unit-card";
import { PlanPlaceholder } from "../src/media/plan-placeholder";

const LINKS: NavLink[] = [
  { href: "/customer/properties", label: "Rent" },
  { href: "/customer/chat", label: "Chat" },
  { href: "/customer/chat?check=1", label: "Check", match: "query:check" },
];
const params = (q: string) => new URLSearchParams(q);

describe("PropertyCard", () => {
  test("renders the link, title, price and facts", () => {
    const html = renderToStaticMarkup(
      <PropertyCard
        href="/p/1"
        name="Marina"
        title="Marina Heights"
        subtitle="Dubai Marina, Dubai"
        price="AED 54,000"
        priceNote="/yr"
        facts={["2 bed", "2 bath"]}
        badge="New"
        footer={<span>Ask</span>}
      />,
    );
    expect(html).toContain('href="/p/1"');
    expect(html).toContain("Marina Heights");
    expect(html).toContain("AED 54,000");
    expect(html).toContain(" /yr");
    expect(html).toContain("2 bed · 2 bath");
    expect(html).toContain("New");
    expect(html).toContain("<span>Ask</span>");
    expect(html).toContain("No photo yet");
  });
  test("uses the photo when given a src", () => {
    const html = renderToStaticMarkup(
      <PropertyCard href="/p/1" name="M" src="/img/1" title="M" price="1" facts={[]} />,
    );
    expect(html).toContain('src="/img/1"');
  });
});

describe("isCurrent", () => {
  test("path link is current on its path and nested paths", () => {
    expect(isCurrent(LINKS[0]!, "/customer/properties", params(""), LINKS)).toBe(true);
    expect(isCurrent(LINKS[0]!, "/customer/properties/abc", params(""), LINKS)).toBe(true);
    expect(isCurrent(LINKS[0]!, "/customer/chat", params(""), LINKS)).toBe(false);
  });
  test("plain chat link yields to the query link when its key is present", () => {
    expect(isCurrent(LINKS[1]!, "/customer/chat", params(""), LINKS)).toBe(true);
    expect(isCurrent(LINKS[1]!, "/customer/chat", params("check=1"), LINKS)).toBe(false);
  });
  test("query link is current only when its key is present", () => {
    expect(isCurrent(LINKS[2]!, "/customer/chat", params(""), LINKS)).toBe(false);
    expect(isCurrent(LINKS[2]!, "/customer/chat", params("check=1"), LINKS)).toBe(true);
    expect(isCurrent(LINKS[2]!, "/customer/properties", params("check=1"), LINKS)).toBe(false);
  });
});

describe("finderValues", () => {
  test("reads fields and gives empty strings for missing ones", () => {
    const f = new FormData();
    f.set("area", "Marina");
    expect(finderValues(f, ["area", "beds"])).toEqual({ area: "Marina", beds: "" });
  });
});

describe("HeroPanel", () => {
  const labels = {
    headline: "H",
    count: "Open",
    one: "property",
    many: "properties",
    areas: "in {n} areas",
    from: "Rent from",
    per: "/yr",
  };
  test("pluralises and adds areas only above one", () => {
    expect(renderToStaticMarkup(<HeroPanel count={1} from="AED 1" areas={1} labels={labels} />)).toContain("property<");
    const html = renderToStaticMarkup(<HeroPanel count={3} from={undefined} areas={2} labels={labels} />);
    expect(html).toContain("properties in 2 areas");
    expect(html).toContain(">-<");
  });
});

describe("StaffUnitCard", () => {
  const card = (over: Partial<Parameters<typeof StaffUnitCard>[0]> = {}) =>
    renderToStaticMarkup(
      <StaffUnitCard
        href="/units/1"
        imageAlt="Unit U-1"
        placeholder={<PlanPlaceholder bedrooms={2} label="No photos yet" />}
        code="U-1"
        status={<span>Listed</span>}
        subtitle="Tower A, Marina"
        facts="2 bed · 1,000 sq ft"
        price={<b>AED 90,000</b>}
        {...over}
      />,
    );

  test("one link: code with the status on the same line, then subtitle, facts and price", () => {
    const html = card();
    expect(html.match(/<a /g)?.length).toBe(1);
    expect(html).toContain('href="/units/1"');
    expect(html).toMatch(/<b[^>]*>U-1<\/b><span>Listed<\/span>/);
    for (const s of ["Tower A, Marina", "2 bed · 1,000 sq ft", "AED 90,000", "No photos yet"])
      expect(html).toContain(s);
    expect(html).not.toContain("<img");
  });

  test("a photo replaces the placeholder; a photo count and a chip show only when given", () => {
    const html = card({ imageSrc: "/media/1", photoCount: 3, chip: <i>Lease L-1</i> });
    expect(html).toContain('src="/media/1"');
    expect(html).toContain("3 photos");
    expect(html).toContain("Lease L-1");
    expect(html).not.toContain("No photos yet");
    expect(card({ photoCount: 1 })).not.toContain("1 photos");
  });
});
