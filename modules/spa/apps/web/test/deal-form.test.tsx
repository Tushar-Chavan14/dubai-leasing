import { describe, expect, test } from "bun:test";
import { PageTitle } from "@platform/ui/page";
import { renderToStaticMarkup as render } from "react-dom/server";
import { DealForm } from "../components/deal-form";
import { DealUnavailable } from "../components/deal-unavailable";
import { UnitView } from "../components/unit-view";
import { parseAedToFils } from "../lib/catalogue";
import { DealQuote, UnitRecord } from "../lib/contracts";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const quote = (over: Record<string, unknown> = {}) =>
  DealQuote.parse({
    listPriceFils: 150_000_000,
    priceFils: 150_000_000,
    discountBps: 0,
    maxDiscountBps: 500,
    withinPolicy: true,
    bookingMinBps: 1000,
    bookingMinFils: 15_000_000,
    bookingFils: null,
    bookingOk: true,
    dldFeeFils: 6_000_000,
    dldFeePayer: "buyer",
    commission: { buyerSideBps: 200, sellerSideBps: 200 },
    reasons: [],
    ...over,
  });
const unitProp = { id: ID(1), code: "U-104", title: "Marina Vista, Tower A" };
const form = (over: Record<string, unknown> = {}) => render(<DealForm unit={unitProp} quote={quote()} {...over} />);

describe("M6: the New deal form (S81)", () => {
  test("every section is there, with the breadcrumbs Inventory, the unit, Start deal", () => {
    const t = text(form());
    for (const s of ["Home", "Buyers", "Price and booking", "Payment plan", "Broker (optional)", "Mortgage"])
      expect(t, s).toContain(s);
    expect(t).toContain("U-104");
    expect(t).toContain("Marina Vista, Tower A");
    const crumbs = text(
      render(
        <PageTitle
          back={[
            { href: "/inventory", label: "Inventory" },
            { href: `/inventory/units/${ID(1)}`, label: "U-104" },
          ]}
          title="Start deal"
        />,
      ),
    );
    expect(crumbs).toMatch(/Inventory\s+U-104\s+Start deal/);
  });

  test("a lead fills the first buyer's name and email", () => {
    const html = form({ lead: { id: ID(5), name: "Sara Khan", email: "sara@example.test" } });
    expect(html).toContain('value="Sara Khan"');
    expect(html).toContain('value="sara@example.test"');
  });

  test("the quote shows the engine's figures, with no client arithmetic beyond formatting", () => {
    const t = text(
      form({
        quote: quote({
          priceFils: 130_000_000,
          discountBps: 1333,
          withinPolicy: false,
          reasons: ["The discount is above the allowed 5%."],
          bookingMinFils: 13_000_000,
          dldFeeFils: 5_200_000,
          dldFeePayer: "split",
        }),
      }),
    );
    expect(t).toContain("13.33%");
    expect(t).toContain("AED 130,000 (10%)");
    expect(t).toContain("AED 52,000.");
    expect(t).toContain("Split between buyer and seller");
    expect(t).toContain("A sales manager must approve this price");
    expect(t).toContain("The discount is above the allowed 5%.");
  });

  test("inside the limits there is no warning; an unconfirmed fee says so", () => {
    expect(text(form())).not.toContain("must approve");
    expect(text(form({ quote: quote({ dldFeeFils: null }) }))).toContain("Not confirmed yet");
    const below = text(
      form({ quote: quote({ bookingOk: false, reasons: ["The booking is below the minimum of 10% of the price."] }) }),
    );
    expect(below).toContain("must approve");
    expect(below).toContain("below the minimum");
  });

  test("the plan total error shows until the shares add up to 100%", () => {
    expect(text(form())).toContain("The plan adds up to 100%.");
    const bad = text(
      form({
        plan: [
          { label: "Booking", share: "10", dueOn: "", milestone: "On booking" },
          { label: "Handover", share: "80", dueOn: "", milestone: "On handover" },
        ],
      }),
    );
    expect(bad).toContain("The plan adds up to 90%. It must be 100%.");
    expect(form({ plan: [{ label: "All", share: "100", dueOn: "", milestone: "On handover" }] })).not.toContain(
      "It must be 100%",
    );
  });

  test("the price box takes dirhams: AED 1,234,567.89 is exactly 123,456,789 fils; zero and negative are refused", () => {
    expect(parseAedToFils("1,234,567.89")).toBe(123_456_789);
    expect(parseAedToFils("0")).toBeNull();
    expect(parseAedToFils("-5")).toBeNull();
    expect(parseAedToFils("1.234")).toBeNull();
  });

  test("no enum or gate name reaches the page; the broker's commission placeholder is the policy's", () => {
    const html = form();
    expect(html).not.toMatch(/price_out_of_range|primary_offplan|OFFER_AGREED|HELD/);
    expect(text(html)).toContain("Start deal");
  });

  test("a home that is no longer available says so instead of showing a form", () => {
    const t = text(render(<DealUnavailable code="U-104" />));
    expect(t).toContain("This home is no longer available");
    expect(t).not.toContain("Agreed price");
    expect(text(render(<DealUnavailable />))).toContain("This home is no longer available");
  });

  test("Start deal on the unit page: a sales role on an available unit only", () => {
    const unit = (state: string) =>
      UnitRecord.parse({
        id: ID(1),
        code: "U-104",
        state,
        type: null,
        bedrooms: null,
        bathrooms: null,
        internalSqft: null,
        balconySqft: null,
        floor: null,
        view: null,
        parkingSpaces: null,
        description: null,
        project: null,
        building: null,
        media: [],
        priceHistory: [],
        currentPriceFils: null,
        openDeal: null,
        pastDeals: [],
        activity: [],
      });
    expect(render(<UnitView unit={unit("AVAILABLE")} canWork admin={false} canStartDeal />)).toContain(
      `href="/deals/new?unit=${ID(1)}"`,
    );
    for (const html of [
      render(<UnitView unit={unit("AVAILABLE")} canWork admin={false} />),
      render(<UnitView unit={unit("HELD")} canWork admin={false} canStartDeal />),
    ])
      expect(html).not.toContain("/deals/new");
  });
});
