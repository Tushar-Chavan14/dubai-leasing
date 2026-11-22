import { existsSync } from "node:fs";
import { join } from "node:path";
import { databaseName, findRepoRoot, loadSpaEnv, SPA_ENV_FILE } from "@spa/core/env";
import { createSpaDatabase, type SpaDatabase } from "./client.ts";
import { runSpaMigrations } from "./migrate.ts";

/** `spa_test` from `.env.spa.local`, or null: SPA database tests skip without it (like leasing's `noDb`). */
export function spaTestDatabaseUrl(): string | null {
  const root = findRepoRoot();
  if (!existsSync(join(root, SPA_ENV_FILE))) return null;
  try {
    return loadSpaEnv(root).SPA_TEST_DATABASE_URL ?? null;
  } catch (e) {
    // An incomplete file skips the SPA database tests instead of failing every leasing run; the message says why.
    console.warn(`SPA database tests skipped: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Drops everything in the SPA test database and migrates it again. Refuses any database whose name lacks "test"
 * (the env schema checks it too).
 */
export async function freshSpaDatabase(url: string): Promise<SpaDatabase> {
  if (!/test/.test(databaseName(url) ?? "")) throw new Error("refusing to reset a database whose name lacks 'test'");
  const database = createSpaDatabase(url, { max: 4 });
  await database.pool.query(
    "drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;",
  );
  await runSpaMigrations(database);
  return database;
}
