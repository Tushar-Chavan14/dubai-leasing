import { fileURLToPath } from "node:url";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.ts";
import { personRecords, registrations, submissions, titleDeeds, trusteeBookings, unitRecords } from "./schema.ts";

export type MockDb = NodePgDatabase<typeof schema>;

export interface MockDatabase {
  db: MockDb;
  close(): Promise<void>;
}

export function createMockDatabase(url: string, opts: { max?: number } = {}): MockDatabase {
  const pool = new Pool({ connectionString: url, max: opts.max ?? 4 });
  return { db: drizzle(pool, { schema }), close: () => pool.end() };
}

const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Applies this service's migrations (safe on every start), tracked inside `oqood_mock`, apart from the engine's. */
export async function bootstrap(db: MockDb): Promise<void> {
  await migrate(db, { migrationsFolder, migrationsSchema: "oqood_mock" });
}

/** The engine's demo developer (`seed.ts`), and fictional units (all invented; none is a real project or deed). */
export const DEMO_DEVELOPER = "Fictional Developments LLC";
const UNITS: [unitNo: string, projectCode: string][] = [
  ["U-101", "P-DEMO-1"],
  ["U-102", "P-DEMO-1"],
  ["U-103", "P-DEMO-1"],
  ["A-101", "P-DEMO-1"],
  ["A-102", "P-DEMO-1"],
];

/**
 * Simulated identity records. The registry compares names exactly as written. The two placeholders are what the
 * engine's demo seed stores in a party's document number.
 */
export const DEMO_PEOPLE: [idNo: string, name: string][] = [
  ["[PASSPORT NO.]", "Sample Buyer One"],
  ["Z1111111", "Buyer One"],
  ["Z2222222", "Buyer Two"],
  ["Z3333333", "Priya Example Rao"],
];

/** Resale units that already have an owner on record (a title deed or an Oqood holder). */
const DEEDS: [titleDeedNo: string, unitNo: string, owners: string[]][] = [
  ["[TITLE DEED NO.]", "A-101", ["Sample Owner One", "Sample Owner Two"]],
  ["TD-FICT-1", "A-102", ["Seller One"]],
];

/** Seeds the demo registry (idempotent). */
export async function seed(db: MockDb): Promise<void> {
  await db
    .insert(unitRecords)
    .values(UNITS.map(([unitNo, projectCode]) => ({ unitNo, projectCode, developerName: DEMO_DEVELOPER })))
    .onConflictDoNothing();
  await db
    .insert(personRecords)
    .values(DEMO_PEOPLE.map(([idNo, nameEn]) => ({ idNo, nameEn, expiresOn: "2032-12-31" })))
    .onConflictDoNothing();
  await db
    .insert(titleDeeds)
    .values(DEEDS.map(([titleDeedNo, unitNo, owners]) => ({ titleDeedNo, unitNo, owners })))
    .onConflictDoNothing();
}

/** Demo only: empties the registry and seeds it again. */
export async function reset(db: MockDb): Promise<void> {
  await db.execute(
    sql`TRUNCATE ${trusteeBookings}, ${registrations}, ${submissions}, ${titleDeeds}, ${personRecords}, ${unitRecords}`,
  );
  for (const s of ["oqd_seq", "trf_seq", "td_seq"]) await db.execute(sql.raw(`ALTER SEQUENCE oqood_mock.${s} RESTART`));
  await seed(db);
}
