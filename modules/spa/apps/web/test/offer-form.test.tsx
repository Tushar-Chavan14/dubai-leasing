import { describe, expect, test } from "bun:test";
import { MakeOfferInput } from "@spa/core";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ListingOffers } from "../components/listing-offers";
import { OfferForm } from "../components/offer-form";
import { OffersView } from "../lib/contracts";
import { noToggles } from "./no-toggles";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const ENUMS = /\b(SENT|ACCEPTED|REJECTED|EXPIRED|WITHDRAWN|UNDER_OFFER|ACTIVE|accept|reject)\b/;
const terms = { depositBps: 1000, validityDays: 3, validityMaxDays: 30 };
const listing = { id: ID(1), ref: "L-0001", title: "2-bed apartment", askingPriceFils: 200_000_000, offplan: false };
const offer = (over: Record<string, unknown> = {}) => ({
  id: ID(10),
  status: "SENT",
  statusLabel: "Waiting for the sellers",
  priceFils: 195_000_000,
  buyerMortgage: true,
  sellerMortgage: false,
  targetTransferOn: "2027-01-15",
  conditions: "Subject to finance",
  validUntil: "2026-11-22",
  createdAt: "2026-11-19T06:00:00.000Z",
  sellers: [
    { name: "Seller One", answer: "accept", answerLabel: "Accepted" },
    { name: "Seller Two", answer: null, answerLabel: "Waiting" },
  ],
  buyers: [{ name: "Alice Buyer", email: "alice@example.test", shareBps: null }],
  deal: null,
  deposit: null,
  canRecordDeposit: false,
  canWithdraw: true,
  ...over,
});
const view = (offers: unknown[]) => OffersView.parse({ offers, terms });
const panel = (offers: unknown[], canWrite = true, state = "UNDER_OFFER") =>
  render(<ListingOffers listingId={ID(1)} state={state} offers={view(offers)} canWrite={canWrite} />);

describe("M6: the Make an offer form (S81)", () => {
  const html = (over: Record<string, unknown> = {}) => render(<OfferForm listing={listing} terms={terms} {...over} />);

  test("it shows buyers, the offer, the deposit the policy sets and the mortgage; the price starts at the asking price", () => {
    const t = text(html());
    for (const s of ["Home", "Buyers", "Offer", "Mortgage", "Send offer", "L-0001"]) expect(t, s).toContain(s);
    expect(html()).toContain('value="2000000"');
    expect(t).toContain("10% of the price");
    expect(t).toContain("Set by company policy");
    // the deposit % is the policy's: there is no box to type one
    expect(html()).not.toMatch(/name="depositBps"|Deposit %/);
    expect(html()).toContain('value="3"');
    expect(t).toContain("1 to 30 days");
  });

  test("an off-plan resale also asks about the seller's mortgage and the plan; a ready one doesn't", () => {
    expect(text(html())).not.toContain("takes over the developer's payment plan");
    expect(text(html({ listing: { ...listing, offplan: true } }))).toContain("takes over the developer's payment plan");
  });

  test("a lead fills the buyer", () => {
    const out = html({ lead: { id: ID(5), name: "Sara Khan", email: "sara@example.test" } });
    expect(out).toContain('value="Sara Khan"');
    expect(out).toContain('value="sara@example.test"');
  });

  test("the offer's own schema holds buyers, price and validity days the form sends", () => {
    const ok = {
      listingId: ID(1),
      priceFils: 195_000_000,
      buyers: [{ kind: "person", fullNameEn: "A B", email: "a@example.test", nationality: "Testland" }],
    };
    expect(MakeOfferInput.safeParse(ok).success).toBe(true);
    for (const bad of [
      { ...ok, validDays: 0 },
      { ...ok, validDays: 31 },
      { ...ok, buyers: [] },
      { ...ok, priceFils: 0 },
      { ...ok, buyers: [{ ...ok.buyers[0], nationality: "" }] },
    ])
      expect(MakeOfferInput.safeParse(bad).success).toBe(false);
  });
});

describe("M6: the listing's offer panel (S81)", () => {
  test("it shows the offer, each seller's answer, and Withdraw behind a reason box", () => {
    const html = panel([offer()]);
    const t = text(html);
    expect(t).toContain("AED 1,950,000");
    expect(t).toContain("Waiting for the sellers");
    expect(t).toContain("Seller One");
    expect(t).toContain("Accepted");
    expect(t).toContain("Waiting");
    expect(t).toContain("Withdraw offer");
    // a negative action never shows its reason box up front
    expect(html).not.toContain("<textarea");
    expect(t).not.toContain("Why is the offer being withdrawn");
    expect(text(noToggles(html))).toContain("Alice Buyer");
  });

  test("history lists past offers; an accepted one links the deal and offers the deposit form", () => {
    const accepted = offer({
      id: ID(11),
      status: "ACCEPTED",
      statusLabel: "Accepted",
      deal: { id: ID(40), ref: "D-0009" },
      canRecordDeposit: true,
      canWithdraw: false,
      sellers: [{ name: "Seller One", answer: "accept", answerLabel: "Accepted" }],
    });
    const html = panel([
      accepted,
      offer({ id: ID(12), status: "WITHDRAWN", statusLabel: "Withdrawn", canWithdraw: false }),
    ]);
    expect(html).toContain(`href="/work/deals/${ID(40)}"`);
    expect(text(html)).toContain("D-0009");
    expect(text(html)).toContain("Record the deposit cheque");
    expect(text(html)).toContain("Past offers");
    expect(text(html)).toContain("Withdrawn");
    // the deposit amount is the engine's, once recorded
    const recorded = panel([
      offer({
        status: "ACCEPTED",
        statusLabel: "Accepted",
        deal: { id: ID(40), ref: "D-0009" },
        deposit: { amountFils: 19_500_000, bank: "Test Bank", chequeOn: "2026-11-25" },
        canWithdraw: false,
      }),
    ]);
    expect(text(recorded)).toContain("Deposit of AED 195,000 recorded");
    expect(text(recorded)).not.toContain("Record the deposit cheque");
  });

  test("Make an offer shows to a writer while the listing can take one, never otherwise", () => {
    expect(panel([], true, "ACTIVE")).toContain(`href="/listings/${ID(1)}/offer"`);
    expect(panel([], true, "PUBLISHED")).toContain("Make an offer");
    expect(panel([], true, "UNDER_OFFER")).not.toContain("/offer");
    expect(panel([], false, "ACTIVE")).not.toContain("Make an offer");
    expect(text(panel([], true, "ACTIVE"))).toContain("No offer yet.");
  });

  test("a role that only reads sees no action and no buyer contact details", () => {
    const html = panel(
      [
        offer({
          buyers: null,
          canWithdraw: false,
          sellers: [{ name: "A seller", answer: null, answerLabel: "Waiting" }],
        }),
      ],
      false,
    );
    const t = text(noToggles(html));
    expect(t).not.toContain("Withdraw");
    expect(t).not.toContain("Make an offer");
    expect(t).not.toContain("Buyers:");
    expect(html).not.toContain("@example.test");
    expect(noToggles(html)).not.toContain("<button");
  });

  test("no enum text in the HTML", () => {
    const html = panel([
      offer(),
      offer({ id: ID(13), status: "EXPIRED", statusLabel: "Expired", canWithdraw: false }),
      offer({ id: ID(14), status: "REJECTED", statusLabel: "Rejected", canWithdraw: false }),
    ]);
    expect(text(html)).not.toMatch(ENUMS);
  });
});
