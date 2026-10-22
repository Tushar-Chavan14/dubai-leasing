import { fileURLToPath } from "node:url";
import { loadEnv } from "@leasing/core";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDatabase, type Database } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runMigrations(database: Database): Promise<void> {
  await migrate(database.db, { migrationsFolder });
}

if (import.meta.main) {
  const env = loadEnv();
  const database = createDatabase(env.DATABASE_URL, { max: 1 });
  await runMigrations(database);
  await database.close();
  console.log("migrations applied");
}
