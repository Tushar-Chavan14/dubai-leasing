import { loadSpaEnv } from "@spa/core/env";
import { createSpaDatabase, runSpaMigrations } from "@spa/db";
import { requireDemo, requireSpaDatabase, seedSpaDemo } from "./seed.ts";

/**
 * `bun run spa:demo:reset`: drops every SPA table and the SPA job queue, migrates and seeds again. Demo mode only,
 * and only on a database named like the SPA one: it refuses a database called `leasing`.
 */
const env = loadSpaEnv();
requireDemo(env);
const name = requireSpaDatabase(env.SPA_DATABASE_URL);
const database = createSpaDatabase(env.SPA_DATABASE_URL, { max: 1 });
await database.pool.query(
  "drop schema if exists public cascade; drop schema if exists drizzle cascade; drop schema if exists pgboss cascade; create schema public;",
);
await runSpaMigrations(database);
await seedSpaDemo(database);
await database.close();
console.log(`reset ${name}: migrated and seeded (pg-boss recreates its schema when the engine starts)`);
