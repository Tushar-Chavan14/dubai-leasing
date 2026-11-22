import { describe, expect, test } from "bun:test";
import { RegistryUnavailableError } from "@spa/core";
import {
  buildOqoodRegister,
  buildOqoodTransfer,
  buildTrusteeTransfer,
  FakeOqood,
  HttpOqoodAdapter,
  type RegistrySource,
} from "../src/index.ts";

const src = (over: Partial<RegistrySource> = {}): RegistrySource => ({
  purchasers: [
    { purchaser_name: "Buyer One", purchaser_eid_no: "784-1990-1234567-1", purchaser_passport_no: "X1" },
    { purchaser_name: "Buyer Two", purchaser_passport_no: "P2222222" },
    { purchaser_name: "Buyer Co LLC", purchaser_licence_no: "LIC-77" },
  ],
  sellers: [{ seller_name: "Fictional Developments LLC" }, { seller_name: "Seller Two" }],
  values: { price: 200_000_000, unit_no: "A-101", title_deed_no: "TD-FICT-1" },
  projectCode: "P1",
  nocOk: true,
  serviceChargesCleared: true,
  ...over,
});

describe("registry payloads: every field comes from a deal record", () => {
  test("oqood register: developer is the first seller, buyers carry the id the sheet has, price and unit as stored", () => {
    const r = buildOqoodRegister(src());
    expect(r).toEqual({
      ok: true,
      payload: {
        unitNo: "A-101",
        projectCode: "P1",
        developerName: "Fictional Developments LLC",
        // Emirates ID over passport; passport when no Emirates ID; licence for a company.
        buyers: [
          { name: "Buyer One", idNo: "784-1990-1234567-1" },
          { name: "Buyer Two", idNo: "P2222222" },
          { name: "Buyer Co LLC", idNo: "LIC-77" },
        ],
        priceFils: 200_000_000,
      },
    });
  });

  test("oqood transfer: sellers, buyers, price, unit, the NOC fact and the NOC's service-charge answer", () => {
    const r = buildOqoodTransfer(src());
    expect(r.ok && r.payload).toMatchObject({
      unitNo: "A-101",
      sellers: [{ name: "Fictional Developments LLC" }, { name: "Seller Two" }],
      priceFils: 200_000_000,
      nocPresent: true,
      serviceChargesCleared: true,
    });
    const no = buildOqoodTransfer(src({ nocOk: false, serviceChargesCleared: false }));
    expect(no.ok && no.payload).toMatchObject({ nocPresent: false, serviceChargesCleared: false });
  });

  test("trustee transfer adds the title deed number from the listing", () => {
    const r = buildTrusteeTransfer(src());
    expect(r.ok && r.payload.titleDeedNo).toBe("TD-FICT-1");
    const missing = buildTrusteeTransfer(src({ values: { price: 1, unit_no: "A-101" } }));
    expect(missing).toEqual({ ok: false, missing: ["title deed number"] });
  });

  test("a missing record is named and nothing is built (never guessed)", () => {
    expect(buildOqoodRegister(src({ values: {} }))).toEqual({ ok: false, missing: ["unit number", "price"] });
    expect(buildOqoodRegister(src({ purchasers: [{ purchaser_name: "No Id" }] }))).toEqual({
      ok: false,
      missing: ["buyer 1 identity number"],
    });
    expect(buildOqoodTransfer(src({ serviceChargesCleared: null }))).toEqual({
      ok: false,
      missing: ["NOC service-charge answer"],
    });
    expect(buildOqoodTransfer(src({ sellers: [] }))).toEqual({ ok: false, missing: ["sellers"] });
  });

  test("a price that is not integer fils is missing", () => {
    expect(buildOqoodRegister(src({ values: { price: 1.5, unit_no: "A" } }))).toEqual({
      ok: false,
      missing: ["price"],
    });
  });
});

describe("HttpOqoodAdapter", () => {
  const make = (answer: (req: Request) => Response | Promise<Response>, seen: Request[] = []) =>
    new HttpOqoodAdapter({
      baseUrl: "http://registry.test/",
      fetch: async (r) => {
        seen.push(r.clone() as unknown as Request);
        return answer(r);
      },
    });
  const reg = buildOqoodRegister(src());
  if (!reg.ok) throw new Error("fixture");

  test("posts the payload with the request id and reads an issued number", async () => {
    const seen: Request[] = [];
    const a = make(
      () => Response.json({ status: "issued", no: "SIM-OQD-2026-0000001", issuedOn: "2026-11-19" }, { status: 201 }),
      seen,
    );
    expect(await a.register(reg.payload, { requestId: "d:oqood_register:1" })).toEqual({
      ok: true,
      no: "SIM-OQD-2026-0000001",
      issuedOn: "2026-11-19",
    });
    expect(seen[0]!.url).toBe("http://registry.test/api/v1/oqood/register");
    expect(await seen[0]!.json()).toEqual({ requestId: "d:oqood_register:1", payload: reg.payload });
  });

  test("a 422 is a rejection with its reasons; a malformed answer throws", async () => {
    const reasons = [{ code: "UNIT_NOT_FOUND" as const, field: "unitNo", message: "No such unit." }];
    const a = make(() => Response.json({ status: "rejected", reasons }, { status: 422 }));
    expect(await a.register(reg.payload, { requestId: "r1" })).toEqual({ ok: false, reasons });
    const bad = make(() =>
      Response.json({ status: "rejected", reasons: [{ code: "MADE_UP", field: null, message: "x" }] }, { status: 422 }),
    );
    await expect(bad.register(reg.payload, { requestId: "r2" })).rejects.toThrow();
  });

  test("a 5xx and a network error are 'unavailable', never a rejection", async () => {
    const down = make(() => Response.json({ error: "temporarily unavailable" }, { status: 503 }));
    await expect(down.register(reg.payload, { requestId: "r3" })).rejects.toBeInstanceOf(RegistryUnavailableError);
    const dead = new HttpOqoodAdapter({
      baseUrl: "http://registry.test",
      fetch: async () => {
        throw new Error("ECONNREFUSED");
      },
    });
    const k = buildTrusteeTransfer(src());
    if (!k.ok) throw new Error("fixture");
    await expect(dead.book(k.payload, { requestId: "r4" })).rejects.toBeInstanceOf(RegistryUnavailableError);
  });

  test("transfer and trustee routes; status 404 is unknown; certificate must be a PDF", async () => {
    const seen: Request[] = [];
    const a = make((r) => {
      if (r.url.endsWith("/certificate.pdf")) return new Response(new TextEncoder().encode("%PDF-1.4 x"));
      if (r.method === "GET") return Response.json({ error: "not found" }, { status: 404 });
      return Response.json({ status: "issued", no: "SIM-TRF-2026-0000001", issuedOn: "2026-11-19" }, { status: 201 });
    }, seen);
    const t = buildOqoodTransfer(src());
    const k = buildTrusteeTransfer(src());
    if (!t.ok || !k.ok) throw new Error("fixture");
    await a.transfer(t.payload, { requestId: "t" });
    await a.book(k.payload, { requestId: "k" });
    expect(seen.map((r) => new URL(r.url).pathname)).toEqual(["/api/v1/oqood/transfer", "/api/v1/trustee/transfers"]);
    expect(await a.status("SIM-OQD-2026-0000009")).toEqual({ state: "unknown" });
    expect((await a.certificate("SIM-TRF-2026-0000001")).byteLength).toBeGreaterThan(5);
    const notPdf = make(() => new Response("hello"));
    await expect(notPdf.certificate("x")).rejects.toThrow("not a PDF");
  });
});

describe("FakeOqood", () => {
  test("records calls, scripts answers and replays a repeated request id", async () => {
    const f = new FakeOqood({ issuedOn: "2026-12-01" });
    const reg = buildOqoodRegister(src());
    if (!reg.ok) throw new Error("fixture");
    f.script({ reject: [{ code: "UNIT_NOT_FOUND", field: null, message: "m" }] }, "unavailable");
    expect((await f.register(reg.payload, { requestId: "a" })).ok).toBe(false);
    expect((await f.register(reg.payload, { requestId: "a" })).ok).toBe(false); // the first answer again
    await expect(f.register(reg.payload, { requestId: "b" })).rejects.toBeInstanceOf(RegistryUnavailableError);
    expect(await f.register(reg.payload, { requestId: "c" })).toEqual({
      ok: true,
      no: "SIM-OQD-2026-0000001",
      issuedOn: "2026-12-01",
    });
    expect(f.calls.map((c) => c.requestId)).toEqual(["a", "a", "b", "c"]);
  });
});
