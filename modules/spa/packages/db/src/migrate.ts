import { fileURLToPath } from "node:url";
import { loadSpaEnv } from "@spa/core/env";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createSpaDatabase, type SpaDatabase } from "./client.ts";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

export async function runSpaMigrations(database: SpaDatabase): Promise<void> {
  await migrate(database.db, { migrationsFolder });
}

if (import.meta.main) {
  const env = loadSpaEnv();
  const database = createSpaDatabase(env.SPA_DATABASE_URL, { max: 1 });
  await runSpaMigrations(database);
  await database.close();
  console.log("spa migrations applied");
}
