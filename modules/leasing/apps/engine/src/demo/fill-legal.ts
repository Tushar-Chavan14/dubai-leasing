import { loadEnv } from "@leasing/core";
import { createDatabase } from "@leasing/db";
import { createEngineClock } from "../clock.ts";
import type { EngineContext } from "../context.ts";
import { fillMissingCompanyLegal } from "../manager/company-legal-fill.ts";

/** Fills missing company legal details with fictional values (audited, never overwrites). Demo mode only. */
const env = loadEnv();
if (!env.DEMO_MODE) throw new Error("demo:fill-legal needs DEMO_MODE=true");
const database = createDatabase(env.DATABASE_URL, { max: 1 });
const clock = await createEngineClock(database, true);
// Only the database, clock and rules version are used by the audited update.
const ctx = { database, clock, demoMode: true, rulesVersion: env.RULES_VERSION } as EngineContext;
for (const r of await fillMissingCompanyLegal(ctx)) {
  console.log(
    `${r.company}: ${r.error ? `FAILED (${r.error})` : r.filled.length ? `filled ${r.filled.join(", ")}` : "already complete"}`,
  );
}
await database.close();
