import { loadEnv, SystemClock } from "@leasing/core";
import { createEjariMock } from "./app.ts";
import { bootstrap, createMockDatabase, seed } from "./db.ts";

/**
 * Simulated Ejari (demo), docs/architecture.md §9. Its registry lives in the `ejari_mock`
 * schema of the local database (migrated on start). Never use DLD logos, colours or screen copies.
 */
const env = loadEnv();
const mockUrl = new URL(env.EJARI_MOCK_URL);
const port = Number(mockUrl.port || 4100);
// No authentication: listen only on the host the engine uses (localhost by default).
const hostname = mockUrl.hostname === "localhost" ? "127.0.0.1" : mockUrl.hostname;
const { db } = createMockDatabase(env.DATABASE_URL);
await bootstrap(db);
await seed(db);

const app = createEjariMock({
  db,
  clock: new SystemClock(),
  failureRate: env.MOCK_EJARI_FAILURE_RATE,
  demoMode: env.DEMO_MODE,
});

Bun.serve({ port, hostname, fetch: app.fetch });
console.log(`simulated Ejari (demo) on :${port} (failure rate ${env.MOCK_EJARI_FAILURE_RATE})`);
