import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore, sniffImage } from "@leasing/adapters";
import type { Database } from "@leasing/db";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { addStaff, completeMoveInChecklist, freshDatabase, leaseCsv, noDb, testContext } from "./harness.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { jpegWithExif, pngWithText } from "../../../packages/adapters/test/fixtures.ts";
import { advance } from "../src/manager/advance.ts";

const SECRET = "test-secret";

const JPEG = jpegWithExif();
const PNG = pngWithText();

const unitBody = (over: Record<string, unknown> = {}) => ({
  code: "dxb-2201",
  building: "Test Harbour Tower",
  community: "Dubai Creek Harbour",
  kind: "residential",
  unitNo: "2201",
  floor: 22,
  dldPropertyNo: "T-DLD-2201",
  makaniNo: "30123 45678",
  plotNo: null,
  dewaPremiseNo: "T-DEWA-2201",
  areaSqft: 910,
  bedrooms: 1,
  bathrooms: 2,
  parkingSpaces: 1,
  furnished: false,
  askingRentFils: 9_500_000,
  description: "Corner one-bedroom with a creek view.",
  ...over,
});

describe("sniffImage", () => {
  test("detects by magic bytes, not by name", () => {
    expect(sniffImage(JPEG)?.mime).toBe("image/jpeg");
    expect(sniffImage(PNG)?.mime).toBe("image/png");
    expect(sniffImage(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))?.mime).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("%PDF-1.7"))).toBeNull();
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeNull();
  });
});

describe.skipIf(noDb)("units API (Postgres)", () => {
  let database: Database;
  let app: ReturnType<typeof createApi>;
  let t: ReturnType<typeof testContext>;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    t = testContext(database, "2026-10-19T04:00:00Z");
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_officer", "leasing_manager", "finance", "admin"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
  });

  const call = (role: string, path: string, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { "content-type": "application/json" }),
        authorization: `Bearer ${tokens[role]}`,
      },
    });
  const json = (role: string, path: string, method: string, body: unknown) =>
    call(role, path, { method, body: JSON.stringify(body) });
  const upload = (role: string, unitId: string, bytes: Uint8Array, name = "photo.jpg") => {
    const form = new FormData();
    form.set("file", new File([bytes.slice().buffer], name));
    form.set("caption", "Living room");
    return call(role, `/api/units/${unitId}/photos`, { method: "POST", body: form });
  };

  test("create: validated, normalised, audited; finance can't create", async () => {
    expect((await json("finance", "/api/units", "POST", unitBody())).status).toBe(403);
    expect((await json("leasing_officer", "/api/units", "POST", unitBody({ makaniNo: "123" }))).status).toBe(400);
    const r = await json("leasing_officer", "/api/units", "POST", unitBody());
    expect(r.status).toBe(201);
    const u = (await r.json()) as { id: string; code: string; makaniNo: string; state: string };
    expect(u).toMatchObject({ code: "DXB-2201", makaniNo: "3012345678", state: "PREP" });
    expect((await json("leasing_officer", "/api/units", "POST", unitBody())).status).toBe(409);
    const detail = (await (await call("finance", `/api/units/${u.id}`)).json()) as {
      events: { type: string }[];
      checklistMissing: string[];
      priceInRange: boolean;
      actions: { event: string; to: string; allowed: boolean; reasons: string[] }[];
    };
    expect(detail.events[0]?.type).toBe("UNIT_CREATED");
    expect(detail.checklistMissing).toEqual([]);
    expect(detail.priceInRange).toBe(true);
    expect(detail.actions).toEqual([{ event: "MARK_READY", to: "READY", allowed: true, reasons: [] }]);
  });

  test("photos: images only, deduplicated, ordered, served back", async () => {
    const [u] = (await (await call("leasing_officer", "/api/units")).json()) as { id: string }[];
    const id = u!.id;
    expect((await upload("finance", id, JPEG)).status).toBe(403);
    expect((await upload("leasing_officer", id, new TextEncoder().encode("%PDF-1.7"), "x.jpg")).status).toBe(422);
    const a = await upload("leasing_officer", id, JPEG);
    expect(a.status).toBe(201);
    expect((await upload("leasing_officer", id, JPEG)).status).toBe(200); // same bytes → same photo
    const b = await upload("leasing_officer", id, PNG);
    const pa = ((await a.json()) as { photo: { id: string } }).photo.id;
    const pb = ((await b.json()) as { photo: { id: string } }).photo.id;

    const served = await call("finance", `/api/units/${id}/photos/${pa}`);
    expect(served.headers.get("content-type")).toBe("image/jpeg");
    // Stored without the EXIF/GPS segment, even though it came straight to the API.
    const servedText = new TextDecoder("latin1").decode(await served.arrayBuffer());
    expect(servedText).not.toContain("GPSLatitude");
    expect(servedText).toContain("JFIF");

    // Caption changes are audited.
    expect(
      (await json("leasing_officer", `/api/units/${id}/photos/${pa}`, "PATCH", { caption: "Balcony" })).status,
    ).toBe(200);

    expect((await json("leasing_officer", `/api/units/${id}/photos/order`, "PUT", { ids: [pb] })).status).toBe(422);
    expect((await json("leasing_officer", `/api/units/${id}/photos/order`, "PUT", { ids: [pb, pa] })).status).toBe(204);
    const list = (await (await call("finance", "/api/units")).json()) as { coverPhotoId: string; photoCount: number }[];
    expect(list[0]).toMatchObject({ coverPhotoId: pb, photoCount: 2 });

    expect((await call("leasing_officer", `/api/units/${id}/photos/${pa}`, { method: "DELETE" })).status).toBe(204);
    expect((await call("leasing_officer", `/api/units/${id}/photos/${pa}`)).status).toBe(404);
    const detail = (await (await call("finance", `/api/units/${id}`)).json()) as { events: { type: string }[] };
    expect(detail.events.map((e) => e.type)).toContain("UNIT_PHOTO_CAPTIONED");
    // Uploading to a unit that doesn't exist writes nothing and returns 404.
    expect((await upload("leasing_officer", "01a00000-0000-7000-8000-000000000000", jpegWithExif(9))).status).toBe(404);
  });

  test("out-of-range rent: blocked until a manager approves that exact rent", async () => {
    const r = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-PH1", askingRentFils: 40_000_000 }),
    );
    const { id } = (await r.json()) as { id: string };
    const ready = await json("leasing_officer", `/api/units/${id}/events`, "POST", { event: "MARK_READY" });
    expect(ready.status).toBe(422);

    const req = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    expect(req.status).toBe(201);
    expect((await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" })).status).toBe(409);
    const { id: approvalId } = (await req.json()) as { id: string };

    // The officer who asked can't approve; changing the rent makes the proposal stale.
    expect(
      (await json("leasing_officer", `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(403);
    await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 41_000_000 });
    expect(
      (await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(409);
    // The stale proposal stays cancelled even if the rent goes back; a fresh request is needed.
    await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 40_000_000 });
    expect(
      (await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(409);
    const again = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    const { id: freshId } = (await again.json()) as { id: string };
    expect(
      (await json("leasing_manager", `/api/approvals/${freshId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(200);

    expect((await json("leasing_officer", `/api/units/${id}/events`, "POST", { event: "MARK_READY" })).status).toBe(
      200,
    );
    expect((await json("leasing_officer", `/api/units/${id}/events`, "POST", { event: "PUBLISH" })).status).toBe(200);
    // Editing the rent on a listed unit can't sneak an unapproved price in.
    expect((await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 45_000_000 })).status).toBe(
      422,
    );
  });

  test("price gate: only a leasing manager decides, no edits, rejection leaves the unit unapproved", async () => {
    const r = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-PH2", askingRentFils: 40_000_000 }),
    );
    const { id } = (await r.json()) as { id: string };
    const req = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    const { id: approvalId } = (await req.json()) as { id: string };
    for (const role of ["admin", "finance"]) {
      expect((await json(role, `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status).toBe(
        403,
      );
    }
    expect(
      (
        await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", {
          decision: "edit",
          proposal: { askingRentFils: 1 },
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", {
          decision: "reject",
          note: "Too high for the building",
        })
      ).status,
    ).toBe(200);
    const u = (await (await call("admin", `/api/units/${id}`)).json()) as { priceApprovedAt: string | null };
    expect(u.priceApprovedAt).toBeNull();
    // In range: nothing to approve.
    await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 9_000_000 });
    expect((await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" })).status).toBe(409);
  });

  test("changing bedrooms voids a price approval and can't push a listed unit out of range", async () => {
    // A 2-bed approved at AED 400,000 must not become an approved studio at that rent.
    const r = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-BIG", bedrooms: 2, askingRentFils: 40_000_000 }),
    );
    const { id } = (await r.json()) as { id: string };
    const req = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    const { id: approvalId } = (await req.json()) as { id: string };
    expect(
      (await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(200);
    const patched = await json("leasing_officer", `/api/units/${id}`, "PATCH", { bedrooms: 0 });
    expect(patched.status).toBe(200);
    const u = (await (await call("admin", `/api/units/${id}`)).json()) as {
      priceApprovedAt: string | null;
      actions: { event: string; allowed: boolean }[];
      events: { type: string; payload: Record<string, unknown> }[];
    };
    expect(u.priceApprovedAt).toBeNull();
    expect(u.actions.find((a) => a.event === "MARK_READY")?.allowed).toBe(false);
    expect(u.events.find((e) => e.type === "UNIT_UPDATED")?.payload).toMatchObject({ priceApprovalCleared: true });

    // A pending proposal for the old rent is cancelled when the rent changes.
    const req2 = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    const { id: pendingId } = (await req2.json()) as { id: string };
    await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 41_000_000 });
    const a = (await (await call("admin", `/api/approvals/${pendingId}`)).json()) as { status: string };
    expect(a.status).toBe("cancelled");

    // Listed unit: a bedroom change that leaves the range is refused.
    const listed = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-L1", bedrooms: 1, askingRentFils: 12_000_000 }),
    );
    const { id: lid } = (await listed.json()) as { id: string };
    await json("leasing_officer", `/api/units/${lid}/events`, "POST", { event: "MARK_READY" });
    await json("leasing_officer", `/api/units/${lid}/events`, "POST", { event: "PUBLISH" });
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { bedrooms: 0 })).status).toBe(422);
    // Checklist fields can't be cleared once ready; codes can't clash.
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { makaniNo: "" })).status).toBe(422);
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { code: "DXB-BIG" })).status).toBe(422);
  });

  test("a contracted unit can't be withdrawn, and goes READY → OCCUPIED when the lease starts", async () => {
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "FUT-1", start_on: "2026-11-01", end_on: "2027-10-31" }]),
      "import",
    );
    const list = (await (await call("admin", "/api/units")).json()) as {
      id: string;
      code: string;
      state: string;
      lease: { id: string } | null;
    }[];
    const unit = list.find((u) => u.code === "FUT-1")!;
    expect(unit.state).toBe("READY");
    expect((await json("admin", `/api/units/${unit.id}/events`, "POST", { event: "WITHDRAW" })).status).toBe(422);
    expect((await json("admin", `/api/units/${unit.id}/events`, "POST", { event: "PUBLISH" })).status).toBe(422);
    t.clock.advanceDays(13);
    await completeMoveInChecklist(t.ctx, unit.lease!.id);
    await advance(t.ctx, { kind: "lease", id: unit.lease!.id }, "MOVE_IN_COMPLETED", { actor: "system" });
    const after = (await (await call("admin", `/api/units/${unit.id}`)).json()) as { state: string };
    expect(after.state).toBe("OCCUPIED");
  });

  test("identity fields are locked once the unit has a lease", async () => {
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "LEASED-1", start_on: "2026-06-01", end_on: "2027-05-31" }]),
      "import",
    );
    const list = (await (await call("admin", "/api/units")).json()) as { id: string; code: string }[];
    const leased = list.find((u) => u.code === "LEASED-1")!;
    const r = await json("admin", `/api/units/${leased.id}`, "PATCH", { makaniNo: "9999999999" });
    expect(r.status).toBe(422);
    expect((await json("admin", `/api/units/${leased.id}`, "PATCH", { kind: "commercial" })).status).toBe(422);
    expect(((await r.json()) as { reasons: string[] }).reasons[0]).toContain("makaniNo");
    expect((await json("admin", `/api/units/${leased.id}`, "PATCH", { description: "Refreshed kitchen" })).status).toBe(
      200,
    );
  });
});
