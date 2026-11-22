import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export interface PortalDatabase {
  pool: Pool;
  db: ReturnType<typeof drizzle<typeof schema>>;
  close(): Promise<void>;
}

/** A connection to the `portal` database only. */
export function createPortalDatabase(url: string, opts: { max?: number } = {}): PortalDatabase {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 5 });
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}

export const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));
export const runPortalMigrations = (d: PortalDatabase) => migrate(d.db, { migrationsFolder });

let shared: PortalDatabase | null = null;
/** One pool per server process. */
export function portalDatabase(url: string): PortalDatabase {
  shared ??= createPortalDatabase(url);
  return shared;
}
