import { describe, expect, test } from "bun:test";
import { PageTitle } from "@platform/ui/page";
import { ListingDraftInput, ListingEdit } from "@spa/core";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ListingForm } from "../components/listing-form";
import { ListingsBrowser } from "../components/listings-browser";
import { ListingView } from "../components/listings";
import { ListingRecord, ListingsPage } from "../lib/contracts";
import { LISTING_STATE_LABEL } from "../lib/words";
import { noToggles } from "./no-toggles";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");
const ENUMS =
  /\b(DRAFT|VERIFIED|PUBLISHED|WITHDRAWN|UNDER_OFFER|title_deed|oqood|listing_agreement|board_resolution)\b/;

const permit = (
  status: "none" | "valid" | "expiring" | "expired",
  daysLeft: number | null,
  expiresOn: string | null,
) => ({
  no: expiresOn ? "[PERMIT NO.]" : null,
  issuedOn: null,
  expiresOn,
  daysLeft,
  status,
});
const row = (over: Record<string, unknown> = {}) => ({
  id: ID(1),
  ref: "L-0001",
  title: "2-bed apartment, Demo Tower",
  community: "Demo Marina",
  bedrooms: 2,
  sizeSqft: 1180,
  unitType: "apartment",
  agent: "Rania Officer",
  coverMediaId: null,
  sellerKind: "Individual",
  askingPriceFils: 185_000_000,
  state: "PUBLISHED",
  stateLabel: "Published",
  permit: permit("expiring", 5, "2026-11-30"),
  page: { state: "live", label: "Live" },
  offer: { state: "SENT", label: "Open", validUntil: "2026-12-05" },
  ...over,
});
const page = (
  items: unknown[] = [
    row(),
    row({
      id: ID(2),
      ref: "L-0002",
      state: "DRAFT",
      stateLabel: "Draft",
      offer: null,
      permit: permit("none", null, null),
    }),
  ],
) =>
  ListingsPage.parse({
    items,
    nextCursor: null,
    facets: {
      communities: ["Demo Marina"],
      types: ["apartment"],
      beds: [2],
      agents: [{ id: ID(50), name: "Rania Officer" }],
      states: { DRAFT: 1, PUBLISHED: 1 },
    },
  });

describe("M3: the Listings browser (S77)", () => {
  const html = (canAdd = true) =>
    render(<ListingsBrowser page={page()} filters={{}} canAdd={canAdd} nextHref={null} />);

  test("status chips carry their counts, and the permit chip says when it ends", () => {
    const t = text(html());
    for (const s of ["All 2", "Draft 1", "Published 1", "Verified 0", "Under offer 0", "Withdrawn 0"])
      expect(t, s).toContain(s);
    expect(t).toContain("Permit ends 30 Nov");
    expect(t).toContain("No permit");
    expect(t).toContain("Offer open");
    expect(html()).toContain("text-warning");
  });

  test("an expired permit is a danger chip", () => {
    const out = render(
      <ListingsBrowser
        page={page([row({ permit: permit("expired", -2, "2026-11-23") })])}
        filters={{}}
        canAdd
        nextHref={null}
      />,
    );
    expect(text(out)).toContain("Permit ended 23 Nov");
    expect(out).toContain("text-danger");
  });

  test("New listing shows for a writer only", () => {
    expect(text(html(true))).toContain("New listing");
    expect(text(html(false))).not.toContain("New listing");
  });

  test("filters: community, type, bedrooms, agent and a price band; no enum text on the cards", () => {
    const out = html();
    for (const s of ["All communities", "All types", "Any bedrooms", "All agents", "Price band"])
      expect(text(out), s).toContain(s);
    expect(text(out)).not.toMatch(ENUMS);
    expect(out).toContain("/listings/");
  });

  test("an empty list says so, with the right next move", () => {
    const empty = render(<ListingsBrowser page={page([])} filters={{}} canAdd nextHref={null} />);
    expect(text(empty)).toContain("No listings yet");
    expect(
      text(render(<ListingsBrowser page={page([])} filters={{ type: "villa" }} canAdd nextHref={null} />)),
    ).toContain("No listings match");
  });

  test("every state has its words", () => {
    for (const k of ["DRAFT", "VERIFIED", "ACTIVE", "PUBLISHED", "UNDER_OFFER", "SOLD", "WITHDRAWN"] as const)
      expect(LISTING_STATE_LABEL[k]).toBeTruthy();
  });
});

describe("M3: the listing form (S77)", () => {
  const agents = [{ id: ID(50), name: "Rania Officer" }];

  test("a new listing form has every section and the Listings › New listing breadcrumbs", () => {
    const out = render(
      <>
        <PageTitle back={{ href: "/listings", label: "Listings" }} title="New listing" />
        <ListingForm mode="new" agents={agents} />
      </>,
    );
    const t = text(out);
    for (const s of [
      "Listings",
      "New listing",
      "Property",
      "Price",
      "Sellers",
      "Permit",
      "Agent",
      "Add a seller",
      "Person",
      "Company",
      "Create listing",
    ])
      expect(t, s).toContain(s);
    expect(out).toContain('aria-label="Breadcrumb"');
    expect(t).not.toMatch(ENUMS);
  });

  test("the schema the form uses asks for a seller and for shares that add up", () => {
    const base = { title: "T", community: "C", propertyDescription: "D", askingPriceFils: 100_000 };
    const none = ListingDraftInput.safeParse({ ...base, sellers: [] });
    expect(none.success ? [] : none.error.issues.map((i) => i.message)).toContain("Add at least one seller");
    const shares = ListingDraftInput.safeParse({
      ...base,
      sellers: [
        { kind: "person", fullNameEn: "A One", email: "a@example.test", shareBps: 6000 },
        { kind: "person", fullNameEn: "B Two", email: "b@example.test", shareBps: 3000 },
      ],
    });
    expect(shares.success ? [] : shares.error.issues.map((i) => i.message)).toContain("shares must add up to 100%");
    expect(ListingEdit.safeParse({ title: "New" }).success).toBe(true);
  });

  test("edit mode shows the sellers read only and says they can't change", () => {
    const l = ListingRecord.parse({
      ...record(),
      sellers: [{ partyId: ID(7), name: "Sample Owner One", kind: "person", shareBps: 10000, signed: true }],
    });
    const out = render(<ListingForm mode="edit" listing={l} agents={agents} />);
    const t = text(out);
    expect(t).toContain("Sellers can't change after the listing is created");
    expect(t).toContain("Sample Owner One");
    expect(t).not.toContain("Add a seller");
    expect(t).toContain("Save changes");
  });
});

const record = (over: Record<string, unknown> = {}) => ({
  id: ID(1),
  ref: "L-0001",
  title: "2-bed apartment, Demo Tower",
  community: "Demo Marina",
  description: "A fictional flat.",
  bedrooms: 2,
  sizeSqft: 1180,
  askingPriceFils: 185_000_000,
  state: "DRAFT",
  stateLabel: "Draft",
  agent: "Rania Officer",
  sellerKind: "Co-owners",
  sellers: [
    { partyId: ID(7), name: "Sample Owner One", kind: "person", shareBps: 5000, signed: false },
    { partyId: ID(8), name: "Sample Owner Two", kind: "person", shareBps: 5000, signed: true },
  ],
  ownership: null,
  permit: permit("valid", 90, "2027-02-23"),
  page: { state: "off", label: "Not published" },
  offer: null,
  documents: [],
  next: {
    event: "VERIFY",
    label: "Verify the listing",
    reasons: ["The listing agreement isn't signed.", "The ownership document isn't matched to the sellers."],
  },
  actions: ["WITHDRAW"],
  ...over,
});

describe("M3: the listing record (S77)", () => {
  const view = (over: Record<string, unknown> = {}, role: "sales_officer" | "admin" = "sales_officer") =>
    render(<ListingView listing={ListingRecord.parse(record(over))} viewer={role} />);

  test("a draft shows Verify the listing disabled, with both reasons and where to fix each", () => {
    const out = view();
    expect(text(out)).toContain("Verify the listing");
    expect(out).toMatch(/<button[^>]*disabled[^>]*>[^<]*Verify the listing/);
    expect(text(out)).toContain("The listing agreement isn't signed.");
    expect(text(out)).toContain("The ownership document isn't matched to the sellers.");
    expect(out).toContain('href="#listing-agreement"');
    expect(out).toContain('href="#ownership"');
  });

  test("the record reads Next step, Overview, Documents, Sellers, Photos, Offers and deals, Activity last", () => {
    const out = view();
    const at = ["Next step", "Overview", "Documents", "Sellers", "Photos", "Offers and deals", "Activity"].map((s) =>
      out.indexOf(`>${s}</h2>`),
    );
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].toSorted((a, b) => a - b)).toEqual(at);
    for (const sub of ["Ownership", "Listing agreement", "Permit"]) expect(out).toContain(`>${sub}</h2>`);
    expect(out).toContain("record-cards");
  });

  test("the stage stepper runs Draft to Sold; a withdrawn listing is a danger pill instead", () => {
    const t = text(view());
    for (const s of ["Draft", "Verified", "Active", "Published", "Under offer", "Sold"]) expect(t, s).toContain(s);
    const w = view({ state: "WITHDRAWN", stateLabel: "Withdrawn", next: null, actions: [] });
    expect(w).not.toContain("Listing stage:");
    expect(text(w)).toContain("Withdrawn");
  });

  test("a role that only reads sees no buttons, no sellers, no files", () => {
    const out = view(
      { sellers: null, documents: null, next: null, actions: [], ownership: { kind: "title_deed", matched: true } },
      "admin",
    );
    expect(noToggles(out)).not.toMatch(/<(form|button|input|textarea|select)\b/);
    expect(text(out)).not.toContain("Sample Owner");
    expect(out).not.toContain("/edit");
  });

  test("Withdraw is a button that doesn't show its reason box up front", () => {
    const out = view();
    expect(text(out)).toContain("Withdraw listing");
    expect(text(out)).not.toContain("Why is the listing being withdrawn?");
    expect(text(out)).not.toContain("Confirm withdrawal");
  });

  test("a published listing says the page is live, links to it and offers Unpublish", () => {
    const out = view({
      state: "PUBLISHED",
      stateLabel: "Published",
      next: null,
      actions: ["UNPUBLISH", "WITHDRAW"],
      page: { state: "live", label: "Live" },
    });
    expect(text(out)).toContain("The page is live");
    expect(out).toContain('href="/properties/L-0001"');
    expect(text(out)).toContain("Unpublish");
  });

  test("an unpublished-for-permit listing says why on the Next step card", () => {
    const out = view({
      state: "ACTIVE",
      stateLabel: "Active",
      next: { event: "PUBLISH", label: "Publish the page", reasons: ["The advertising permit has expired."] },
      lastUnpublish: { on: "2026-11-26", reason: "permit expired" },
    });
    expect(text(out)).toContain("Unpublished: permit expired");
    expect(text(out)).toContain("26 Nov 2026");
  });

  test("ownership shows the waiting state and the owners; documents and signatures carry words, not codes", () => {
    const out = view({
      ownership: {
        kind: "title_deed",
        matched: false,
        ref: "TD-1",
        owners: ["Different Name"],
        waitingForManager: true,
      },
      documents: [
        {
          id: ID(90),
          kind: "title_deed",
          kindLabel: "Title deed",
          fileName: "deed.pdf",
          uploadedAt: "2026-11-25T06:00:00.000Z",
        },
      ],
    });
    const t = text(out);
    for (const s of [
      "Waiting for the sales manager",
      "Different Name",
      "deed.pdf",
      "Signed",
      "Record signature",
      "Save the owners",
    ])
      expect(t, s).toContain(s);
    expect(t).not.toMatch(ENUMS);
    expect(out).toContain(`/listings/${ID(1)}/documents/${ID(90)}`);
  });

  test("no enum text anywhere on the record", () => {
    expect(text(view())).not.toMatch(ENUMS);
  });
});
