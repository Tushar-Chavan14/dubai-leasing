import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup as render } from "react-dom/server";
import { generatePortalKeyPair, verifyPortalToken } from "@platform/kernel";
import { hashPassword } from "@platform/kernel/password";
import { type AccountStore, authenticate } from "../lib/accounts";
import { type PostFetcher, checkAccess } from "../lib/access";
import { parsePortalEnv } from "../lib/env";
import { handoffUrl } from "../lib/handoff";
import { PortalHome } from "../components/portal-home";
import { clearPortalSession, issuePortalSession, PORTAL_COOKIE, readPortalSession } from "../lib/session";
import { signInWith, SLOW, WRONG } from "../lib/sign-in";
import { createExchangeLimiter } from "@platform/kernel";
import { loadSignedInTiles } from "../lib/tiles";

const NOW = Date.parse("2026-11-21T08:00:00Z");
const keys = generatePortalKeyPair();
const SECRET = "p".repeat(40);
const env = (over: Record<string, string> = {}) =>
  parsePortalEnv({
    PORTAL_LEASING_URL: "http://leasing.test:3000",
    PORTAL_SPA_URL: "http://sales.test:3001",
    PORTAL_LEASING_ENGINE_URL: "http://leasing.test:4000",
    PORTAL_SPA_ENGINE_URL: "http://sales.test:4001",
    PORTAL_SUMMARY_KEY: "k".repeat(32),
    PORTAL_SIGNING_KEY: keys.privateKey,
    PORTAL_DATABASE_URL: "postgres://u@localhost/portal",
    PORTAL_SESSION_SECRET: SECRET,
    ...over,
  });
const account = { id: "acct-1", email: "ana@example.test" };

describe("portal env (S70)", () => {
  test("sign-in is off without a signing key; with one the database and session secret are required", () => {
    expect(parsePortalEnv({}).PORTAL_SIGNING_KEY).toBeUndefined();
    expect(() => parsePortalEnv({ PORTAL_SIGNING_KEY: keys.privateKey })).toThrow("PORTAL_DATABASE_URL");
    expect(() =>
      parsePortalEnv({ PORTAL_SIGNING_KEY: keys.privateKey, PORTAL_DATABASE_URL: "postgres://u@h/portal" }),
    ).toThrow("PORTAL_SESSION_SECRET");
    expect(env().PORTAL_SIGNING_KEY).toBe(keys.privateKey);
  });
  test("the database must be a portal one; a leasing or spa URL is refused, and a key is never printed", () => {
    expect(() => env({ PORTAL_DATABASE_URL: "postgres://u@localhost/leasing" })).toThrow("portal");
    expect(() => env({ PORTAL_SIGNING_KEY: "bad key value" })).toThrow(/PORTAL_SIGNING_KEY/);
    try {
      env({ PORTAL_SIGNING_KEY: "not-a-valid-key!" });
    } catch (e) {
      expect(String(e)).not.toContain("not-a-valid-key!");
    }
  });
});

describe("portal accounts and sign-in", () => {
  const store = async (): Promise<AccountStore> => {
    const hash = await hashPassword("right horse");
    const rows = [
      { id: "acct-1", email: "ana@example.test", passwordHash: hash, active: true },
      { id: "acct-2", email: "off@example.test", passwordHash: hash, active: false },
    ];
    return { find: async (e) => rows.find((r) => r.email === e.trim().toLowerCase()) ?? null };
  };
  test("right email and password (any case) gives the account", async () => {
    expect(await authenticate(await store(), "Ana@Example.test", "right horse")).toEqual(account);
  });
  test("a wrong password, an unknown email and an inactive account are one identical answer", async () => {
    const s = await store();
    const limiter = createExchangeLimiter();
    const tries = [
      ["ana@example.test", "wrong"],
      ["nobody@example.test", "right horse"],
      ["off@example.test", "right horse"],
    ] as const;
    const answers = [];
    for (const [email, password] of tries)
      answers.push(await signInWith(s, limiter, { email, password, ip: "1.1.1.1", nowMs: NOW }));
    expect(answers[0]).toEqual({ ok: false, reason: "wrong" });
    expect(answers[1]).toEqual(answers[0]!);
    expect(answers[2]).toEqual(answers[0]!);
    expect(WRONG).not.toMatch(/email .* not|unknown|inactive|password is/i);
  });
  test("attempts are limited per IP and per email, with one answer", async () => {
    const s = await store();
    const limiter = createExchangeLimiter({
      exchange: { ip: 2, email: 3 },
      check: { ip: 9, email: 9 },
      windowMs: 60_000,
    });
    const go = (email: string, ip: string) => signInWith(s, limiter, { email, password: "x", ip, nowMs: NOW });
    expect(
      [await go("a@x.test", "5.5.5.5"), await go("b@x.test", "5.5.5.5"), await go("c@x.test", "5.5.5.5")].map((r) =>
        r.ok ? "ok" : r.reason,
      ),
    ).toEqual(["wrong", "wrong", "slow"]);
    const byEmail = [];
    for (let i = 0; i < 4; i++) byEmail.push(await go("ana@example.test", `6.6.6.${i}`));
    expect(byEmail.map((r) => (r.ok ? "ok" : r.reason))).toEqual(["wrong", "wrong", "wrong", "slow"]);
    expect(SLOW).toBeString();
  });
});

describe("portal session cookie", () => {
  test("its own name, its own secret: a module session or another secret opens nothing", () => {
    expect(PORTAL_COOKIE).toBe("portal_session");
    const t = issuePortalSession(SECRET, "acct-1", NOW);
    expect(readPortalSession(SECRET, t, NOW + 1000)).toBe("acct-1");
    expect(readPortalSession("s".repeat(40), t, NOW)).toBeNull();
    expect(readPortalSession(SECRET, t, NOW + 13 * 3_600_000)).toBeNull();
    expect(readPortalSession(SECRET, undefined, NOW)).toBeNull();
  });
  test("signing out clears the portal cookie and nothing else", () => {
    const jar = new Map([
      ["portal_session", "a"],
      ["spa_session", "b"],
      ["leasing_session", "c"],
    ]);
    clearPortalSession({ delete: (n) => jar.delete(n) });
    expect([...jar.keys()].toSorted()).toEqual(["leasing_session", "spa_session"]);
  });
});

/** A stand-in for the two engines: each answers a check as scripted, and records what it was sent. */
const engines = (answers: Record<string, () => Response>) => {
  const calls: { url: string; body: { token: string }; ip: string | undefined }[] = [];
  const f = async (url: string, init: { body?: string; headers: Record<string, string> }) => {
    calls.push({ url, body: init.body ? JSON.parse(init.body) : { token: "" }, ip: init.headers["x-client-ip"] });
    const a = answers[new URL(url).host];
    if (!a) throw new Error("connection refused");
    return a();
  };
  return { f, calls };
};
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status });

describe("access check and tiles by access", () => {
  test("each engine gets a check token for its own audience, with ?check=1, and no secret in the URL", async () => {
    const { f, calls } = engines({
      "leasing.test:4000": () => json({ active: true }),
      "sales.test:4001": () => json({ active: false }),
    });
    const a = await checkAccess(env(), account, f as PostFetcher, NOW);
    expect(a).toEqual({ leasing: true, spa: false });
    expect(calls.map((c) => c.url).toSorted()).toEqual([
      "http://leasing.test:4000/api/auth/portal-exchange?check=1",
      "http://sales.test:4001/api/auth/portal-exchange?check=1",
    ]);
    for (const c of calls) {
      const aud = c.url.includes("4000") ? "leasing" : "spa";
      const v = verifyPortalToken(keys.publicKey, c.body.token, aud, NOW);
      expect(v.ok).toBe(true);
      if (v.ok) expect(v.claims.email).toBe("ana@example.test");
    }
  });
  test("an engine that is down, refuses, or answers oddly counts as no access", async () => {
    const { f } = engines({
      "leasing.test:4000": () => json({ active: "yes" }),
      "sales.test:4001": () => json({}, 403),
    });
    expect(await checkAccess(env(), account, f as PostFetcher, NOW)).toEqual({ leasing: false, spa: false });
    const down = engines({});
    expect(await checkAccess(env(), account, down.f as PostFetcher, NOW)).toEqual({ leasing: false, spa: false });
  });
  const summary = (host: string, n: number) => ({ [host]: () => json({ openWork: n, waitingApprovals: n + 1 }) });
  test("a tile shows only for a module with an active user, and counts only on that tile", async () => {
    const { f, calls } = engines({ ...summary("leasing.test:4000", 4) });
    const tiles = await loadSignedInTiles(env(), { leasing: true, spa: false }, f as never);
    expect(tiles.map((t) => t.key)).toEqual(["leasing"]);
    expect(tiles[0]!.counts).toEqual({ state: "shown", counts: { openWork: 4, waitingApprovals: 5 } });
    expect(calls.map((c) => c.url)).toEqual(["http://leasing.test:4000/summary"]);
  });
  test("no access anywhere: no tile and no count call; the page says so", async () => {
    const { f, calls } = engines({});
    const tiles = await loadSignedInTiles(env(), { leasing: false, spa: false }, f as never);
    expect(tiles).toEqual([]);
    expect(calls).toEqual([]);
    const html = render(<PortalHome tiles={tiles} signedIn />);
    expect(html).toContain("No modules");
    expect(html).not.toContain("data-tile");
    expect(html).toContain("Sign out");
  });
  test("both modules: two tiles that link through the portal's own hand-off route, with counts", async () => {
    const { f } = engines({ ...summary("leasing.test:4000", 1), ...summary("sales.test:4001", 2) });
    const tiles = await loadSignedInTiles(env(), { leasing: true, spa: true }, f as never);
    const html = render(<PortalHome tiles={tiles} signedIn />);
    expect(html).toContain('href="/go/leasing"');
    expect(html).toContain('href="/go/spa"');
    expect(html).toContain("Open work");
  });
});

describe("hand-off to a module", () => {
  test("a token for that module only, 60 seconds, with the person's email and no role", () => {
    const url = new URL(handoffUrl(env(), "spa", account, NOW));
    expect(`${url.origin}${url.pathname}`).toBe("http://sales.test:3001/auth/portal");
    const token = url.searchParams.get("token")!;
    const spa = verifyPortalToken(keys.publicKey, token, "spa", NOW + 30_000);
    expect(spa.ok).toBe(true);
    expect(verifyPortalToken(keys.publicKey, token, "leasing", NOW).ok).toBe(false);
    expect(verifyPortalToken(keys.publicKey, token, "spa", NOW + 61_000).ok).toBe(false);
    if (spa.ok) expect(Object.keys(spa.claims)).not.toContain("role");
    const leasing = new URL(handoffUrl(env(), "leasing", account, NOW));
    expect(leasing.origin).toBe("http://leasing.test:3000");
  });
});

describe("portal source", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      if (f === "node_modules" || f === ".next" || f === "test") return [];
      const p = join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : /\.(ts|tsx)$/.test(f) ? [p] : [];
    });
  test("imports no module package and never logs a key, password or token", () => {
    const files = walk(join(import.meta.dir, ".."));
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      // keygen prints a new key on purpose: that is its whole job
      if (f.endsWith("keygen.ts")) continue;
      const src = readFileSync(f, "utf8");
      expect(src).not.toMatch(/from "@(leasing|spa)\//);
      expect(src).not.toMatch(
        /console\.\w+\((\s*|[^)]*\$\{[^}]*)(password|token|signingKey|SIGNING_KEY|privateKey)\b/i,
      );
    }
  });
});
