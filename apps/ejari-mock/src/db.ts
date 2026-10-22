import { luhnCheckDigit } from "@leasing/core";
import type { Pool, PoolClient } from "pg";

/**
 * The simulated registry keeps its data in its own Postgres schema, `ejari_mock`, in the same
 * local database as the engine (decision D22). The engine never reads these tables: it only
 * talks to this service over HTTP, as it will with the real registry.
 */
export const SCHEMA_SQL = `
CREATE SCHEMA IF NOT EXISTS ejari_mock;
CREATE SEQUENCE IF NOT EXISTS ejari_mock.ejari_seq;
CREATE TABLE IF NOT EXISTS ejari_mock.properties (
  dld_property_no text PRIMARY KEY,
  unit_no text NOT NULL,
  makani_no text NOT NULL,
  plot_no text,
  usage text NOT NULL DEFAULT 'residential',
  owner_name text NOT NULL
);
CREATE TABLE IF NOT EXISTS ejari_mock.icp_people (
  id_no text PRIMARY KEY,
  id_type text NOT NULL,
  name_en text NOT NULL,
  nationality text,
  expires_on date NOT NULL
);
CREATE TABLE IF NOT EXISTS ejari_mock.registrations (
  ejari_no text PRIMARY KEY,
  dld_property_no text NOT NULL,
  tenant_id_no text NOT NULL,
  tenant_name text NOT NULL,
  landlord_name text NOT NULL,
  start_on date NOT NULL,
  end_on date NOT NULL,
  annual_rent_fils bigint NOT NULL,
  state text NOT NULL DEFAULT 'active',
  payload jsonb NOT NULL,
  issued_on date NOT NULL,
  cancelled_on date,
  cancel_reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ejari_mock.submissions (
  id bigserial PRIMARY KEY,
  request_id text UNIQUE,
  kind text NOT NULL,
  outcome text NOT NULL,
  ejari_no text,
  reasons jsonb NOT NULL DEFAULT '[]',
  payload jsonb NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
`;

/** Creates the schema and tables if missing. Safe to run on every start. */
export async function bootstrap(pool: Pool): Promise<void> {
  await pool.query(`SET client_min_messages = warning; ${SCHEMA_SQL}`);
}

const OWNER = "Fictional Holdings LLC";

/** Demo units, matching the engine's demo seed (all fictional). */
const PROPERTIES: [dld: string, unit: string, makani: string][] = [
  ["DEMO-DLD-001204", "1204", "1111122222"],
  ["DEMO-DLD-000807", "807", "1111133333"],
  ["DEMO-DLD-000310", "310", "2222211111"],
  ["DEMO-DLD-001608", "1608", "1111144444"],
  ["DEMO-DLD-000412", "412", "2222233333"],
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
  ];
}

/** Seeds the demo properties and people (idempotent). */
export async function seed(pool: Pool | PoolClient): Promise<void> {
  for (const [dld, unit, makani] of PROPERTIES) {
    await pool.query(
      `INSERT INTO ejari_mock.properties (dld_property_no, unit_no, makani_no, owner_name) VALUES ($1, $2, $3, $4)
       ON CONFLICT (dld_property_no) DO NOTHING`,
      [dld, unit, makani, OWNER],
    );
  }
  for (const [idNo, type, name, nationality] of demoPeople()) {
    await pool.query(
      `INSERT INTO ejari_mock.icp_people (id_no, id_type, name_en, nationality, expires_on) VALUES ($1, $2, $3, $4, '2032-12-31')
       ON CONFLICT (id_no) DO NOTHING`,
      [idNo, type, name, nationality],
    );
  }
}

/** Demo only: empties the registry and seeds it again. */
export async function reset(pool: Pool): Promise<void> {
  await pool.query(
    "TRUNCATE ejari_mock.registrations, ejari_mock.submissions, ejari_mock.properties, ejari_mock.icp_people",
  );
  await pool.query("ALTER SEQUENCE ejari_mock.ejari_seq RESTART");
  await seed(pool);
}
