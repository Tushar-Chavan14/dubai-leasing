import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { EjariUnavailableError, HttpEjariClient } from "@leasing/adapters";
import { type CalendarDate, type EjariPayload, FixedClock, luhnCheckDigit } from "@leasing/core";
import { PDFDocument } from "pdf-lib";
import { Pool } from "pg";
import { createEjariMock } from "../src/app.ts";
import { bootstrap, reset } from "../src/db.ts";

const DB_URL = process.env.TEST_DATABASE_URL;
const noDb = !DB_URL;
let pool: Pool;
const clock = new FixedClock(new Date("2026-11-01T04:00:00Z"));
const d = (s: string) => s as CalendarDate;
const eid = (year: string, serial: string) => `784-${year}-${serial}-${luhnCheckDigit(`784${year}${serial}`)}`;

const priya = (over: Partial<EjariPayload> = {}): EjariPayload => ({
  tenantNameEn: "Priya Example Rao",
  tenantIdType: "emirates_id",
  tenantIdNo: eid("1991", "4820193"),
  tenantIdExpiresOn: d("2029-08-14"),
  tenantNationality: "IND",
  landlordNameEn: "Fictional Holdings LLC",
  landlordIdNo: null,
  propertyUsage: "residential",
  dldPropertyNo: "DEMO-DLD-000412",
  unitNo: "412",
  makaniNo: "2222233333",
  plotNo: null,
  startOn: d("2026-12-01"),
  endOn: d("2027-11-30"),
  annualRentFils: 7_400_000,
  cheques: 4,
  depositFils: 370_000,
  ...over,
});

function client(opts: { failureRate?: number; demoMode?: boolean } = {}) {
  const app = createEjariMock({
    pool,
    clock,
    failureRate: opts.failureRate ?? 0,
    random: () => 0.5,
    demoMode: opts.demoMode ?? true,
  });
  return { app, ejari: new HttpEjariClient({ baseUrl: "http://ejari.test", fetch: async (r) => app.fetch(r) }) };
}
let n = 0;
const rid = () => `request-${++n}-${Math.random().toString(36).slice(2)}`;

describe.skipIf(noDb)("simulated Ejari", () => {
  beforeAll(async () => {
    if (!/test/.test(new URL(DB_URL!).pathname)) throw new Error("TEST_DATABASE_URL must name a *test* database");
    pool = new Pool({ connectionString: DB_URL, max: 3 });
    await pool.query("SET client_min_messages = warning; DROP SCHEMA IF EXISTS ejari_mock CASCADE");
    await bootstrap(pool);
    await bootstrap(pool); // a second start changes nothing
  });
  beforeEach(async () => {
    await reset(pool);
  });

  test("registers a matching contract once, even when the request is repeated", async () => {
    const { ejari } = client();
    const id = rid();
    const r = await ejari.register(priya(), { requestId: id });
    expect(r).toMatchObject({ ok: true, issuedOn: "2026-11-01" });
    if (!r.ok) throw new Error("expected issued");
    expect(r.ejariNo).toMatch(/^SIM-2026-\d{7}$/);
    expect(await ejari.register(priya(), { requestId: id })).toEqual(r);
    // Registrations seeded for the engine's imported demo leases don't count.
    const count = await pool.query(
      "SELECT count(*)::int AS n FROM ejari_mock.registrations WHERE NOT payload ? 'prior'",
    );
    expect(count.rows[0].n).toBe(1);
    expect(await ejari.status(r.ejariNo)).toEqual({ state: "active" });
    const pdf = await ejari.certificate(r.ejariNo);
    expect(new TextDecoder().decode(pdf.slice(0, 5))).toBe("%PDF-");
    expect((await PDFDocument.load(pdf)).getTitle()).toBe(`Simulated tenancy registration ${r.ejariNo}`);
  });

  test("names are compared exactly: capitals are a NAME_MISMATCH without naming the field", async () => {
    const { ejari } = client();
    const r = await ejari.register(
      priya({
        tenantNameEn: "LENA TESTOVA",
        tenantIdType: "passport",
        tenantIdNo: "UT2048611",
        tenantIdExpiresOn: d("2031-01-01"),
      }),
      { requestId: rid() },
    );
    expect(r).toEqual({
      ok: false,
      reasons: [
        {
          code: "NAME_MISMATCH",
          field: null,
          message: "The tenant name does not match the name on record for this identity document.",
        },
      ],
    });
    const fixed = await ejari.register(
      priya({ tenantNameEn: "Lena Testova", tenantIdType: "passport", tenantIdNo: "UT2048611" }),
      { requestId: rid() },
    );
    expect(fixed.ok).toBe(true);
  });

  test("each check rejects with its own code", async () => {
    const { ejari } = client();
    const codes = async (p: EjariPayload) => {
      const r = await ejari.register(p, { requestId: rid() });
      return r.ok ? [] : r.reasons.map((x) => x.code);
    };
    expect(await codes(priya({ dldPropertyNo: "DEMO-DLD-999999" }))).toEqual(["PROPERTY_NOT_FOUND"]);
    expect(await codes(priya({ makaniNo: "2222233334" }))).toEqual(["PROPERTY_DATA_MISMATCH"]);
    expect(await codes(priya({ propertyUsage: "commercial" }))).toEqual(["PROPERTY_DATA_MISMATCH"]);
    expect(await codes(priya({ landlordNameEn: "Fictional Holdings" }))).toEqual(["LANDLORD_MISMATCH"]);
    expect(await codes(priya({ tenantIdNo: "784-1991-4820193-0" }))).toEqual(["INVALID_ID"]);
    expect(await codes(priya({ tenantIdType: "passport", tenantIdNo: "X0000000" }))).toEqual(["TENANT_NOT_FOUND"]);
    expect(await codes(priya({ startOn: d("2033-01-01"), endOn: d("2033-12-31") }))).toEqual(["ID_EXPIRED"]);
    expect(await codes(priya({ endOn: d("2026-12-01") }))).toEqual(["INVALID_PERIOD"]);
    expect(await codes(priya({ depositFils: 8_000_000 }))).toEqual(["INVALID_AMOUNT"]);
  });

  test("an overlapping registration on the property is refused until it is cancelled", async () => {
    const { ejari } = client();
    const first = await ejari.register(priya(), { requestId: rid() });
    if (!first.ok) throw new Error("expected issued");
    const omar = priya({
      tenantNameEn: "Omar Sample Haddad",
      tenantIdNo: eid("1986", "7310452"),
      startOn: d("2027-06-01"),
      endOn: d("2028-05-31"),
    });
    const second = await ejari.register(omar, { requestId: rid() });
    expect(second.ok ? [] : second.reasons.map((r) => r.code)).toEqual(["ACTIVE_REGISTRATION_EXISTS"]);
    expect(await ejari.cancel(first.ejariNo, "tenant moved out")).toEqual({ ok: true });
    expect(await ejari.status(first.ejariNo)).toEqual({ state: "cancelled" });
    expect((await ejari.register(omar, { requestId: rid() })).ok).toBe(true);
    expect(await ejari.status("SIM-2026-9999999")).toEqual({ state: "unknown" });
  });

  test("renewal issues a new number and closes the old one", async () => {
    const { ejari } = client();
    const first = await ejari.register(priya(), { requestId: rid() });
    if (!first.ok) throw new Error("expected issued");
    const next = await ejari.renew(first.ejariNo, priya({ startOn: d("2027-12-01"), endOn: d("2028-11-30") }), {
      requestId: rid(),
    });
    expect(next.ok).toBe(true);
    expect(await ejari.status(first.ejariNo)).toEqual({ state: "cancelled" });
  });

  test("an outage is a 503 the client reports as 'unavailable', never as a rejection", async () => {
    const { ejari } = client({ failureRate: 1 });
    await expect(ejari.register(priya(), { requestId: rid() })).rejects.toBeInstanceOf(EjariUnavailableError);
    const unreachable = new HttpEjariClient({
      baseUrl: "http://ejari.test",
      fetch: () => Promise.reject(new Error("connection refused")),
    });
    await expect(unreachable.register(priya(), { requestId: rid() })).rejects.toBeInstanceOf(EjariUnavailableError);
    const rows = await pool.query("SELECT outcome FROM ejari_mock.submissions");
    expect(rows.rows.map((r) => r.outcome)).toEqual(["unavailable"]);
  });

  test("demo console: the next submission is rejected once (demo mode only); a replay keeps its first answer", async () => {
    const { app, ejari } = client();
    const off = client({ demoMode: false });
    const post = (a: typeof app) =>
      a.fetch(new Request("http://ejari.test/api/v1/demo/reject-next", { method: "POST" }));
    expect((await post(off.app)).status).toBe(403);
    expect((await post(app)).status).toBe(200);
    const id = rid();
    const first = await ejari.register(priya(), { requestId: id });
    expect(first).toMatchObject({ ok: false, reasons: [{ code: "NAME_MISMATCH" }] });
    expect(await ejari.register(priya(), { requestId: id })).toEqual(first);
    expect(await ejari.register(priya(), { requestId: rid() })).toMatchObject({ ok: true });
  });

  test("the page says it is simulated; reset only in demo mode", async () => {
    const { app, ejari } = client();
    await ejari.register(priya(), { requestId: rid() });
    const html = await (await app.fetch(new Request("http://ejari.test/"))).text();
    expect(html).toContain("Simulated Ejari (demo)");
    expect(html).toContain("not connected to the Dubai Land Department");
    expect(html).toContain("Priya Example Rao");
    const off = client({ demoMode: false });
    expect((await off.app.fetch(new Request("http://ejari.test/api/v1/demo/reset", { method: "POST" }))).status).toBe(
      403,
    );
    const bad = await app.fetch(
      new Request("http://ejari.test/api/v1/registrations", {
        method: "POST",
        body: JSON.stringify({ requestId: "x" }),
      }),
    );
    expect(bad.status).toBe(400);
  });
});
