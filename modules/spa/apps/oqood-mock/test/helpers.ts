import { databaseName, findRepoRoot, loadSpaEnv, SPA_ENV_FILE } from "@spa/core/env";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { RegistryUnavailableError } from "@spa/core";
import { createMockDatabase, type MockDb } from "../src/db.ts";

export { HttpOqoodAdapter } from "@spa/helpers";
export const RegistryUnavailableErrorCheck = RegistryUnavailableError;

/** The SPA test database from `.env.spa.local` (read by the SPA env loader only), or null: the tests then skip. */
export function oqoodMockTestUrl(): string | null {
  try {
    const root = findRepoRoot();
    if (!existsSync(join(root, SPA_ENV_FILE))) return null;
    return loadSpaEnv(root).SPA_TEST_DATABASE_URL ?? null;
  } catch {
    return null;
  }
}

/** Drops the `oqood_mock` schema of a *test* database and opens a connection to it. */
export async function freshOqoodMockDatabase(url: string): Promise<MockDb> {
  if (!/test/.test(databaseName(url) ?? "")) throw new Error("refusing to reset a database whose name lacks 'test'");
  const db = createMockDatabase(url, { max: 4 }).db;
  await db.execute(sql`SET client_min_messages = warning; DROP SCHEMA IF EXISTS oqood_mock CASCADE`);
  return db;
}
