import { resolve } from "node:path";
import { LocalDiskStore } from "@platform/adapters";
import { loadSpaEnv } from "@spa/core/env";
import { createSpaDatabase, runSpaMigrations } from "@spa/db";
import { SpaDemoClock } from "./clock.ts";
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
// Dates follow the SPA demo clock (its offset in spa_demo_settings).
const clock = new SpaDemoClock(database, true);
await clock.refresh();
await seedSpaDemo(
  database,
  clock,
  env,
  new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-uploads")),
  new LocalDiskStore(resolve(import.meta.dir, "../../../../data/spa-media")),
);
await database.close();
console.log(`reset ${name}: migrated and seeded (pg-boss recreates its schema when the engine starts)`);
