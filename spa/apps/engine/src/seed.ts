import { newId } from "@platform/kernel";
import { databaseName, loadSpaEnv, type SpaEnv } from "@spa/core/env";
import { createSpaDatabase, type SpaDatabase, spaDemoSettings, spaUsers } from "@spa/db";
import { DEMO_USERS } from "./seed-data.ts";

/**
 * `bun run spa:demo:seed`: the demo users (one per role) and the demo clock row. Demo mode only. Demo users have no
 * password: they sign in from the demo picker, like leasing's demo login (S33). Safe to run twice.
 */
export async function seedSpaDemo(database: SpaDatabase): Promise<void> {
  for (const u of DEMO_USERS) {
    await database.db
      .insert(spaUsers)
      .values({ id: newId(), ...u, email: u.email.toLowerCase() })
      .onConflictDoUpdate({ target: spaUsers.email, set: { name: u.name, role: u.role, active: true } });
  }
  await database.db.insert(spaDemoSettings).values({ id: 1, clockOffsetMs: 0 }).onConflictDoNothing();
}

/** Seed and reset touch only a database named like the SPA one, never leasing's. Returns its name. */
export function requireSpaDatabase(url: string): string {
  const name = databaseName(url) ?? "";
  if (!/spa/.test(name) || /leasing/.test(name)) throw new Error(`refusing to use database "${name}": not the SPA one`);
  return name;
}

export function requireDemo(env: SpaEnv): void {
  if (!env.SPA_DEMO_MODE) throw new Error("SPA_DEMO_MODE must be true to seed or reset demo data");
}

if (import.meta.main) {
  const env = loadSpaEnv();
  requireDemo(env);
  requireSpaDatabase(env.SPA_DATABASE_URL);
  const database = createSpaDatabase(env.SPA_DATABASE_URL, { max: 1 });
  await seedSpaDemo(database);
  await database.close();
  console.log(`seeded ${DEMO_USERS.length} demo users and the demo clock`);
}
