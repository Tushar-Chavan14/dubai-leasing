import { SystemClock } from "@platform/kernel";
import { loadSpaEnv } from "@spa/core/env";
import { createOqoodMock } from "./app.ts";
import { bootstrap, createMockDatabase, seed } from "./db.ts";

/**
 * Simulated Oqood and trustee registry (demo), docs/spa/architecture.md §9. Its registry lives in the `oqood_mock`
 * schema of the SPA database (migrated on start). Never use DLD logos, colours or screen copies. Reads only
 * `.env.spa.local` (S25).
 */
const env = loadSpaEnv();
const mockUrl = new URL(env.REGISTRY_MOCK_URL);
const port = Number(mockUrl.port || 4101);
// No authentication: listen only on the host the SPA engine uses (localhost by default).
const hostname = mockUrl.hostname === "localhost" ? "127.0.0.1" : mockUrl.hostname;
const { db } = createMockDatabase(env.SPA_DATABASE_URL);
await bootstrap(db);
await seed(db);

const app = createOqoodMock({
  db,
  clock: new SystemClock(),
  failureRate: env.REGISTRY_MOCK_FAILURE_RATE,
  demoMode: env.SPA_DEMO_MODE,
});

Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`simulated Oqood (demo) on :${port} (failure rate ${env.REGISTRY_MOCK_FAILURE_RATE})`);
