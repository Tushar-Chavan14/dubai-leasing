import { loadEnv } from "@leasing/core";
import { createDatabase, runMigrations } from "@leasing/db";
import { seedDemo } from "./seed.ts";

/** Drops all app, migration and pg-boss tables, re-migrates and re-seeds. Demo mode only. */
const env = loadEnv();
if (!env.DEMO_MODE) throw new Error("demo:reset needs DEMO_MODE=true; it deletes every table");
const database = createDatabase(env.DATABASE_URL, { max: 2 });
await database.pool.query(
  "DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; DROP SCHEMA IF EXISTS pgboss CASCADE; CREATE SCHEMA public;",
);
// The simulated registry is reset through its own API (it owns the `ejari_mock` schema). If it
// isn't running, its schema is dropped; it is created again, seeded, when the service starts.
const mockReset = await fetch(`${env.EJARI_MOCK_URL.replace(/\/$/, "")}/api/v1/demo/reset`, { method: "POST" }).then(
  (r) => r.ok,
  () => false,
);
if (!mockReset)
  await database.pool.query("SET client_min_messages = warning; DROP SCHEMA IF EXISTS ejari_mock CASCADE");
await runMigrations(database);
await seedDemo(database);
await database.close();
console.log("demo reset complete (restart the engine so pg-boss recreates its schema)");
