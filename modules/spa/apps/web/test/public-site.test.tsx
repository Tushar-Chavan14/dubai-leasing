import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/properties",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, refresh() {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
}));
mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
mock.module("../lib/env", () => ({
  engineUrl: () => "http://engine.test",
  sessionCookie: () => "spa_session",
  webEnv: () => ({}),
}));
mock.module("next/cache", () => ({ revalidatePath() {} }));
// The shared Finder and nav read the app router, which a static render has no copy of (the shared package resolves its
// own Next). These stand-ins keep the same labels, fields and links, so what the page passes them is still checked.
mock.module("@platform/ui/catalogue/finder", () => ({
  Finder: (p: {
    ariaLabel?: string;
    fields: { name: string; label: string; value: string; options: { value: string; label: string }[] }[];
    searchLabel: string;
    onSearch: (v: Record<string, string>) => string;
  }) => (
    <form
      aria-label={p.ariaLabel}
      data-search-href={p.onSearch({ community: "Dubai Marina", beds: "2", price: "2-5" })}
    >
      {p.fields.map((f) => (
        <label key={f.name}>
          {f.label}
          <select name={f.name} defaultValue={f.value}>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button type="submit">{p.searchLabel}</button>
    </form>
  ),
}));
mock.module("@platform/ui/catalogue/public-nav", () => ({
  PublicNav: (p: { links: { href: string; label: string }[] }) => (
    <nav aria-label="Main">
      {p.links.map((l) => (
        <a key={l.href} href={l.href}>
          {l.label}
        </a>
      ))}
    </nav>
  ),
}));

const { default: SiteLayout } = await import("../app/(site)/layout");
const { default: PublicLayout } = await import("../app/(public)/layout");
const { default: PropertiesPage } = await import("../app/(site)/properties/page");
const { default: PropertyPage, generateMetadata } = await import("../app/(site)/properties/[ref]/page");
const { CatalogueGrid } = await import("../components/public/catalogue-grid");
const { PropertyView } = await import("../components/public/property-view");
const lib = await import("../lib/public-filters");

const SECRETS = ["Hidden Seller Name", "Hidden Holdings LLC", "SECRET-DEED-1", "PUBLISHED", ">apartment<"];

const base = {
  ref: "L-0007",
  source: "listing" as const,
  title: "2-bed apartment, Marina Vista",
  community: "Dubai Marina",
  projectName: null,
  developerName: null,
  unitType: "apartment",
  unitTypeLabel: "Apartment",
  bedrooms: 2,
  bathrooms: 2,
  sizeSqft: 1200,
  priceFils: 175_000_000,
  permitNo: "123456",
  coverPhotoId: null,
  photoCount: 0,
  handover: null,
};
const unit = {
  ...base,
  ref: "U-MV-01-U-101",
  source: "developer" as const,
  title: "Studio apartment, Marina Vista",
  projectName: "Marina Vista",
  developerName: "Fictional Developments LLC",
  bedrooms: 0,
  priceFils: 140_000_000,
  permitNo: null,
  handover: "Mar 2028",
  coverPhotoId: "0198a1b2-0000-7000-8000-000000000001",
  photoCount: 1,
};
const detail = (p: typeof base, over: Record<string, unknown> = {}) => ({
  ...p,
  description: "Bright flat near the beach.",
  floor: 12,
  view: "Marina",
  parkingSpaces: 1,
  furnishedLabel: "Semi-furnished",
  photoIds: [],
  agent: { name: "Rania Agent" },
  chat: p.source === "listing",
  ...over,
});
const facets = { communities: ["Dubai Marina"], types: ["apartment"] };

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
const engine = (routes: Record<string, () => Response>) => {
  globalThis.fetch = (async (url: string | URL | Request) => {
    const u = String(url).replace("http://engine.test", "");
    const hit = Object.entries(routes).find(([k]) => u === k || u.startsWith(`${k}?`));
    if (!hit) return new Response("{}", { status: 404 });
    return hit[1]();
  }) as typeof fetch;
};
const json =
  (b: unknown, status = 200) =>
  () =>
    new Response(JSON.stringify(b), { status });

describe("M4: the site layout", () => {
  test("brand Sales, nav, theme menu, browse button and footer; never Leasing", async () => {
    const html = render(await SiteLayout({ children: <p>page</p> }));
    expect(html).toContain("Sales");
    expect(html).toContain('aria-label="Main"');
    expect(html).toContain('href="/properties"');
    expect(html).toContain('aria-label="Theme"');
    expect(html).toContain("Browse homes");
    expect(html).toContain("Listings are shown with their advertising permit number.");
    expect(html).not.toMatch(/leasing/i);
  });
  test("the buyer pages keep the plain layout: no site header", () => {
    const html = render(<PublicLayout>{<p>buyer page</p>}</PublicLayout>);
    expect(html).toContain("buyer page");
    expect(html).not.toContain("<header");
    expect(html).not.toContain("Browse homes");
  });
});

describe("M4: filters in the address", () => {
  test("parse, drop what is unknown, and round-trip", () => {
    const f = lib.fromParams({
      source: "resale",
      beds: "9",
      price: "2-5",
      type: "castle",
      sort: "price_asc",
      community: " Dubai Marina ",
    });
    expect(f).toEqual({
      source: "resale",
      community: "Dubai Marina",
      type: null,
      beds: 4,
      price: "2-5",
      sort: "price_asc",
    });
    expect(lib.toQuery(f)).toBe("source=resale&community=Dubai+Marina&beds=4&price=2-5&sort=price_asc");
    expect(lib.toEngineQuery(f)).toContain("source=listing");
    expect(lib.toEngineQuery(f)).toContain("min=200000000");
    expect(lib.toEngineQuery(f)).toContain("max=500000000");
    expect(lib.toQuery(lib.fromParams({}))).toBe("");
  });
});

describe("M4: the catalogue page", () => {
  const grid = (o: Partial<Parameters<typeof CatalogueGrid>[0]> = {}) =>
    render(
      <CatalogueGrid
        options={[base, unit]}
        items={[base, unit]}
        communities={facets.communities}
        types={facets.types}
        loadFailed={false}
        filters={lib.NO_FILTERS}
        {...o}
      />,
    );
  test("cards for both sources; the permit line only on a listing; a developer chip only on a unit", () => {
    const html = grid();
    expect(html).toContain('href="/properties/L-0007"');
    expect(html).toContain('href="/properties/U-MV-01-U-101"');
    expect(html).toContain("AED 1,750,000");
    expect(html).toContain("Permit 123456");
    expect(html.match(/Permit /g)?.length).toBe(1);
    expect(html).toContain("New · Fictional Developments LLC");
    expect(html).toContain('src="/photos/0198a1b2-0000-7000-8000-000000000001"');
    expect(html).toContain("Dubai Marina");
    expect(html).toContain("Studio · Apartment");
    expect(html).toContain("2 homes");
  });
  test("chips reflect the address", () => {
    const html = grid({ filters: { ...lib.NO_FILTERS, source: "resale", sort: "price_asc" } });
    expect(html).toMatch(/aria-current="true"[^>]*>(<svg[^>]*>.*?<\/svg>)?Resale/);
    expect(html).toContain('href="/properties?source=developer&amp;sort=price_asc"');
    expect(html).toContain("Clear filters");
  });
  test("the finder offers the catalogue's own choices and builds a shareable address", () => {
    const html = grid({ filters: { ...lib.NO_FILTERS, source: "developer" } });
    expect(html).toContain("Community");
    expect(html).toContain('<option value="apartment">Apartment</option>');
    expect(html).toContain('<option value="0">Studio</option>');
    expect(html).toContain("AED 1M to 2M");
    // the chip choice survives a search
    expect(html).toContain(
      'data-search-href="/properties?source=developer&amp;community=Dubai+Marina&amp;beds=2&amp;price=2-5#homes"',
    );
  });
  test("no filter matches: leasing's empty state with a way back", () => {
    const html = grid({ items: [] });
    expect(html).toContain("No homes match these filters");
    expect(html).toContain("Clear filters");
  });
  test("nothing on the market, and the engine down", () => {
    expect(grid({ options: [], items: [] })).toContain("No homes are on the market right now");
    const down = grid({ options: [], items: [], loadFailed: true });
    expect(down).toContain("Homes couldn&#x27;t be loaded. Try again in a moment.");
    expect(down).toContain('role="alert"');
  });
  test("the page loads twice (choices, then the filtered list) and survives an engine that is down", async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (url: string | URL | Request) => {
      seen.push(String(url));
      return new Response(JSON.stringify({ items: [base], facets }), { status: 200 });
    }) as typeof fetch;
    const html = render(await PropertiesPage({ searchParams: Promise.resolve({ source: "resale", beds: "2" }) }));
    expect(seen).toEqual([
      "http://engine.test/public/catalogue",
      "http://engine.test/public/catalogue?source=listing&beds=2&sort=newest",
    ]);
    expect(html).toContain("Homes for sale in Dubai");
    globalThis.fetch = (async () => {
      throw new Error("refused");
    }) as typeof fetch;
    expect(render(await PropertiesPage({ searchParams: Promise.resolve({}) }))).toContain("couldn&#x27;t be loaded");
  });
  test("an answer with a field outside the allow-list is refused, not shown", async () => {
    engine({ "/public/catalogue": json({ items: [{ ...base, sellerName: "Hidden Seller Name" }], facets }) });
    const html = render(await PropertiesPage({ searchParams: Promise.resolve({}) }));
    expect(html).not.toContain("Hidden Seller Name");
    expect(html).toContain("couldn&#x27;t be loaded");
  });
  test("leak test and no raw enum words on the rendered page", () => {
    const html = grid() + render(<PropertyView p={detail(base)} />);
    for (const s of SECRETS) expect(html).not.toContain(s);
    expect(html).not.toMatch(/>(apartment|villa|AVAILABLE|HELD|SOLD)</);
  });
});

describe("M4: the property page", () => {
  test("a listing shows its permit, agent name and the chat; no raw email", () => {
    const html = render(<PropertyView p={detail(base)} />);
    expect(html).toContain("Advertising permit");
    expect(html).toContain("123456");
    expect(html).toContain("Rania Agent");
    expect(html).toContain("Chat with the assistant");
    expect(html).not.toContain("Ask about this property");
    expect(html).not.toContain("I agree the agent may contact me");
    expect(html).toContain("All homes");
    expect(html).toContain("AED 1,750,000");
    expect(html).toContain("Semi-furnished");
    expect(html).not.toContain("mailto:");
    expect(html).not.toContain("@");
  });
  test("a developer unit shows the developer and handover, no permit and no chat", () => {
    const html = render(
      <PropertyView
        p={detail(unit, { agent: null, furnishedLabel: null, photoIds: ["0198a1b2-0000-7000-8000-000000000001"] })}
      />,
    );
    expect(html).toContain("Fictional Developments LLC");
    expect(html).toContain("handover Mar 2028");
    expect(html).not.toContain("Advertising permit");
    expect(html).not.toContain("Chat with the assistant");
    expect(html).toContain('src="/photos/0198a1b2-0000-7000-8000-000000000001"');
  });
  test("404 for a ref that is not public, an alert when the engine is down, and the title in the metadata", async () => {
    engine({
      "/public/catalogue/L-0007": json(detail(base)),
      "/public/catalogue/L-0009": json({ error: "not found" }, 404),
      "/public/catalogue/L-0500": json({}, 500),
    });
    expect(render(await PropertyPage({ params: Promise.resolve({ ref: "L-0007" }) }))).toContain("2-bed apartment");
    expect(PropertyPage({ params: Promise.resolve({ ref: "L-0009" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(render(await PropertyPage({ params: Promise.resolve({ ref: "L-0500" }) }))).toContain(
      "couldn&#x27;t be loaded",
    );
    expect((await generateMetadata({ params: Promise.resolve({ ref: "L-0007" }) })).title).toBe(
      "2-bed apartment, Marina Vista",
    );
    expect((await generateMetadata({ params: Promise.resolve({ ref: "L-0009" }) })).title).toBe("Property");
  });
  test("a page whose engine answer has a stray field is refused", async () => {
    engine({ "/public/catalogue/L-0007": json({ ...detail(base), ownershipRef: "SECRET-DEED-1" }) });
    const html = render(await PropertyPage({ params: Promise.resolve({ ref: "L-0007" }) }));
    expect(html).not.toContain("SECRET-DEED-1");
  });
});
