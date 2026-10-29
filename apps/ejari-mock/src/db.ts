import { fileURLToPath } from "node:url";
import { DEMO_COMPANY_LEGAL, DEMO_PROPERTIES, luhnCheckDigit } from "@leasing/core";
import { sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "./schema.ts";
import { icpPeople, properties, registrations, submissions } from "./schema.ts";

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

/**
 * Applies this service's migrations. Safe to run on every start. They are tracked inside
 * `ejari_mock`, apart from the engine's, so the two never touch each other's history.
 */
export async function bootstrap(db: MockDb): Promise<void> {
  await migrate(db, { migrationsFolder, migrationsSchema: "ejari_mock" });
}

/** The registered owner of a demo unit: its company's legal name (D44), as the engine's demo seed writes it. */
const ownerOf = (companySlug: string) => DEMO_COMPANY_LEGAL[companySlug]!.legalNameEn;
const OWNER_BY_DLD = new Map(DEMO_PROPERTIES.map(([dld, , , company]) => [dld, ownerOf(company)]));

/** Demo units: the same list the engine's demo seed builds its units from (all fictional). */
const PROPERTIES = DEMO_PROPERTIES;

/**
 * Registrations of the engine's imported demo leases (made before the demo, so the registry
 * knows them and a move-out can cancel them). Dates aren't tracked for these.
 */
const PRIOR_REGISTRATIONS: [ejariNo: string, dld: string, eidSerial: string, tenant: string][] = [
  ["DEMO-EJ-0001204", "DEMO-DLD-001204", "1000001", "Sara Example Khan"],
  ["DEMO-EJ-0000807", "DEMO-DLD-000807", "1000002", "Rami Sample Nasser"],
  ["DEMO-EJ-0000310", "DEMO-DLD-000310", "1000003", "Mina Test Varghese"],
  ["DEMO-EJ-0002205", "DEMO-DLD-002205", "1000004", "Noor Demo Haddad"],
];

const eid = (year: string, serial: string) => {
  const body = `784${year}${serial}`;
  return `784-${year}-${serial}-${luhnCheckDigit(body)}`;
};

/**
 * Simulated identity records (the registry checks names against these, exactly as written).
 * The KYC specimen people and the demo tenants; names in the spelling an ID card prints.
 */
export function demoPeople(): [idNo: string, type: "emirates_id" | "passport", name: string, nationality: string][] {
  return [
    [eid("1991", "4820193"), "emirates_id", "Priya Example Rao", "IND"],
    ["Z1234567", "passport", "Priya Example Rao", "IND"],
    [eid("1986", "7310452"), "emirates_id", "Omar Sample Haddad", "JOR"],
    ["Q7654321", "passport", "Omar Sample Haddad", "JOR"],
    [eid("1995", "1209384"), "emirates_id", "Lena Testova", "UTO"],
    ["UT2048611", "passport", "Lena Testova", "UTO"],
    [eid("1979", "5561027"), "emirates_id", "Daniel Specimen Moyo", "ZWE"],
    ["FN908172", "passport", "Daniel Specimen Moyo", "ZWE"],
    [eid("1900", "1000001"), "emirates_id", "Sara Example Khan", "Fictionland"],
    [eid("1900", "1000002"), "emirates_id", "Rami Sample Nasser", "Fictionland"],
    [eid("1900", "1000003"), "emirates_id", "Mina Test Varghese", "Fictionland"],
    [eid("1900", "1000004"), "emirates_id", "Noor Demo Haddad", "Fictionland"],
  ];
}

/** Seeds the demo properties and people (idempotent). */
export async function seed(db: MockDb): Promise<void> {
  await db
    .insert(properties)
    .values(
      PROPERTIES.map(([dldPropertyNo, unitNo, makaniNo, company]) => ({
        dldPropertyNo,
        unitNo,
        makaniNo,
        ownerName: ownerOf(company),
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(icpPeople)
    .values(
      demoPeople().map(([idNo, idType, nameEn, nationality]) => ({
        idNo,
        idType,
        nameEn,
        nationality,
        expiresOn: "2032-12-31",
      })),
    )
    .onConflictDoNothing();
  await db
    .insert(registrations)
    .values(
      PRIOR_REGISTRATIONS.map(([ejariNo, dldPropertyNo, serial, tenantName]) => ({
        ejariNo,
        dldPropertyNo,
        tenantIdNo: eid("1900", serial),
        tenantName,
        landlordName: OWNER_BY_DLD.get(dldPropertyNo)!,
        startOn: "2000-01-01",
        endOn: "2099-12-31",
        annualRentFils: 0,
        payload: { prior: true as const },
        issuedOn: "2000-01-01",
      })),
    )
    .onConflictDoNothing();
}

/** Demo only: empties the registry and seeds it again. */
export async function reset(db: MockDb): Promise<void> {
  await db.execute(sql`TRUNCATE ${registrations}, ${submissions}, ${properties}, ${icpPeople}`);
  await db.execute(sql`ALTER SEQUENCE ejari_mock.ejari_seq RESTART`);
  await seed(db);
}
