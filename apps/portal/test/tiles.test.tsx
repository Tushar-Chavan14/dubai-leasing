import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup as render } from "react-dom/server";
import { PortalHome } from "../components/portal-home";
import { loadPortalEnv, parsePortalEnv, PORTAL_ENV_FILE } from "../lib/env";
import { type Fetcher, loadTiles } from "../lib/tiles";

const KEY = "k".repeat(32);
const env = (over: Record<string, string> = {}) =>
  parsePortalEnv({
    PORTAL_LEASING_URL: "http://leasing.test:3000",
    PORTAL_SPA_URL: "http://sales.test:3001",
    PORTAL_LEASING_ENGINE_URL: "http://leasing.test:4000",
    PORTAL_SPA_ENGINE_URL: "http://sales.test:4001",
    PORTAL_SUMMARY_KEY: KEY,
    PORTAL_SHOW_COUNTS: "true",
    ...over,
  });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
/** A stand-in network: each engine host answers as scripted. */
const net = (answers: Record<string, () => Response | Promise<Response>>) => {
  const calls: { url: string; key: string | undefined }[] = [];
  const f: Fetcher = async (url, init) => {
    calls.push({ url, key: init.headers["x-portal-key"] });
    const a = answers[new URL(url).host];
    if (!a) throw new Error("connection refused");
    return a();
  };
  return { f, calls };
};
const page = async (e: ReturnType<typeof env>, f: Fetcher) => render(<PortalHome tiles={await loadTiles(e, f)} />);

describe("portal page per module state (S69)", () => {
  test("both modules up, counts on: two tiles, two links, the two integers each", async () => {
    const { f, calls } = net({
      "leasing.test:4000": () => json({ openWork: 4, waitingApprovals: 2 }),
      "sales.test:4001": () => json({ openWork: 7, waitingApprovals: 5 }),
    });
    const html = await page(env(), f);
    expect(html).toContain("Leasing");
    expect(html).toContain("Sales (SPA)");
    expect(html).toContain('href="http://leasing.test:3000"');
    expect(html).toContain('href="http://sales.test:3001"');
    expect(html).toMatch(/Open work[\s\S]*?>4</);
    expect(html).toMatch(/Waiting approvals[\s\S]*?>5</);
    expect(calls.map((c) => c.url).toSorted()).toEqual([
      "http://leasing.test:4000/summary",
      "http://sales.test:4001/summary",
    ]);
    expect(calls.every((c) => c.key === KEY)).toBe(true);
  });
  test("one engine down: its tile and link stay, it says Not available, the other still shows", async () => {
    const { f } = net({ "sales.test:4001": () => json({ openWork: 7, waitingApprovals: 5 }) });
    const html = await page(env(), f);
    expect(html).toContain("Leasing");
    expect(html).toContain('href="http://leasing.test:3000"');
    expect(html.match(/Not available/g)).toHaveLength(1);
    expect(html).toContain(">7<");
  });
  test("both down: both tiles and links, no error, Not available twice", async () => {
    const { f } = net({});
    const html = await page(env(), f);
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(html).toContain('href="http://leasing.test:3000"');
    expect(html).toContain('href="http://sales.test:3001"');
    expect(html).not.toMatch(/error|undefined|NaN/i);
  });
  test("a wrong key (404), a server error, a slow-then-odd answer and extra fields all read as Not available", async () => {
    const { f } = net({
      "leasing.test:4000": () => json({ error: "not found" }, 404),
      "sales.test:4001": () => json({ openWork: 1, waitingApprovals: 1, name: "Sara Example" }),
    });
    const html = await page(env(), f);
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(html).not.toContain("Sara");
    const bad = net({
      "leasing.test:4000": () => new Response("<html>", { status: 200 }),
      "sales.test:4001": () => json({ openWork: "3", waitingApprovals: 1.5 }),
    });
    expect((await page(env(), bad.f)).match(/Not available/g)).toHaveLength(2);
    const boom = net({ "leasing.test:4000": () => json({}, 500), "sales.test:4001": () => json({}, 503) });
    expect((await page(env(), boom.f)).match(/Not available/g)).toHaveLength(2);
  });
  test("counts off: tiles and links only, no number, no Not available, and no engine is called", async () => {
    const { f, calls } = net({
      "leasing.test:4000": () => json({ openWork: 4, waitingApprovals: 2 }),
      "sales.test:4001": () => json({ openWork: 7, waitingApprovals: 5 }),
    });
    for (const over of [{ PORTAL_SHOW_COUNTS: "false" }, { PORTAL_SHOW_COUNTS: "" }]) {
      const html = await page(env(over), f);
      expect(html).toContain("Leasing");
      expect(html).toContain("Sales (SPA)");
      expect(html).toContain('href="http://sales.test:3001"');
      expect(html).not.toContain("Not available");
      expect(html).not.toMatch(/Open work|Waiting approvals|>\d+</);
    }
    expect(calls).toEqual([]);
  });
  test("counts on without a key: Not available, no call made", async () => {
    const { f, calls } = net({ "leasing.test:4000": () => json({ openWork: 1, waitingApprovals: 1 }) });
    const html = await page(env({ PORTAL_SUMMARY_KEY: "" }), f);
    expect(html.match(/Not available/g)).toHaveLength(2);
    expect(calls).toEqual([]);
  });
  test("nothing but the two tiles: no other module's words, no sign-in", async () => {
    const html = await page(env({ PORTAL_SHOW_COUNTS: "false" }), net({}).f);
    expect((html.match(/data-tile=/g) ?? []).length).toBe(2);
    expect(html).not.toMatch(/tenan|landlord|ejari|oqood|buyer|aml|sign in/i);
  });
});

describe("portal env (S25 style)", () => {
  test("defaults: port 3100, the four local URLs, counts off, no key", () => {
    const e = parsePortalEnv({});
    expect([e.PORTAL_PORT, e.PORTAL_SHOW_COUNTS, e.PORTAL_SUMMARY_KEY]).toEqual([3100, false, undefined]);
    expect(e.PORTAL_LEASING_URL).toBe("http://localhost:3000");
    expect(e.PORTAL_SPA_URL).toBe("http://localhost:3001");
    expect(e.PORTAL_LEASING_ENGINE_URL).toBe("http://localhost:4000");
    expect(e.PORTAL_SPA_ENGINE_URL).toBe("http://localhost:4001");
  });
  test("a bad key stops the portal, naming the key and never the value", () => {
    let msg = "";
    try {
      parsePortalEnv({ PORTAL_SPA_URL: "not-a-url-secret", PORTAL_PORT: "0" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("PORTAL_SPA_URL");
    expect(msg).toContain("PORTAL_PORT");
    expect(msg).not.toContain("not-a-url-secret");
  });
  test("only .env.portal.local is read; a missing file means defaults", () => {
    const root = mkdtempSync(join(tmpdir(), "portal-env-"));
    expect(loadPortalEnv(root).PORTAL_PORT).toBe(3100);
    writeFileSync(join(root, ".env"), "PORTAL_PORT=1111\n");
    expect(loadPortalEnv(root).PORTAL_PORT).toBe(3100);
    writeFileSync(join(root, PORTAL_ENV_FILE), "PORTAL_PORT=3200\nPORTAL_SHOW_COUNTS=true\n");
    const e = loadPortalEnv(root);
    expect([e.PORTAL_PORT, e.PORTAL_SHOW_COUNTS]).toEqual([3200, true]);
  });
});
