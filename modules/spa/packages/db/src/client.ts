import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.ts";

export type SpaSchema = typeof schema;
export type SpaDb = NodePgDatabase<SpaSchema>;

export interface SpaDatabase {
  pool: Pool;
  db: SpaDb;
  close(): Promise<void>;
}

/** A connection to the `spa` database only (S2). */
export function createSpaDatabase(url: string, opts: { max?: number } = {}): SpaDatabase {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 10 });
  return { pool, db: drizzle(pool, { schema }), close: () => pool.end() };
}
