import { loadEnv } from "@leasing/core";
import { createDatabase } from "@leasing/db";
import { EngineDemoClock } from "../clock.ts";

/** Sets the demo clock back to today (real time) and keeps every record. Demo mode only. */
const env = loadEnv();
if (!env.DEMO_MODE) throw new Error("demo:rewind needs DEMO_MODE=true");
const database = createDatabase(env.DATABASE_URL, { max: 1 });
const clock = new EngineDemoClock(database);
await clock.rewind();
await database.close();
console.log(
  `demo clock back to today (${clock.today()}); all data kept. A running engine picks it up at its next sweep, or use "Back to today" on the Demo clock page.`,
);
