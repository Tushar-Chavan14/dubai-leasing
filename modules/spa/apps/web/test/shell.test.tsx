import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";

mock.module("next/navigation", () => ({
  usePathname: () => "/work",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, refresh() {} }),
  redirect: () => {
    throw new Error("NEXT_REDIRECT");
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const { Rail } = await import("../components/rail");
const { railItems } = await import("@spa/core/roles");

describe("M1b: the SPA rail is the shared navy rail", () => {
  const html = render(
    <Rail items={railItems("sales_manager", "both")} footer={<i>f</i>} badges={{ work: 2 }} alerts={4} />,
  );
  test("navy rail, Sales brand, no other module named", () => {
    expect(html).toContain("bg-rail");
    expect(html).toContain("Sales, home");
    expect(html).not.toMatch(/leasing/i);
  });
  test("read-only item keeps its title, Work shows its count", () => {
    expect(html).toContain('title="Settings (view only)"');
    expect(html).toContain('aria-label="2 waiting for you"');
    expect(html).toContain('aria-current="page"');
  });
  test("the alerts bell sits in the rail with its count and link", () => {
    expect(html).toContain('href="/alerts"');
    expect(html).toContain("4 unread alerts");
    expect(html.indexOf("/alerts")).toBeLessThan(html.indexOf("⌘K"));
  });
});

mock.module("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));
mock.module("../lib/env", () => ({
  engineUrl: () => "http://engine.test",
  sessionCookie: () => "spa_session",
  webEnv: () => ({ SPA_PORTAL_URL: "http://portal.test" }),
}));
mock.module("next/cache", () => ({ revalidatePath() {} }));

describe("M1b: the SPA Shell uses the leasing layout", () => {
  test("canvas root, an uncapped main, and the bell in the rail only", async () => {
    const { Shell } = await import("../components/shell");
    const html = render(
      <Shell
        user={{ name: "Sam Seller", role: "sales_manager", roleLabel: "Sales manager", companyKind: "both" }}
        clock={null}
        theme="light"
        portalUrl="http://portal.test"
        alerts={4}
      >
        <p>page</p>
      </Shell>,
    );
    expect(html).toContain("flex min-h-screen bg-canvas text-ink");
    expect(html).toContain('<main id="main"');
    expect(html).not.toContain("max-w-[1240px]");
    expect(html.match(/href="\/alerts"/g)?.length).toBe(1);
    expect(html.indexOf("/alerts")).toBeLessThan(html.indexOf('<main id="main"'));
  });
});
