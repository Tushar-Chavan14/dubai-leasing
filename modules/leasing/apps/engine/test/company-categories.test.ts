import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { companies, type Database } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { importLeasesCsv, importUnitsCsv } from "../src/manager/import.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";

describe.skipIf(noDb)("company property types (Postgres)", () => {
  let database: Database;
  let app: ReturnType<typeof createApi>;
  let ctx: ReturnType<typeof testContext>["ctx"];
  let token = "";
  let companyId = "";

  beforeAll(async () => {
    database = await freshDatabase();
    ctx = testContext(database, "2026-10-19T04:00:00Z").ctx;
    app = createApi(ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    token = issueToken(SECRET, (await addStaff(database, "admin")).id, Date.now());
    companyId = await testCompany(database, { slug: "cat-co", name: "Cat Co", rules: false });
    await database.db
      .update(companies)
      .set({ categories: ["residential"] })
      .where(eq(companies.id, companyId));
  });

  const send = (path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    });
  const code = async (r: Response) => ((await r.json()) as { code?: string }).code;

  const rentRule = (over: Record<string, unknown> = {}) => ({
    companyId,
    category: "residential",
    emirate: "dubai",
    minPctBp: -500,
    maxPctBp: 1000,
    ...over,
  });
  const contractRule = (over: Record<string, unknown> = {}) => ({
    companyId,
    category: "residential",
    emirate: null,
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    clauseIds: [],
    ...over,
  });
  const unit = (over: Record<string, unknown> = {}) => ({
    companyId,
    code: "CAT-1",
    emirate: "dubai",
    building: "Tower",
    community: "Marina",
    category: "residential",
    subtype: "apartment",
    unitNo: "1",
    floor: 1,
    dldPropertyNo: "D-1",
    makaniNo: "",
    plotNo: null,
    dewaPremiseNo: "W-1",
    areaSqft: 800,
    bedrooms: 1,
    bathrooms: 1,
    parkingSpaces: 0,
    furnished: false,
    askingRentFils: 9_000_000,
    description: "",
    ...over,
  });

  test("GET /companies returns categories; a new company offers all three by default", async () => {
    const list = (await (await send("/companies")).json()) as { id: string; categories: string[] }[];
    expect(list.find((c) => c.id === companyId)?.categories).toEqual(["residential"]);
    const r = await send("/companies", "POST", { name: "All Types", kind: "owner" });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { categories: string[] }).categories).toEqual(["residential", "commercial", "retail"]);
    const only = await send("/companies", "POST", { name: "Retail Only", kind: "owner", categories: ["retail"] });
    expect(((await only.json()) as { categories: string[] }).categories).toEqual(["retail"]);
    expect((await send("/companies", "POST", { name: "None", kind: "owner", categories: [] })).status).toBe(400);
  });

  test("category_not_offered: rent rule, contract rule, unit create, unit update", async () => {
    const rr = await send("/rent-rules", "POST", rentRule({ category: "retail" }));
    expect(rr.status).toBe(422);
    expect(await code(rr)).toBe("category_not_offered");
    const cr = await send("/contract-rules", "POST", contractRule({ category: "commercial" }));
    expect(cr.status).toBe(422);
    expect(await code(cr)).toBe("category_not_offered");
    const u = await send("/units", "POST", unit({ category: "retail", subtype: "shop", bedrooms: null }));
    expect(u.status).toBe(422);
    expect(await code(u)).toBe("category_not_offered");
    const ok = await send("/units", "POST", unit());
    expect(ok.status).toBe(201);
    const id = ((await ok.json()) as { id: string }).id;
    const patch = await send(`/units/${id}`, "PATCH", { category: "retail", subtype: "shop" });
    expect(patch.status).toBe(422);
    expect(await code(patch)).toBe("category_not_offered");
    expect((await send("/rent-rules", "POST", rentRule())).status).toBe(201);
    expect((await send("/contract-rules", "POST", contractRule())).status).toBe(201);
  });

  test("import row for a type the company doesn't offer is a row error", async () => {
    const rows = await importUnitsCsv(
      ctx,
      "unit_code,building,community,category\nCATI-1,Tower,Marina,retail\nCATI-2,Tower,Marina,residential",
      "import",
      companyId,
    );
    expect(rows[0]?.status).toBe("error");
    expect(rows[0]?.reasons.join(" ")).toContain("doesn't offer retail");
    expect(rows[1]?.status).toBe("imported");
  });

  test("a lease import that creates a unit is a row error when the company doesn't lease residential", async () => {
    const retailOnly = await send("/companies", "POST", { name: "Shops Only", kind: "owner", categories: ["retail"] });
    const shopsId = ((await retailOnly.json()) as { id: string }).id;
    const [r] = await importLeasesCsv(
      ctx,
      leaseCsv([{ unit_code: "CATL-1", start_on: "2026-01-01", end_on: "2026-12-31" }]),
      "import",
      shopsId,
    );
    expect(r?.status).toBe("error");
    expect(r?.reasons.join(" ")).toContain("doesn't offer residential");
  });

  test("category_in_use: removing a type with units or active rules is refused; an empty one can go", async () => {
    expect((await send(`/companies/${companyId}`, "PATCH", { categories: ["residential", "retail"] })).status).toBe(
      200,
    );
    expect((await send("/rent-rules", "POST", rentRule({ category: "retail" }))).status).toBe(201);
    const blocked = await send(`/companies/${companyId}`, "PATCH", { categories: ["residential"] });
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as { code: string; error: string };
    expect(body.code).toBe("category_in_use");
    expect(body.error).toContain("retail");
    expect(body.error).toContain("1 active rent rule");
    const unitBlocked = await send(`/companies/${companyId}`, "PATCH", { categories: ["retail"] });
    expect(unitBlocked.status).toBe(422);
    expect(await code(unitBlocked)).toBe("category_in_use");

    const other = await testCompany(database, { slug: "cat-co-2", name: "Cat Co 2", rules: false });
    const r = await send(`/companies/${other}`, "PATCH", { categories: ["residential"] });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { categories: string[] }).categories).toEqual(["residential"]);
    expect((await send(`/companies/${other}`, "PATCH", { categories: [] })).status).toBe(400);
  });
});
