import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore, sniffImage } from "@leasing/adapters";
import { approvals, companies, type Database, rentRules, sriAverages } from "@leasing/db";
import { newId } from "@leasing/core";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import {
  addStaff,
  completeMoveInChecklist,
  freshDatabase,
  leaseCsv,
  noDb,
  testContext,
  testCompany,
} from "./harness.ts";
import { eq } from "drizzle-orm";
import { importLeasesCsv } from "../src/manager/import.ts";
import { jpegWithExif, pngWithText } from "../../../packages/adapters/test/fixtures.ts";
import { advance } from "../src/manager/advance.ts";

const SECRET = "test-secret";

const JPEG = jpegWithExif();
const PNG = pngWithText();

/** Set in beforeAll: the company that owns the units these tests create. */
let companyId = "";
let noRuleCompanyId = "";

const unitBody = (over: Record<string, unknown> = {}) => ({
  companyId,
  code: "dxb-2201",
  building: "Test Harbour Tower",
  community: "Dubai Creek Harbour",
  category: "residential",
  subtype: "apartment",
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
    // The allowed rent is the SRI average (AED 100,000 for a 1-bed) from 5% below to 10% above.
    companyId = await testCompany(database, { slug: "silverline-test", name: "Silverline Properties", rules: false });
    noRuleCompanyId = await testCompany(database, { slug: "no-rule-co", name: "No Rule Co", rules: false });
    await database.db.insert(rentRules).values([
      {
        id: newId(),
        companyId,
        category: "residential",
        emirate: "dubai",
        minPctBp: -500,
        maxPctBp: 1000,
        createdBy: "test",
      },
      // Villas sit far below the apartment band, so a unit turned into a villa falls out of range.
      {
        id: newId(),
        companyId,
        category: "residential",
        subtype: "villa",
        emirate: "dubai",
        minPctBp: -9000,
        maxPctBp: -8000,
        createdBy: "test",
      },
    ]);
    await database.db.insert(sriAverages).values(
      ["Dubai Creek Harbour", "Dubai Marina"].map((community) => ({
        id: newId(),
        community,
        category: "residential" as const,
        bedrooms: 1,
        avgAnnualRentFils: 10_000_000,
        source: "mock" as const,
        effectiveFrom: "2025-01-01" as never,
        createdBy: "test",
      })),
    );
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
    await json("leasing_officer", `/api/units/${id}`, "PATCH", { askingRentFils: 10_000_000 });
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
      unitBody({ code: "DXB-L1", bedrooms: 1, askingRentFils: 10_500_000 }),
    );
    const { id: lid } = (await listed.json()) as { id: string };
    await json("leasing_officer", `/api/units/${lid}/events`, "POST", { event: "MARK_READY" });
    await json("leasing_officer", `/api/units/${lid}/events`, "POST", { event: "PUBLISH" });
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { bedrooms: 0 })).status).toBe(422);
    // Checklist fields can't be cleared once ready; codes can't clash.
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { makaniNo: "" })).status).toBe(422);
    expect((await json("leasing_officer", `/api/units/${lid}`, "PATCH", { code: "DXB-BIG" })).status).toBe(422);
  });

  test("MARK_READY follows the rent rule: allowed in the band, refused without a rule", async () => {
    const inBand = (await (
      await json("leasing_officer", "/api/units", "POST", unitBody({ code: "DXB-R1", askingRentFils: 10_000_000 }))
    ).json()) as { id: string };
    expect(
      (await json("leasing_officer", `/api/units/${inBand.id}/events`, "POST", { event: "MARK_READY" })).status,
    ).toBe(200);
    const noRule = (await (
      await json(
        "leasing_officer",
        "/api/units",
        "POST",
        unitBody({ code: "DXB-R2", companyId: noRuleCompanyId, askingRentFils: 10_000_000 }),
      )
    ).json()) as { id: string };
    const refused = await json("leasing_officer", `/api/units/${noRule.id}/events`, "POST", { event: "MARK_READY" });
    expect(refused.status).toBe(422);
    expect(((await refused.json()) as { reasons: string[] }).reasons).toContain(
      "asking rent outside company range and not approved",
    );
  });

  test("the price proposal carries the rule, the SRI row and the band, and names them in the reason", async () => {
    const r = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-R3", community: "Dubai Marina", askingRentFils: 12_000_000 }),
    );
    const { id } = (await r.json()) as { id: string };
    const req = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
    expect(req.status).toBe(201);
    const { id: approvalId } = (await req.json()) as { id: string };
    const [ap] = await database.db.select().from(approvals).where(eq(approvals.id, approvalId));
    const rule = (await database.db.select().from(rentRules).where(eq(rentRules.companyId, companyId))).find(
      (x) => x.subtype === null,
    )!;
    const [sri] = await database.db.select().from(sriAverages).where(eq(sriAverages.community, "Dubai Marina"));
    expect(ap!.proposal).toMatchObject({
      unitCode: "DXB-R3",
      category: "residential",
      bedrooms: 1,
      askingRentFils: 12_000_000,
      rangeMinFils: 9_500_000,
      rangeMaxFils: 11_000_000,
      ruleId: rule.id,
      sriId: sri!.id,
    });
    expect(ap!.reasons).toEqual([
      "AED 120,000 a year is outside the allowed range AED 95,000 to AED 110,000 (rent rule for Silverline Properties, residential, SRI Dubai Marina 1-bed).",
    ]);
  });

  test("a listed unit can't be moved to a company, category, subtype or area whose band excludes its rent", async () => {
    const listedUnit = async (code: string) => {
      const r = await json("leasing_officer", "/api/units", "POST", unitBody({ code, askingRentFils: 10_000_000 }));
      const { id } = (await r.json()) as { id: string };
      await json("leasing_officer", `/api/units/${id}/events`, "POST", { event: "MARK_READY" });
      await json("leasing_officer", `/api/units/${id}/events`, "POST", { event: "PUBLISH" });
      return id;
    };
    for (const [code, patch] of [
      ["DXB-C1", { companyId: noRuleCompanyId }],
      ["DXB-C2", { category: "commercial", subtype: null }],
      ["DXB-C3", { subtype: "villa" }],
      ["DXB-C4", { community: "Nowhere Heights" }],
    ] as const) {
      const id = await listedUnit(code);
      const res = await json("leasing_officer", `/api/units/${id}`, "PATCH", patch);
      expect(res.status, code).toBe(422);
      expect(((await res.json()) as { reasons: string[] }).reasons.join(" ")).toContain("outside the allowed range");
    }
  });

  test("a pending price approval is cancelled when the company, category, subtype or community changes", async () => {
    for (const [code, patch] of [
      ["DXB-P1", { companyId: noRuleCompanyId }],
      ["DXB-P2", { category: "commercial", subtype: null }],
      ["DXB-P3", { subtype: "villa" }],
      ["DXB-P4", { community: "Dubai Marina" }],
    ] as const) {
      const r = await json("leasing_officer", "/api/units", "POST", unitBody({ code, askingRentFils: 40_000_000 }));
      const { id } = (await r.json()) as { id: string };
      const req = await call("leasing_officer", `/api/units/${id}/price-approval`, { method: "POST" });
      const { id: approvalId } = (await req.json()) as { id: string };
      expect((await json("leasing_officer", `/api/units/${id}`, "PATCH", patch)).status, code).toBe(200);
      const a = (await (await call("admin", `/api/approvals/${approvalId}`)).json()) as { status: string };
      expect(a.status, code).toBe("cancelled");
    }
  });

  test("POST /units/price-range previews the band for any staff role", async () => {
    const body = {
      companyId,
      category: "residential",
      subtype: "apartment",
      community: "Dubai Marina",
      bedrooms: 1,
      areaSqft: 800,
    };
    const r = await json("finance", "/api/units/price-range", "POST", body);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({
      range: { min: 9_500_000, max: 11_000_000 },
      sriLabel: "SRI Dubai Marina 1-bed",
      ruleId: expect.any(String),
    });
    const none = await json("finance", "/api/units/price-range", "POST", { ...body, companyId: noRuleCompanyId });
    expect(await none.json()).toEqual({ range: null, sriLabel: "SRI Dubai Marina 1-bed", ruleId: null });
  });

  test("a one-sided AED rule returns null for the missing side, never the sentinel", async () => {
    const oneSided = await testCompany(database, { slug: "one-sided-co", rules: false });
    await database.db.insert(rentRules).values({
      id: newId(),
      companyId: oneSided,
      category: "residential",
      emirate: "dubai",
      minPctBp: -500,
      maxPctBp: 500,
      minRentFils: 5_000_000,
      createdBy: "test",
    });
    const r = await json("finance", "/api/units/price-range", "POST", {
      companyId: oneSided,
      category: "residential",
      subtype: null,
      community: "No SRI Here",
      bedrooms: 1,
      areaSqft: 800,
    });
    const body = (await r.json()) as { range: { min: number | null; max: number | null } };
    expect(body.range).toMatchObject({ min: 5_000_000, max: null });
    // The unit page's read shows the same shape.
    const created = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-OS1", companyId: oneSided, community: "No SRI Here", askingRentFils: 6_000_000 }),
    );
    const { id } = (await created.json()) as { id: string };
    const detail = (await (await call("finance", `/api/units/${id}`)).json()) as {
      priceRange: { min: number | null; max: number | null };
      priceInRange: boolean;
    };
    expect(detail.priceRange).toMatchObject({ min: 5_000_000, max: null });
    expect(detail.priceInRange).toBe(true);
  });

  test("an old-shape price proposal still parses and approving it applies the price", async () => {
    const created = await json(
      "leasing_officer",
      "/api/units",
      "POST",
      unitBody({ code: "DXB-OLD", askingRentFils: 40_000_000 }),
    );
    const { id } = (await created.json()) as { id: string };
    const approvalId = newId();
    await database.db.insert(approvals).values({
      id: approvalId,
      gate: "price_out_of_range",
      entityKind: "unit",
      entityId: id,
      dedupeKey: `${id}:price@1:40000000`,
      title: "Asking rent for DXB-OLD",
      // Pre-slice-1 shape: bedrooms, range and policy version only.
      proposal: {
        unitId: id,
        unitCode: "DXB-OLD",
        bedrooms: 1,
        askingRentFils: 40_000_000,
        rangeMinFils: 5_000_000,
        rangeMaxFils: 13_000_000,
        policyVersion: 1,
      },
      approverRole: "leasing_manager",
      status: "pending",
      proposedBy: "user:old",
      createdAt: new Date("2026-10-19T04:00:00Z"),
    });
    expect(
      (await json("leasing_manager", `/api/approvals/${approvalId}/decide`, "POST", { decision: "approve" })).status,
    ).toBe(200);
    const u = (await (await call("admin", `/api/units/${id}`)).json()) as { priceApprovedAt: string | null };
    expect(u.priceApprovedAt).not.toBeNull();
  });

  test("a subtype must belong to the category", async () => {
    const r = await json("leasing_officer", "/api/units", "POST", unitBody({ code: "DXB-S1", subtype: "warehouse" }));
    expect(r.status).toBe(400);
  });

  test("a contracted unit can't be withdrawn, and goes READY → OCCUPIED when the lease starts", async () => {
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "FUT-1", start_on: "2026-11-01", end_on: "2027-10-31" }]),
      "import",
      await testCompany(t.ctx.database),
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

  test("create and update refuse an unknown or inactive company", async () => {
    const inactiveId = await testCompany(database, { slug: "dormant-co", name: "Dormant Co", rules: false });
    await database.db.update(companies).set({ active: false }).where(eq(companies.id, inactiveId));
    for (const [companyIdBad, reason] of [
      [newId(), "company not found"],
      [inactiveId, "company is inactive"],
    ] as const) {
      const created = await json(
        "admin",
        "/api/units",
        "POST",
        unitBody({ code: `DXB-X${reason.length}`, companyId: companyIdBad }),
      );
      expect(created.status).toBe(422);
      expect(await created.json()).toMatchObject({ reasons: [reason] });
    }
    const ok = await json("admin", "/api/units", "POST", unitBody({ code: "DXB-X1" }));
    const { id } = (await ok.json()) as { id: string };
    for (const [companyIdBad, reason] of [
      [newId(), "company not found"],
      [inactiveId, "company is inactive"],
    ] as const) {
      const patched = await json("admin", `/api/units/${id}`, "PATCH", { companyId: companyIdBad });
      expect(patched.status).toBe(422);
      expect(await patched.json()).toMatchObject({ reasons: [reason] });
    }
  });

  test("changing the category of a READY unit runs the checklist; bedrooms only matter for residential", async () => {
    const commercialCo = await testCompany(database, { slug: "comm-co", name: "Comm Co", rules: false });
    await database.db.insert(rentRules).values({
      id: newId(),
      companyId: commercialCo,
      category: "commercial",
      emirate: "dubai",
      minPctBp: 0,
      maxPctBp: 0,
      minRentFils: 1,
      maxRentFils: 90_000_000,
      createdBy: "test",
    });
    const made = await json(
      "admin",
      "/api/units",
      "POST",
      unitBody({
        code: "DXB-OFC1",
        companyId: commercialCo,
        category: "commercial",
        subtype: "office",
        bedrooms: null,
        askingRentFils: 20_000_000,
      }),
    );
    const { id } = (await made.json()) as { id: string };
    expect((await json("admin", `/api/units/${id}/events`, "POST", { event: "MARK_READY" })).status).toBe(200);
    const r = await json("admin", `/api/units/${id}`, "PATCH", { category: "residential", subtype: "apartment" });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { reasons: string[] }).reasons.join(" ")).toContain("missing bedrooms");
    // Clearing bedrooms on a commercial unit is fine.
    expect((await json("admin", `/api/units/${id}`, "PATCH", { bedrooms: null })).status).toBe(200);
  });

  test("the company is locked once the unit has a lease", async () => {
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "LEASED-2", start_on: "2026-06-01", end_on: "2027-05-31" }]),
      "import",
      await testCompany(t.ctx.database),
    );
    const list = (await (await call("admin", "/api/units")).json()) as { id: string; code: string }[];
    const leased = list.find((u) => u.code === "LEASED-2")!;
    const r = await json("admin", `/api/units/${leased.id}`, "PATCH", { companyId: noRuleCompanyId });
    expect(r.status).toBe(422);
    expect(((await r.json()) as { reasons: string[] }).reasons[0]).toContain("companyId");
  });

  test("identity fields are locked once the unit has a lease", async () => {
    await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: "LEASED-1", start_on: "2026-06-01", end_on: "2027-05-31" }]),
      "import",
      await testCompany(t.ctx.database),
    );
    const list = (await (await call("admin", "/api/units")).json()) as { id: string; code: string }[];
    const leased = list.find((u) => u.code === "LEASED-1")!;
    const r = await json("admin", `/api/units/${leased.id}`, "PATCH", { makaniNo: "9999999999" });
    expect(r.status).toBe(422);
    expect((await json("admin", `/api/units/${leased.id}`, "PATCH", { category: "commercial" })).status).toBe(422);
    expect(((await r.json()) as { reasons: string[] }).reasons[0]).toContain("makaniNo");
    expect((await json("admin", `/api/units/${leased.id}`, "PATCH", { description: "Refreshed kitchen" })).status).toBe(
      200,
    );
  });
});
