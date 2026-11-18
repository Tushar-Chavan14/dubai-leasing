import type { Database } from "@leasing/db";
import { seedDemo } from "./seed.ts";

/**
 * In-place demo reset (demo console, admin, DEMO_MODE only): empties every app table except staff
 * users (so people stay signed in), drops queued jobs, resets the simulated registry and seeds
 * the demo again. Unlike `demo:reset` it keeps the schemas, so the engine needs no restart.
 */
export async function resetDemoData(database: Database, ejariMockUrl: string): Promise<{ mockReset: boolean }> {
  const { rows } = await database.pool.query<{ t: string }>(
    "SELECT tablename AS t FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'staff_users'",
  );
  if (rows.length) {
    // The audit log refuses TRUNCATE (migration 0002). A demo reset wipes it on purpose, like
    // `demo:reset` dropping the schema: the guard is lifted only inside this one transaction.
    const client = await database.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("ALTER TABLE lease_events DISABLE TRIGGER lease_events_no_truncate");
      await client.query(
        `TRUNCATE ${rows.map((r) => `public."${r.t.replace(/"/g, "")}"`).join(", ")} RESTART IDENTITY CASCADE`,
      );
      await client.query("ALTER TABLE lease_events ENABLE TRIGGER lease_events_no_truncate");
      // The demo clock's singleton row (migration 0001).
      await client.query("INSERT INTO demo_settings (id, clock_offset_ms) VALUES (1, 0) ON CONFLICT (id) DO NOTHING");
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
  // Jobs queued for the old data would only find nothing; drop them (pg-boss keeps its schema).
  await database.pool.query("DELETE FROM pgboss.job WHERE state IN ('created', 'retry')").catch(() => {});
  const mockReset = await fetch(`${ejariMockUrl.replace(/\/$/, "")}/api/v1/demo/reset`, { method: "POST" }).then(
    (r) => r.ok,
    () => false,
  );
  await seedDemo(database);
  return { mockReset };
}
