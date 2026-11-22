import { describe, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findRepoRoot, loadSpaEnv, parseSpaEnv, SPA_DEMO_SESSION_SECRET, sessionSecret } from "../src/env.ts";
import { type CompanyKind, railItems, screenOf, SpaRole } from "../src/index.ts";

const SECRET = "x".repeat(32);
const good = { SPA_DATABASE_URL: "postgres://u:p@localhost:5432/spa", SPA_SESSION_SECRET: SECRET };
const demo = { SPA_DATABASE_URL: "postgres://u:p@localhost:5432/spa", SPA_DEMO_MODE: "true" };

describe("SPA env (S25)", () => {
  test("defaults fill the optional keys", () => {
    const e = parseSpaEnv(good);
    expect([e.SPA_ENGINE_PORT, e.SPA_WEB_PORT, e.SPA_SESSION_COOKIE, e.SPA_DEMO_MODE]).toEqual([
      4001,
      3001,
      "spa_session",
      false,
    ]);
    expect(e.SPA_PORTAL_URL).toBe("http://localhost:3100");
    expect(e.SPA_CHAT_MODEL).toBeUndefined();
  });
  test("the launcher key is optional and needs 16 characters when set (S69)", () => {
    expect(parseSpaEnv(good).PORTAL_SUMMARY_KEY).toBeUndefined();
    expect(parseSpaEnv({ ...good, PORTAL_SUMMARY_KEY: "" }).PORTAL_SUMMARY_KEY).toBeUndefined();
    expect(parseSpaEnv({ ...good, PORTAL_SUMMARY_KEY: "k".repeat(16) }).PORTAL_SUMMARY_KEY).toBe("k".repeat(16));
    expect(() => parseSpaEnv({ ...good, PORTAL_SUMMARY_KEY: "short" })).toThrow("PORTAL_SUMMARY_KEY");
  });
  test("the portal public key is optional, one line of base64, and a bad value is never printed (S70)", () => {
    const key = "MCowBQYDK2VwAyEA".padEnd(44, "A");
    expect(parseSpaEnv(good).SPA_PORTAL_PUBLIC_KEY).toBeUndefined();
    expect(parseSpaEnv({ ...good, SPA_PORTAL_PUBLIC_KEY: "" }).SPA_PORTAL_PUBLIC_KEY).toBeUndefined();
    expect(parseSpaEnv({ ...good, SPA_PORTAL_PUBLIC_KEY: key }).SPA_PORTAL_PUBLIC_KEY).toBe(key);
    expect(() => parseSpaEnv({ ...good, SPA_PORTAL_PUBLIC_KEY: "not a key!" })).toThrow("SPA_PORTAL_PUBLIC_KEY");
    try {
      parseSpaEnv({ ...good, SPA_PORTAL_PUBLIC_KEY: "not a key!" });
    } catch (e) {
      expect(String(e)).not.toContain("not a key!");
    }
  });
  test("missing or bad keys stop the app, naming every key and no value", () => {
    let msg = "";
    try {
      parseSpaEnv({ SPA_SESSION_SECRET: "short-secret-value", SPA_ENGINE_PORT: "3001", SPA_WEB_PORT: "3001" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("SPA_DATABASE_URL");
    expect(msg).toContain("SPA_DATABASE_URL");
    expect(msg).not.toContain("short-secret-value");
    expect(() => parseSpaEnv({ ...good, SPA_ENGINE_PORT: "3001", SPA_WEB_PORT: "3001" })).toThrow(
      "SPA_WEB_PORT: must differ",
    );
  });
  test("a malformed database URL names the key and never prints the value", () => {
    let msg = "";
    try {
      parseSpaEnv({ ...good, SPA_TEST_DATABASE_URL: "postgres://user:s3cret@[bad" });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toContain("SPA_TEST_DATABASE_URL: must be a postgres:// URL with a database name");
    expect(msg).not.toContain("s3cret");
    expect(() => parseSpaEnv({ ...good, SPA_DATABASE_URL: "mysql://u@localhost/spa" })).toThrow("SPA_DATABASE_URL");
    expect(parseSpaEnv({ ...good, SPA_TEST_DATABASE_URL: "" }).SPA_TEST_DATABASE_URL).toBeUndefined();
  });
  test("the session secret is required outside demo mode; demo mode has its own, like leasing", () => {
    expect(() => parseSpaEnv({ SPA_DATABASE_URL: demo.SPA_DATABASE_URL })).toThrow(
      "SPA_SESSION_SECRET: required when SPA_DEMO_MODE is false",
    );
    expect(() => parseSpaEnv({ SPA_DATABASE_URL: demo.SPA_DATABASE_URL, SPA_SESSION_SECRET: "short" })).toThrow(
      "SPA_SESSION_SECRET",
    );
    expect(sessionSecret(parseSpaEnv(demo))).toBe(SPA_DEMO_SESSION_SECRET);
    expect(SPA_DEMO_SESSION_SECRET).not.toBe("demo-only-session-secret");
    expect(sessionSecret(parseSpaEnv({ ...demo, SPA_SESSION_SECRET: SECRET }))).toBe(SECRET);
  });
  test("the test database must contain 'test' and differ from the real one", () => {
    expect(() => parseSpaEnv({ ...good, SPA_TEST_DATABASE_URL: "postgres://u:p@localhost:5432/spa" })).toThrow(
      'must contain "test"',
    );
    expect(
      parseSpaEnv({ ...good, SPA_TEST_DATABASE_URL: "postgres://u:p@localhost:5432/spa_test" }).SPA_TEST_DATABASE_URL,
    ).toBe("postgres://u:p@localhost:5432/spa_test");
  });
  test("only .env.spa.local is read: .env, .env.local and process.env are ignored", () => {
    const root = mkdtempSync(join(tmpdir(), "spa-env-"));
    writeFileSync(join(root, ".env.spa.example"), "");
    writeFileSync(join(root, ".env"), "SPA_DATABASE_URL=postgres://leasing/leasing\nSPA_SESSION_SECRET=" + SECRET);
    writeFileSync(join(root, ".env.local"), "SPA_DEMO_MODE=true");
    expect(() => loadSpaEnv(root)).toThrow("Missing .env.spa.local");
    writeFileSync(
      join(root, ".env.spa.local"),
      `SPA_DATABASE_URL=postgres://u@localhost/spa\nSPA_SESSION_SECRET=${SECRET}\n`,
    );
    process.env.SPA_DEMO_MODE = "true";
    try {
      const e = loadSpaEnv(root);
      expect(e.SPA_DATABASE_URL).toBe("postgres://u@localhost/spa");
      expect(e.SPA_DEMO_MODE).toBe(false);
    } finally {
      delete process.env.SPA_DEMO_MODE;
    }
    const deep = join(root, "spa", "apps", "web");
    mkdirSync(deep, { recursive: true });
    expect(findRepoRoot(deep)).toBe(root);
  });
});

describe("rail items (design.md §2–3, S33)", () => {
  const screens = (role: SpaRole, kind?: CompanyKind) => railItems(role, kind).map((i) => i.screen);
  test("by role, for a company that is both developer and brokerage", () => {
    expect(screens("sales_officer")).toEqual(["home", "work", "inventory", "listings"]);
    expect(screens("sales_manager")).toEqual(["home", "work", "inventory", "listings", "settings"]);
    expect(screens("sales_admin")).toEqual(["home", "work", "inventory", "listings"]);
    expect(screens("legal")).toEqual(["home", "work", "settings"]);
    expect(screens("finance")).toEqual(["home", "work"]);
    expect(screens("compliance_officer")).toEqual(["home", "compliance"]);
    expect(screens("mlro")).toEqual(["home", "compliance"]);
    expect(screens("admin")).toEqual(["home", "inventory", "listings", "settings"]);
  });
  test("a developer has no Listings, a brokerage no Inventory", () => {
    expect(screens("sales_officer", "developer")).toEqual(["home", "work", "inventory"]);
    expect(screens("sales_officer", "brokerage")).toEqual(["home", "work", "listings"]);
    expect(screens("admin", "brokerage")).toEqual(["home", "listings", "settings"]);
  });
  test("compliance is only for compliance roles; Settings is read-only for a sales manager", () => {
    for (const r of SpaRole.options)
      expect(screens(r).includes("compliance")).toBe(r === "compliance_officer" || r === "mlro");
    expect(railItems("sales_manager").find((i) => i.screen === "settings")?.readOnly).toBe(true);
    expect(railItems("legal").find((i) => i.screen === "settings")?.readOnly).toBe(true);
    expect(railItems("admin").find((i) => i.screen === "settings")?.readOnly).toBeUndefined();
    // C34 (S66): only these four see Settings; finance, the sales officer, sales admin and compliance never do
    for (const r of SpaRole.options)
      expect(screens(r).includes("settings")).toBe(["admin", "sales_manager", "legal"].includes(r));
  });
  test("every role sees Home; paths map back to screens", () => {
    for (const r of SpaRole.options) expect(screens(r)[0]).toBe("home");
    expect(screenOf("/work")).toBe("work");
    expect(screenOf("/settings/users")).toBe("settings");
    expect(screenOf("/")).toBe("home");
    expect(screenOf("/sign-in")).toBe("home");
  });
});
