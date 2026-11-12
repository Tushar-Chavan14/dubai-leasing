import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { EjariUnavailableError, HttpEjariClient } from "@leasing/adapters";
import { type CalendarDate, DEMO_COMPANY_LEGAL, type EjariPayload, FixedClock, luhnCheckDigit } from "@leasing/core";
import { PDFDocument } from "pdf-lib";
import { count, sql } from "drizzle-orm";
import { createEjariMock } from "../src/app.ts";
import { CERTIFICATE_WORDING } from "../src/certificate.ts";
import { bootstrap, createMockDatabase, type MockDb, reset } from "../src/db.ts";
import { registrations, submissions } from "../src/schema.ts";

const DB_URL = process.env.TEST_DATABASE_URL;
const noDb = !DB_URL;
let db: MockDb;
const clock = new FixedClock(new Date("2026-11-01T04:00:00Z"));
const d = (s: string) => s as CalendarDate;
const eid = (year: string, serial: string) => `784-${year}-${serial}-${luhnCheckDigit(`784${year}${serial}`)}`;

const priya = (over: Partial<EjariPayload> = {}): EjariPayload => ({
  tenantNameEn: "Priya Example Rao",
  tenantIdType: "emirates_id",
  tenantIdNo: eid("1991", "4820193"),
  tenantIdExpiresOn: d("2029-08-14"),
  tenantNationality: "IND",
  // D44: the registered owner of a demo unit is its company's legal name.
  landlordNameEn: DEMO_COMPANY_LEGAL.silverline!.legalNameEn,
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
    db,
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
    db = createMockDatabase(DB_URL!, { max: 3 }).db;
    await db.execute(sql`SET client_min_messages = warning; DROP SCHEMA IF EXISTS ejari_mock CASCADE`);
    await bootstrap(db);
    await bootstrap(db); // a second start changes nothing
  });
  beforeEach(async () => {
    await reset(db);
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
    const [issued] = await db
      .select({ n: count() })
      .from(registrations)
      .where(sql`NOT ${registrations.payload} ? 'prior'`);
    expect(issued!.n).toBe(1);
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
    expect(await codes(priya({ landlordNameEn: "Silverline Properties" }))).toEqual(["LANDLORD_MISMATCH"]);
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
    const rows = await db.select({ outcome: submissions.outcome }).from(submissions);
    expect(rows.map((r) => r.outcome)).toEqual(["unavailable"]);
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

  describe("simulated Tawtheeq (Abu Dhabi)", () => {
    const twq = (opts: { demoMode?: boolean } = {}) => {
      const app = createEjariMock({ db, clock, failureRate: 0, random: () => 0.5, demoMode: opts.demoMode ?? true });
      const fetcher = async (r: Request) => app.fetch(r);
      return {
        app,
        ejari: new HttpEjariClient({ baseUrl: "http://ejari.test", fetch: fetcher }),
        tawtheeq: new HttpEjariClient({ baseUrl: "http://ejari.test", fetch: fetcher, pathPrefix: "/tawtheeq" }),
      };
    };
    // The seeded Abu Dhabi demo apartment (AUH-0101) and its sibling office.
    const abuDhabi = (over: Partial<EjariPayload> = {}) =>
      priya({ dldPropertyNo: "DEMO-AUH-002101", unitNo: "2101", makaniNo: "DEMO-ADDR-AUH-0101", ...over });

    test("the same requestId on the Ejari and Tawtheeq routes is not replayed across systems", async () => {
      const { ejari, tawtheeq } = twq();
      const id = rid();
      const e = await ejari.register(priya(), { requestId: id });
      const t = await tawtheeq.register(abuDhabi(), { requestId: id });
      if (!e.ok || !t.ok) throw new Error(`expected both issued: ${JSON.stringify({ e, t })}`);
      expect(e.ejariNo).toMatch(/^SIM-2026-/);
      expect(t.ejariNo).toMatch(/^SIM-TWQ-2026-/);
      expect(await tawtheeq.register(abuDhabi(), { requestId: id })).toEqual(t);
    });

    test("issues SIM-TWQ numbers, replays a repeated request and serves a simulated certificate", async () => {
      const { tawtheeq } = twq();
      const id = rid();
      const r = await tawtheeq.register(abuDhabi(), { requestId: id });
      if (!r.ok) throw new Error(`expected issued: ${JSON.stringify(r)}`);
      expect(r.ejariNo).toMatch(/^SIM-TWQ-2026-\d{7}$/);
      expect(await tawtheeq.register(abuDhabi(), { requestId: id })).toEqual(r);
      expect(await tawtheeq.status(r.ejariNo)).toEqual({ state: "active" });
      const pdf = await tawtheeq.certificate(r.ejariNo);
      const doc = await PDFDocument.load(pdf, { updateMetadata: false });
      expect(doc.getProducer()).toBe("Simulated Tawtheeq (demo)");
      // The drawn wording (PDF streams are compressed, so the strings are checked at their source).
      expect(CERTIFICATE_WORDING.tawtheeq).toEqual({
        title: "Tenancy contract registration (simulated Tawtheeq)",
        subline: "Demo service for testing. It is not connected to any Abu Dhabi government system.",
        watermark: "SIMULATED - NOT ISSUED BY ANY ABU DHABI AUTHORITY",
        producer: "Simulated Tawtheeq (demo)",
      });
    });

    test("checks the property for Tawtheeq as for Ejari", async () => {
      const { tawtheeq } = twq();
      const unknown = await tawtheeq.register(abuDhabi({ dldPropertyNo: "AD-PROP-1" }), { requestId: rid() });
      expect(unknown.ok ? [] : unknown.reasons.map((r) => r.code)).toEqual(["PROPERTY_NOT_FOUND"]);
      const wrongUnit = await tawtheeq.register(abuDhabi({ unitNo: "9" }), { requestId: rid() });
      expect(wrongUnit.ok ? [] : wrongUnit.reasons.map((r) => r.code)).toEqual(["PROPERTY_DATA_MISMATCH"]);
    });

    test("overlap is per system: an Ejari registration doesn't block Tawtheeq, and vice versa", async () => {
      const { ejari, tawtheeq } = twq();
      expect((await ejari.register(priya(), { requestId: rid() })).ok).toBe(true);
      // Same property number, same period, in Tawtheeq.
      expect((await tawtheeq.register(priya(), { requestId: rid() })).ok).toBe(true);
      // A second one in Tawtheeq overlaps the first; so does a second one in Ejari.
      const t2 = await tawtheeq.register(priya(), { requestId: rid() });
      expect(t2.ok ? [] : t2.reasons.map((r) => r.code)).toEqual(["ACTIVE_REGISTRATION_EXISTS"]);
      const e2 = await ejari.register(priya(), { requestId: rid() });
      expect(e2.ok ? [] : e2.reasons.map((r) => r.code)).toEqual(["ACTIVE_REGISTRATION_EXISTS"]);
    });

    test("reject-next is per system", async () => {
      const { app, ejari, tawtheeq } = twq();
      const post = (path: string, body?: unknown) =>
        app.fetch(
          new Request(`http://ejari.test${path}`, { method: "POST", ...(body ? { body: JSON.stringify(body) } : {}) }),
        );
      expect((await post("/tawtheeq/api/v1/demo/reject-next")).status).toBe(200);
      // Ejari is not affected.
      expect(await ejari.register(priya(), { requestId: rid() })).toMatchObject({ ok: true });
      expect(await tawtheeq.register(abuDhabi(), { requestId: rid() })).toMatchObject({
        ok: false,
        reasons: [{ code: "NAME_MISMATCH" }],
      });
      expect(await tawtheeq.register(abuDhabi(), { requestId: rid() })).toMatchObject({ ok: true });
      // The root path takes the system in the body.
      expect((await post("/api/v1/demo/reject-next", { system: "tawtheeq" })).status).toBe(200);
      expect(
        await tawtheeq.register(
          abuDhabi({
            dldPropertyNo: "DEMO-AUH-002102",
            unitNo: "2102",
            makaniNo: "DEMO-ADDR-AUH-0201",
            propertyUsage: "commercial",
          }),
          { requestId: rid() },
        ),
      ).toMatchObject({
        ok: false,
        reasons: [{ code: "NAME_MISMATCH" }],
      });
    });

    test("a number of one system is 404 on the other system's routes", async () => {
      const { app } = twq();
      const get = (path: string) => app.fetch(new Request(`http://ejari.test${path}`));
      const post = (path: string) =>
        app.fetch(
          new Request(`http://ejari.test${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ reason: "test cancel" }),
          }),
        );
      const { tawtheeq, ejari } = twq();
      const t = await tawtheeq.register(
        abuDhabi({
          dldPropertyNo: "DEMO-AUH-002102",
          unitNo: "2102",
          makaniNo: "DEMO-ADDR-AUH-0201",
          propertyUsage: "commercial",
        }),
        { requestId: rid() },
      );
      const e = await ejari.register(priya({ dldPropertyNo: "DEMO-DLD-000413", unitNo: "413" }), { requestId: rid() });
      if (!t.ok) throw new Error("expected issued");
      const tNo = t.ejariNo;
      expect((await get(`/api/v1/registrations/${tNo}`)).status).toBe(404);
      expect((await get(`/api/v1/registrations/${tNo}/certificate.pdf`)).status).toBe(404);
      expect((await post(`/api/v1/registrations/${tNo}/cancel`)).status).toBe(404);
      expect((await post(`/api/v1/registrations/${tNo}/renew`)).status).toBe(404);
      expect((await get(`/tawtheeq/api/v1/registrations/${tNo}`)).status).toBe(200);
      if (e.ok) {
        expect((await get(`/tawtheeq/api/v1/registrations/${e.ejariNo}`)).status).toBe(404);
        expect((await get(`/tawtheeq/api/v1/registrations/${e.ejariNo}/certificate.pdf`)).status).toBe(404);
        expect((await post(`/tawtheeq/api/v1/registrations/${e.ejariNo}/cancel`)).status).toBe(404);
      }
    });

    test("the page lists both systems, labelled simulated", async () => {
      const { app, tawtheeq } = twq();
      await tawtheeq.register(abuDhabi(), { requestId: rid() });
      const html = await (await app.fetch(new Request("http://ejari.test/"))).text();
      expect(html).toContain("Tawtheeq (simulated)");
      expect(html).toContain("not connected to any Abu Dhabi government system");
    });
  });
});
