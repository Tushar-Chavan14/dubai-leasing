import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { accountStore, authenticate, createAccount } from "../lib/accounts";
import { createPortalDatabase, type PortalDatabase, runPortalMigrations } from "../lib/db";
import { findRepoRoot, loadPortalEnv, PORTAL_ENV_FILE } from "../lib/env";

/** `portal_test` from PORTAL_TEST_DATABASE_URL (process env) or `.env.portal.local`; the suite skips without one. */
const url = (() => {
  if (process.env.PORTAL_TEST_DATABASE_URL) return process.env.PORTAL_TEST_DATABASE_URL;
  const root = findRepoRoot();
  return existsSync(join(root, PORTAL_ENV_FILE)) ? (loadPortalEnv(root).PORTAL_TEST_DATABASE_URL ?? null) : null;
})();

describe.skipIf(!url)("portal_accounts (portal_test)", () => {
  let db: PortalDatabase;
  beforeAll(async () => {
    if (!/test/.test(url!.split("/").pop() ?? ""))
      throw new Error("refusing to reset a database whose name lacks 'test'");
    db = createPortalDatabase(url!, { max: 2 });
    await db.pool.query(
      "drop schema if exists public cascade; drop schema if exists drizzle cascade; create schema public;",
    );
    await runPortalMigrations(db);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("an account is stored lower case, signs in in any case, and the hash is argon2id", async () => {
    const a = await createAccount(db, "Ana@Example.TEST", "a long enough password");
    expect(a.email).toBe("ana@example.test");
    const row = (await db.pool.query("select password_hash from portal_accounts")).rows[0];
    expect(row.password_hash).toStartWith("$argon2id$");
    const store = accountStore(db);
    expect(await authenticate(store, "ANA@example.test", "a long enough password")).toEqual(a);
    expect(await authenticate(store, "ana@example.test", "wrong")).toBeNull();
    expect(await authenticate(store, "ghost@example.test", "a long enough password")).toBeNull();
  });
  test("one account per email, and the database refuses an upper-case email", async () => {
    expect(createAccount(db, "ana@example.test", "another long password")).rejects.toThrow();
    const raw = db.pool.query(
      "insert into portal_accounts (id, email, password_hash) values (gen_random_uuid(), 'Bob@Example.test', 'x')",
    );
    expect(raw).rejects.toThrow("portal_accounts_email_lower");
  });
  test("an inactive account does not sign in", async () => {
    await createAccount(db, "off@example.test", "a long enough password");
    await db.pool.query("update portal_accounts set active = false where email = 'off@example.test'");
    expect(await authenticate(accountStore(db), "off@example.test", "a long enough password")).toBeNull();
  });
});
