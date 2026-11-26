import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToReadableStream, renderToStaticMarkup as render } from "react-dom/server";
import type { ReactElement } from "react";

let demoMode = true;
const cookieSets: { name: string; value: string }[] = [];
mock.module("next/navigation", () => ({
  usePathname: () => "/work",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, refresh() {} }),
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
mock.module("next/headers", () => ({
  cookies: async () => ({
    get: () => ({ value: "tok" }),
    set: (name: string, value: string) => void cookieSets.push({ name, value }),
  }),
  headers: async () => new Headers(),
}));
mock.module("../lib/env", () => ({
  engineUrl: () => "http://engine.test",
  sessionCookie: () => "spa_session",
  webEnv: () => ({ SPA_DEMO_MODE: demoMode, SPA_PORTAL_URL: "http://portal.test" }),
}));

const { DEMO_CAST, castHint, safeReturnTo } = await import("@spa/core/demo");
const { DemoPicker } = await import("../components/demo-picker");
const { DemoHandoff, HandoffView } = await import("../components/demo-handoff");
const { DemoSwitcher } = await import("../components/demo-switcher");
const { WaitingBanner } = await import("../components/waiting-banner");
const { InboxList } = await import("../components/inbox");
const { ListingNextStep } = await import("../components/listing-next-step");
const { switchDemoUser } = await import("../app/demo-switch/actions");
const { default: SignInPage } = await import("../app/sign-in/page");
const { requireScreen } = await import("../lib/session");
const { railItems } = await import("@spa/core/roles");
const { inboxItem } = await import("./fixtures");
const { InboxItem } = await import("../lib/contracts");

/** Static render that also waits for async server components (the hand-off fetches its target). */
async function renderAsync(el: ReactElement): Promise<string> {
  const stream = await renderToReadableStream(el);
  await stream.allReady;
  return await new Response(stream).text();
}
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const USERS = [
  {
    email: "salesadmin@spa-demo.test",
    name: "Lina Salesadmin",
    role: "sales_admin",
    roleLabel: "Sales admin",
    shortRole: "Sales admin",
    cast: false,
    hint: "NOC, Oqood and transfer submissions",
  },
  {
    email: "officer@spa-demo.test",
    name: "Rania Officer",
    role: "sales_officer",
    roleLabel: "Sales officer",
    shortRole: "Agent",
    cast: true,
    hint: castHint("sales_officer"),
  },
  {
    email: "manager@spa-demo.test",
    name: "Karim Manager",
    role: "sales_manager",
    roleLabel: "Sales manager",
    shortRole: "Manager",
    cast: true,
    hint: castHint("sales_manager"),
  },
  {
    email: "legal@spa-demo.test",
    name: "Omar Legal",
    role: "legal",
    roleLabel: "Legal",
    shortRole: "Legal",
    cast: true,
    hint: castHint("legal"),
  },
  {
    email: "admin@spa-demo.test",
    name: "Adam Admin",
    role: "admin",
    roleLabel: "Admin",
    shortRole: "Admin",
    cast: true,
    hint: castHint("admin"),
  },
  {
    email: "finance@spa-demo.test",
    name: "Huda Finance",
    role: "finance",
    roleLabel: "Finance",
    shortRole: "Finance",
    cast: false,
    hint: "Settlement and refunds",
  },
  {
    email: "compliance@spa-demo.test",
    name: "Sara Compliance",
    role: "compliance_officer",
    roleLabel: "Compliance officer",
    shortRole: "Compliance",
    cast: false,
    hint: "AML review",
  },
  {
    email: "mlro@spa-demo.test",
    name: "Yusuf Mlro",
    role: "mlro",
    roleLabel: "MLRO",
    shortRole: "MLRO",
    cast: false,
    hint: "Reports",
  },
] as const;
const byRole: Record<string, (typeof USERS)[number]> = Object.fromEntries(USERS.map((u) => [u.role, u]));

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  demoMode = true;
  cookieSets.length = 0;
});
/** The engine's demo routes, as the demo engine answers them. */
const demoEngine = (opts: { missing?: string[] } = {}) => {
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(url));
    if (u.pathname === "/api/auth/demo-users") return Response.json(USERS);
    if (u.pathname === "/api/demo/handoff") {
      const role = u.searchParams.get("role") ?? "";
      const t = opts.missing?.includes(role) ? null : byRole[role];
      return Response.json(t ? { name: t.name, email: t.email, roleLabel: t.shortRole } : null);
    }
    if (u.pathname === "/api/auth/demo-sign-in") {
      const { email } = JSON.parse(String(init?.body)) as { email: string };
      return Response.json({ token: `token-for-${email}` });
    }
    return new Response("{}", { status: 404 });
  }) as typeof fetch;
};

describe("M5b: the demo cast", () => {
  test("the cast is four people in a fixed order, each with a hint", () => {
    expect(DEMO_CAST.map((c) => c.role)).toEqual(["sales_officer", "sales_manager", "legal", "admin"]);
    expect(DEMO_CAST.every((c) => c.hint.length > 0)).toBe(true);
    expect(castHint("compliance_officer")).toBe("AML review");
  });

  test("the picker shows 4 cards in cast order with hints, and the other 4 in a closed disclosure", () => {
    const html = render(<DemoPicker users={USERS as never} />);
    const [castPart, backPart] = html.split("<details");
    const names = [...castPart!.matchAll(/(\w+) \((Agent|Manager|Legal|Admin)\)/g)].map((m) => m[1]);
    expect(names).toEqual(["Rania", "Karim", "Omar", "Adam"]);
    expect(castPart).toContain("Listings, leads, viewings, deals, documents");
    expect(castPart).toContain("Settings, inventory, demo clock");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(backPart).toContain("Back-office roles (only when a step needs them)");
    for (const n of ["Lina (Sales admin)", "Huda (Finance)", "Sara (Compliance)", "Yusuf (MLRO)"])
      expect(backPart).toContain(n);
    expect(castPart).not.toContain("Sara");
  });

  test("the sign-in page: demo mode lists the cast; with demo mode off it is the password form only", async () => {
    demoEngine();
    const on = render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(on).toContain("Rania (Agent)");
    expect(on).not.toContain('type="password"');
    demoMode = false;
    const off = render(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(off).toContain('type="password"');
    expect(off).not.toContain("Back-office roles");
    expect(off).not.toContain("Rania");
  });
});

describe("M5b: the hand-off on waiting cards", () => {
  const legalWait = {
    role: "legal",
    label: "Legal approval",
    since: "2026-11-15T06:00:00.000Z",
    waitedDays: 3,
  } as const;

  test("a deal waiting for legal offers 'Switch to Omar' in demo mode", async () => {
    demoEngine();
    const html = text(await renderAsync(<WaitingBanner waiting={legalWait} viewer="sales_officer" demo />));
    expect(html).toContain("Waiting for Omar (Legal)");
    expect(html).toContain("Switch to Omar");
  });

  test("demo mode off: no hand-off, the card keeps its normal wording", async () => {
    demoEngine();
    const html = render(<WaitingBanner waiting={legalWait} viewer="sales_officer" />);
    expect(html).not.toContain("Switch to");
    expect(html).toContain("Legal approval");
    expect(html).toContain("Legal");
    expect(render(<DemoHandoff role="legal" demo={false} />)).toBe("");
  });

  test("an AML hold shown to a sales officer says 'Under review' and 'Switch to Sara', and no flag, match or reason", async () => {
    demoEngine();
    const hold = { role: null, label: "Compliance review", since: "2026-11-15T06:00:00.000Z", waitedDays: 1 } as const;
    const html = text(await renderAsync(<WaitingBanner waiting={hold} viewer="sales_officer" demo />));
    expect(html).toContain("Under review");
    expect(html).toContain("Switch to Sara");
    expect(html).toContain("Sara (Compliance)");
    expect(html).not.toMatch(/flag|sanction|PEP|match|politically|screening|source of funds/i);
  });

  test("a waiting step the viewer decides themselves has no hand-off", async () => {
    demoEngine();
    const html = text(await renderAsync(<WaitingBanner waiting={legalWait} viewer="legal" demo />));
    expect(html).not.toContain("Switch to");
    expect(html).toContain("Waiting for you");
  });

  test("a role with two seeded users: the cast member first; a role with no user says so and draws no button", async () => {
    demoEngine({ missing: ["legal"] });
    const none = text(await renderAsync(<DemoHandoff role="legal" demo />));
    expect(none).toContain("No demo user has this role");
    expect(none).not.toContain("Switch to");
    expect(render(<HandoffView target={null} role="legal" />)).not.toContain("<button");
    const t = { name: "Omar Legal", email: "legal@spa-demo.test", roleLabel: "Legal" };
    expect(render(<HandoffView target={t} role="legal" />)).toContain("Switch to Omar");
  });

  test("the inbox: a pending item the viewer cannot decide offers the approver; the proposer who is the only approver is still offered (the engine refuses)", async () => {
    demoEngine();
    const other = InboxItem.parse(
      inboxItem({
        gate: "agreement_approval",
        approverRole: "legal",
        mayDecide: { ok: false, reason: "only legal decides" },
      }),
    );
    const own = InboxItem.parse(
      inboxItem({
        gate: "agreement_approval",
        approverRole: "legal",
        mayDecide: { ok: false, reason: "you cannot decide your own proposal" },
      }),
    );
    const list = (item: typeof other, demo: boolean) => (
      <InboxList items={[item]} viewer="sales_officer" decideAction={async () => {}} from="work" demo={demo} />
    );
    expect(text(await renderAsync(list(other, true)))).toContain("Switch to Omar");
    expect(text(await renderAsync(list(own, true)))).toContain("Switch to Omar");
    expect(render(list(other, false))).not.toContain("Switch to");
  });

  test("the listing Next step shows a handed-in hand-off line, and nothing without one", async () => {
    demoEngine();
    const l = {
      id: "i",
      ref: "L-1",
      state: "DRAFT",
      next: null,
      actions: [],
      lastUnpublish: null,
      page: null,
    } as never;
    const withIt = text(
      await renderAsync(<ListingNextStep listing={l} handoff={<DemoHandoff role="sales_manager" demo />} />),
    );
    expect(withIt).toContain("Switch to Karim");
    expect(render(<ListingNextStep listing={l} />)).not.toContain("Switch to");
  });
});

describe("M5b: switchDemoUser", () => {
  test("returnTo must be a same-site path", () => {
    expect(safeReturnTo("/work/deals/abc?x=1")).toBe("/work/deals/abc?x=1");
    for (const bad of ["//evil.test", "https://evil.test/x", "/\\evil.test", "evil", "", "javascript:alert(1)"])
      expect(safeReturnTo(bad)).toBe("/");
  });

  test("a demo sign-in sets that user's session and redirects to the same page; a bad returnTo goes to /", async () => {
    demoEngine();
    await expect(switchDemoUser("legal@spa-demo.test", "/work/deals/abc")).rejects.toThrow(
      "NEXT_REDIRECT /work/deals/abc",
    );
    expect(cookieSets).toEqual([{ name: "spa_session", value: "token-for-legal@spa-demo.test" }]);
    await expect(switchDemoUser("legal@spa-demo.test", "//evil.test")).rejects.toThrow("NEXT_REDIRECT /");
    await expect(switchDemoUser("legal@spa-demo.test", "https://evil.test")).rejects.toThrow("NEXT_REDIRECT /");
  });

  test("with demo mode off it signs nobody in", async () => {
    demoEngine();
    demoMode = false;
    await expect(switchDemoUser("legal@spa-demo.test", "/")).rejects.toThrow("NEXT_REDIRECT /sign-in");
    expect(cookieSets).toEqual([]);
  });
});

describe("M5b: the avatar-menu switcher", () => {
  test("demo mode: the cast first, then Back-office, the current user marked", () => {
    const html = render(<DemoSwitcher users={USERS as never} currentEmail="legal@spa-demo.test" demo />);
    expect(html).toContain("Switch demo user");
    expect(html.indexOf("Rania")).toBeLessThan(html.indexOf("Back-office"));
    expect(html.indexOf("Back-office")).toBeLessThan(html.indexOf("Sara"));
    const legal = html.slice(html.indexOf("Omar"), html.indexOf("Omar") + 120);
    expect(legal).toContain("You");
    expect(html).toContain('aria-current="true"');
    expect((html.match(/<button/g) ?? []).length).toBe(USERS.length - 1);
  });
  test("demo mode off: nothing", () => {
    expect(render(<DemoSwitcher users={USERS as never} currentEmail="x" demo={false} />)).toBe("");
  });
  test("switching to a user who can't see the page lands on the not-found screen, not a crash", async () => {
    // Omar (legal) has no Inventory screen: the app's own guard answers.
    expect(railItems("legal", "both").some((i) => i.screen === "inventory")).toBe(false);
    globalThis.fetch = (async () =>
      Response.json({
        id: "u",
        name: "Omar Legal",
        email: "legal@spa-demo.test",
        role: "legal",
        roleLabel: "Legal",
        companyKind: "both",
      })) as typeof fetch;
    await expect(requireScreen("inventory")).rejects.toThrow("NEXT_NOT_FOUND");
  });
});
