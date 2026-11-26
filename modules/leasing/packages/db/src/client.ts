import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";
import * as schema from "./schema.ts";

export type Schema = typeof schema;
export type Db = NodePgDatabase<Schema>;

/** A transaction: Drizzle on a single pooled connection, plus raw SQL for pg-boss `db` option. */
export interface Tx {
  db: Db;
  /** Pass to pg-boss `send(..., { db: tx.boss })` so jobs enqueue in the same transaction. */
  boss: { executeSql(text: string, values?: unknown[]): Promise<{ rows: unknown[] }> };
}

export interface Database {
  pool: Pool;
  db: Db;
  close(): Promise<void>;
}

// Return `date` columns as plain "YYYY-MM-DD" strings (never JS Dates that shift with TZ).
types.setTypeParser(1082, (v) => v);

export function createDatabase(url: string, opts: { max?: number } = {}): Database {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 10 });
  const db = drizzle(pool, { schema });
  return { pool, db, close: () => pool.end() };
}

/**
 * Runs `fn` in one transaction on one connection. Drizzle writes and pg-boss sends made with
 * `tx.boss` commit or roll back together.
 */
export async function withTx<T>(database: Database, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await database.pool.connect();
  try {
    await client.query("BEGIN");
    const tx: Tx = {
      db: drizzle(client, { schema }),
      boss: { executeSql: (text, values) => client.query(text, values as unknown[]) },
    };
    const result = await fn(tx);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
