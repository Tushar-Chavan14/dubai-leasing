import { loadSpaEnv, sessionSecret } from "@spa/core/env";
import { createSpaDatabase } from "@spa/db";
import { createApp } from "./app.ts";
import { SpaDemoClock } from "./clock.ts";
import { createBoss, startJobs } from "./jobs.ts";

/** The SPA engine process (:4001). Reads only `.env.spa.local` (S25); stops at once if a key is missing. */
const env = loadSpaEnv();
const database = createSpaDatabase(env.SPA_DATABASE_URL);
const clock = new SpaDemoClock(database, env.SPA_DEMO_MODE);
await clock.refresh();
const jobs = await startJobs(createBoss(env.SPA_DATABASE_URL), clock);
const app = createApp({
  database,
  jobs,
  clock,
  sessionSecret: sessionSecret(env),
  demoMode: env.SPA_DEMO_MODE,
  nowMs: () => Date.now(),
});

const server = Bun.serve({ port: env.SPA_ENGINE_PORT, hostname: "127.0.0.1", fetch: app.fetch });
console.log(`spa engine on http://127.0.0.1:${server.port}${env.SPA_DEMO_MODE ? " (demo mode)" : ""}`);

const stop = async () => {
  await server.stop();
  await jobs.stop();
  await database.close();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
