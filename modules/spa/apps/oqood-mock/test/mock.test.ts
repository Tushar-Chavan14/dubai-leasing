import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { FixedClock } from "@platform/kernel";
import {
  type OqoodRegisterPayload,
  type OqoodTransferPayload,
  REGISTRY_NO,
  type TrusteeTransferPayload,
} from "@spa/core";
import { freshOqoodMockDatabase, oqoodMockTestUrl } from "./helpers.ts";
import { HttpOqoodAdapter, RegistryUnavailableErrorCheck } from "./helpers.ts";
import { PDFDocument } from "pdf-lib";
import { count, eq, sql } from "drizzle-orm";
import { createOqoodMock } from "../src/app.ts";
import { PROFILES } from "../src/certificate.ts";
import { bootstrap, DEMO_DEVELOPER, type MockDb, reset } from "../src/db.ts";
import { registrations, submissions, titleDeeds, unitRecords } from "../src/schema.ts";

const url = oqoodMockTestUrl();
let db: MockDb;
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let n = 0;
const rid = () => `request-${++n}-${Math.random().toString(36).slice(2)}`;

const register = (over: Partial<OqoodRegisterPayload> = {}): OqoodRegisterPayload => ({
  unitNo: "U-101",
  projectCode: "P-DEMO-1",
  developerName: DEMO_DEVELOPER,
  buyers: [{ name: "Buyer One", idNo: "Z1111111" }],
  priceFils: 150_000_000,
  ...over,
});
const transfer = (over: Partial<OqoodTransferPayload> = {}): OqoodTransferPayload => ({
  unitNo: "A-101",
  projectCode: "P-DEMO-1",
  sellers: [{ name: "Sample Owner One" }, { name: "Sample Owner Two" }],
  buyers: [{ name: "Buyer One", idNo: "Z1111111" }],
  priceFils: 185_000_000,
  nocPresent: true,
  serviceChargesCleared: true,
  ...over,
});
const trustee = (over: Partial<TrusteeTransferPayload> = {}): TrusteeTransferPayload => ({
  ...transfer({ unitNo: "A-102", sellers: [{ name: "Seller One" }] }),
  titleDeedNo: "TD-FICT-1",
  ...over,
});

function client(opts: { failureRate?: number; demoMode?: boolean } = {}) {
  const app = createOqoodMock({
    db,
    clock,
    failureRate: opts.failureRate ?? 0,
    random: () => 0.5,
    demoMode: opts.demoMode ?? true,
  });
  const fetcher = async (r: Request) => app.fetch(r);
  return { app, registry: new HttpOqoodAdapter({ baseUrl: "http://oqood.test", fetch: fetcher }) };
}
const codes = (r: { ok: boolean; reasons?: { code: string }[] }) => (r.ok ? [] : r.reasons!.map((x) => x.code));

/** Text drawn on a PDF page: the content streams are compressed and the text is hex-encoded. */
function pdfText(bytes: Uint8Array): string {
  const raw = Buffer.from(bytes).toString("latin1");
  let out = "";
  for (const m of raw.matchAll(/stream\r?\n([\s\S]*?)\r?\nendstream/g)) {
    let body: string;
    try {
      body = inflateSync(Buffer.from(m[1]!, "latin1")).toString("latin1");
    } catch {
      continue;
    }
    for (const t of body.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) out += `${Buffer.from(t[1]!, "hex").toString("latin1")}\n`;
  }
  return out;
}

describe.skipIf(!url)("simulated Oqood and trustee registry", () => {
  beforeAll(async () => {
    db = await freshOqoodMockDatabase(url!);
    await bootstrap(db); // a second start changes nothing
  });
  beforeEach(async () => {
    await reset(db);
  });

  test("registers a unit once, even when the request id is repeated; the number is a SIM-OQD one", async () => {
    const { registry } = client();
    const id = rid();
    const r = await registry.register(register(), { requestId: id });
    expect(r).toMatchObject({ ok: true, issuedOn: "2026-11-19" });
    if (!r.ok) throw new Error("expected issued");
    expect(r.no).toMatch(/^SIM-OQD-2026-\d{7}$/);
    expect(r.no).toMatch(REGISTRY_NO);
    expect(await registry.register(register(), { requestId: id })).toEqual(r);
    const [issued] = await db.select({ n: count() }).from(registrations);
    expect(issued!.n).toBe(1);
    expect(await registry.status(r.no)).toEqual({ state: "registered" });
    expect(await registry.status("SIM-OQD-2026-9999999")).toEqual({ state: "unknown" });
    const [u] = await db.select().from(unitRecords).where(eq(unitRecords.unitNo, "U-101"));
    expect(u!.state).toBe("registered");
  });

  test("a replay returns the first answer even when the payload changed, and a rejection is replayed too", async () => {
    const { registry } = client();
    const id = rid();
    const bad = await registry.register(register({ buyers: [{ name: "buyer one", idNo: "Z1111111" }] }), {
      requestId: id,
    });
    expect(codes(bad)).toEqual(["BUYER_NAME_MISMATCH"]);
    expect(await registry.register(register(), { requestId: id })).toEqual(bad);
    // The unit was never registered by the first answer.
    expect((await registry.register(register(), { requestId: rid() })).ok).toBe(true);
  });

  test("the same request id on a different kind is a different request", async () => {
    const { registry } = client();
    const id = rid();
    expect((await registry.register(register(), { requestId: id })).ok).toBe(true);
    expect((await registry.transfer(transfer(), { requestId: id })).ok).toBe(true);
  });

  test("each rejection has its own code", async () => {
    const { registry } = client();
    const r = (p: Partial<OqoodRegisterPayload>) => registry.register(register(p), { requestId: rid() });
    expect(codes(await r({ unitNo: "NOPE-1" }))).toEqual(["UNIT_NOT_FOUND"]);
    expect(codes(await r({ projectCode: "P-OTHER" }))).toEqual(["UNIT_NOT_FOUND"]);
    expect(codes(await r({ developerName: "Another Developer LLC" }))).toEqual(["SELLER_NOT_OWNER"]);
    expect(codes(await r({ buyers: [{ name: "Buyer One", idNo: "Z9999999" }] }))).toEqual(["INVALID_ID"]);
    expect(codes(await r({ buyers: [{ name: "Somebody Else", idNo: "Z1111111" }] }))).toEqual(["BUYER_NAME_MISMATCH"]);
    // Every check runs: a wrong unit and a wrong name are not both reported (the unit is checked first and stops).
    expect((await r({})).ok).toBe(true);
    expect(codes(await r({}))).toEqual(["UNIT_ALREADY_REGISTERED"]);

    const t = (p: Partial<OqoodTransferPayload>) => registry.transfer(transfer(p), { requestId: rid() });
    expect(codes(await t({ sellers: [{ name: "Sample Owner One" }] }))).toEqual(["SELLER_NOT_OWNER"]);
    expect(codes(await t({ sellers: [{ name: "Stranger" }, { name: "Sample Owner Two" }] }))).toEqual([
      "SELLER_NOT_OWNER",
    ]);
    expect(codes(await t({ nocPresent: false }))).toEqual(["NOC_MISSING"]);
    expect(codes(await t({ serviceChargesCleared: false }))).toEqual(["SERVICE_CHARGES_OUTSTANDING"]);
    expect(codes(await t({ nocPresent: false, serviceChargesCleared: false }))).toEqual([
      "NOC_MISSING",
      "SERVICE_CHARGES_OUTSTANDING",
    ]);
    expect(codes(await t({ unitNo: "NOPE-2" }))).toEqual(["UNIT_NOT_FOUND"]);

    const k = (p: Partial<TrusteeTransferPayload>) => registry.book(trustee(p), { requestId: rid() });
    expect(codes(await k({ titleDeedNo: "TD-OTHER" }))).toEqual(["SELLER_NOT_OWNER"]);
    expect(codes(await k({ sellers: [{ name: "Not The Owner" }] }))).toEqual(["SELLER_NOT_OWNER"]);
    expect(codes(await k({ buyers: [{ name: "Buyer One", idNo: "Q1" }] }))).toEqual(["INVALID_ID"]);
  });

  test("an oqood transfer issues a SIM-TRF number and the next transfer needs the new owners", async () => {
    const { registry } = client();
    const r = await registry.transfer(transfer(), { requestId: rid() });
    expect(r.ok && r.no).toMatch(/^SIM-TRF-2026-\d{7}$/);
    // The sellers no longer own it; the buyer does.
    expect(codes(await registry.transfer(transfer(), { requestId: rid() }))).toEqual(["SELLER_NOT_OWNER"]);
    const again = await registry.transfer(
      transfer({ sellers: [{ name: "Buyer One" }], buyers: [{ name: "Buyer Two", idNo: "Z2222222" }] }),
      { requestId: rid() },
    );
    expect(again.ok).toBe(true);
    const current = await db
      .select()
      .from(titleDeeds)
      .where(sql`${titleDeeds.unitNo} = 'A-101' and not ${titleDeeds.superseded}`);
    expect(current.map((d) => d.owners)).toEqual([["Buyer Two"]]);
  });

  test("a trustee transfer books an appointment and issues a SIM-TRF booking with a SIM-TD deed", async () => {
    const { registry, app } = client();
    const r = await registry.book(trustee(), { requestId: rid() });
    expect(r.ok && r.no).toMatch(/^SIM-TRF-2026-\d{7}$/);
    const rows = await db.execute<{ booking_no: string; new_title_deed_no: string; appointment_on: string }>(
      sql`select * from oqood_mock.trustee_bookings`,
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]!.new_title_deed_no).toMatch(/^SIM-TD-2026-\d{7}$/);
    expect(rows.rows[0]!.new_title_deed_no).toMatch(REGISTRY_NO);
    // The old deed no longer works.
    expect(codes(await registry.book(trustee(), { requestId: rid() }))).toEqual(["SELLER_NOT_OWNER"]);
    const get = await app.fetch(new Request(`http://oqood.test/api/v1/oqood/${r.ok ? r.no : ""}`));
    expect(await get.json()).toMatchObject({ simulated: true, state: "registered", kind: "trustee_transfer" });
  });

  test("an outage is a 503 the client reports as 'unavailable'; it registers nothing and a retry is a new request", async () => {
    const down = client({ failureRate: 1 });
    const id = rid();
    await expect(down.registry.register(register(), { requestId: id })).rejects.toBeInstanceOf(
      RegistryUnavailableErrorCheck,
    );
    expect((await db.select({ n: count() }).from(registrations))[0]!.n).toBe(0);
    const [s] = await db.select().from(submissions);
    expect(s).toMatchObject({ outcome: "unavailable", requestId: null });
    const up = client();
    expect((await up.registry.register(register(), { requestId: id })).ok).toBe(true);
  });

  test("two requests for one unit at once register it once", async () => {
    const { registry } = client();
    const [a, b] = await Promise.all([
      registry.register(register(), { requestId: rid() }),
      registry.register(register(), { requestId: rid() }),
    ]);
    expect([a.ok, b.ok].filter(Boolean)).toHaveLength(1);
    expect(codes(a.ok ? b : a)).toEqual(["UNIT_ALREADY_REGISTERED"]);
  });

  test("demo console: reject-next forces a name mismatch once (demo mode only); a replay keeps its answer", async () => {
    const { app, registry } = client();
    const post = (a: typeof app, p: string) => a.fetch(new Request(`http://oqood.test${p}`, { method: "POST" }));
    expect((await post(app, "/api/v1/demo/reject-next")).status).toBe(200);
    const id = rid();
    expect(codes(await registry.register(register(), { requestId: id }))).toEqual(["BUYER_NAME_MISMATCH"]);
    expect(codes(await registry.register(register(), { requestId: id }))).toEqual(["BUYER_NAME_MISMATCH"]);
    expect((await registry.register(register(), { requestId: rid() })).ok).toBe(true); // once only
    const off = client({ demoMode: false });
    expect((await post(off.app, "/api/v1/demo/reject-next")).status).toBe(403);
    expect((await post(off.app, "/api/v1/demo/reset")).status).toBe(403);
    expect((await post(app, "/api/v1/demo/reset")).status).toBe(200);
  });

  test("an invalid request is a 400 and says it is simulated", async () => {
    const { app } = client();
    const res = await app.fetch(
      new Request("http://oqood.test/api/v1/oqood/register", {
        method: "POST",
        body: JSON.stringify({ requestId: "x" }),
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "invalid request" });
  });

  describe("rule 9: everything says it is simulated", () => {
    test("every JSON body says simulated: true", async () => {
      const { app } = client();
      const call = async (path: string, init?: RequestInit) =>
        (await app.fetch(new Request(`http://oqood.test${path}`, init))).json();
      const body = (b: unknown) => ({ method: "POST", body: JSON.stringify(b) });
      const issued = (await call("/api/v1/oqood/register", body({ requestId: rid(), payload: register() }))) as {
        no: string;
      };
      const bodies = [
        issued,
        await call("/api/v1/oqood/register", body({ requestId: rid(), payload: register() })), // rejected
        await call("/api/v1/oqood/register", body({ requestId: "x" })), // 400
        await call(`/api/v1/oqood/${issued.no}`),
        await call("/api/v1/oqood/SIM-OQD-2026-0000099"), // 404
        await call("/health"),
        await call("/api/v1/trustee/transfers", body({ requestId: rid(), payload: trustee() })),
      ];
      for (const b of bodies) expect(b).toMatchObject({ simulated: true });
    });

    test("the console says simulated, names both services, has no logo or image and mentions the DLD only as 'not connected'", async () => {
      const { app, registry } = client();
      await registry.register(register({ developerName: "<b>Evil</b>" }), { requestId: rid() });
      await registry.register(register(), { requestId: rid() });
      const html = await (await app.fetch(new Request("http://oqood.test/"))).text();
      expect(html).toContain("Simulated Oqood (demo)");
      expect(html).toContain("Simulated trustee transfer (demo)");
      expect(html).toContain("not connected to the Dubai Land Department");
      expect(html).not.toMatch(/<img|<svg|<link|logo|url\(/i);
      expect(html).not.toContain("<b>Evil</b>");
      for (const m of html.matchAll(/Dubai Land Department/g))
        expect(html.slice(m.index - 21, m.index + "Dubai Land Department".length)).toBe(
          "not connected to the Dubai Land Department",
        );
      const empty = await (async () => {
        await reset(db);
        return (await app.fetch(new Request("http://oqood.test/"))).text();
      })();
      expect(empty).toContain("Simulated Oqood (demo)");
    });

    test("each certificate says simulated in its title, watermark, producer and drawn text; no image, no DLD name", async () => {
      const { registry, app } = client();
      const nos: [string, keyof typeof PROFILES][] = [];
      const a = await registry.register(register(), { requestId: rid() });
      const b = await registry.transfer(transfer(), { requestId: rid() });
      const c = await registry.book(trustee(), { requestId: rid() });
      if (!a.ok || !b.ok || !c.ok) throw new Error("expected issued");
      nos.push([a.no, "oqood_register"], [b.no, "oqood_transfer"], [c.no, "trustee_transfer"]);
      for (const [no, kind] of nos) {
        const res = await app.fetch(new Request(`http://oqood.test/api/v1/oqood/${no}/certificate.pdf`));
        expect(res.status).toBe(200);
        expect(res.headers.get("content-disposition")).toContain("simulated-");
        const bytes = new Uint8Array(await res.arrayBuffer());
        const doc = await PDFDocument.load(bytes, { updateMetadata: false });
        const w = PROFILES[kind].wording;
        expect(doc.getProducer()).toBe(w.producer);
        expect(doc.getTitle()?.toLowerCase()).toContain("simulated");
        expect(w.producer).toMatch(/^Simulated (Oqood|trustee transfer) \(demo\)$/);
        expect(w.title).toMatch(/^Simulated (Oqood|trustee transfer) \(demo\)/);
        expect(w.watermark).toMatch(/^SIMULATED (OQOOD|TRUSTEE TRANSFER) \(DEMO\)/);
        const text = pdfText(bytes);
        expect(text).toContain(w.title);
        expect(text).toContain(w.watermark);
        expect(text).toContain(no);
        expect(text).toContain("It is not connected to the Dubai Land Department");
        expect(text.replace("not connected to the Dubai Land Department", "")).not.toContain("Dubai Land Department");
        expect(Buffer.from(bytes).toString("latin1")).not.toContain("/Subtype /Image");
      }
      expect(
        (await app.fetch(new Request("http://oqood.test/api/v1/oqood/SIM-OQD-2026-0000099/certificate.pdf"))).status,
      ).toBe(404);
    });
  });
});
