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

/** One transaction on one connection: every SpaManager write and its event commit or roll back together. */
export interface SpaTx {
  db: SpaDb;
}

export async function withSpaTx<T>(database: SpaDatabase, fn: (tx: SpaTx) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn({ db: drizzle(client, { schema }) });
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
