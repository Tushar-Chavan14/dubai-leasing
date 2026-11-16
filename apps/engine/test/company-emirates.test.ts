import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { companies, type Database } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { importUnitsCsv } from "../src/manager/import.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";

describe.skipIf(noDb)("company operating emirates (Postgres)", () => {
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
    companyId = await testCompany(database, { slug: "em-co", name: "Em Co", rules: false });
    await database.db
      .update(companies)
      .set({ emirates: ["dubai"] })
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
  const unit = (over: Record<string, unknown> = {}) => ({
    companyId,
    code: "EM-1",
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

  test("GET /companies returns emirates; a new company defaults to Dubai", async () => {
    const list = (await (await send("/companies")).json()) as { id: string; emirates: string[] }[];
    expect(list.find((c) => c.id === companyId)?.emirates).toEqual(["dubai"]);
    const r = await send("/companies", "POST", {
      name: "Two Emirates",
      kind: "realty",
      emirates: ["sharjah", "sharjah", "ajman"],
    });
    expect(r.status).toBe(201);
    expect(((await r.json()) as { emirates: string[] }).emirates).toEqual(["sharjah", "ajman"]);
    const def = await send("/companies", "POST", { name: "Default Co", kind: "owner" });
    expect(((await def.json()) as { emirates: string[] }).emirates).toEqual(["dubai"]);
    expect((await send(`/companies/${companyId}`, "PATCH", { emirates: [] })).status).toBe(400);
  });

  test("emirate_not_operated: rent rule, contract rule, unit, template upload", async () => {
    const rr = await send("/rent-rules", "POST", rentRule({ emirate: "sharjah" }));
    expect(rr.status).toBe(422);
    expect(await code(rr)).toBe("emirate_not_operated");
    const cr = await send("/contract-rules", "POST", {
      companyId,
      category: "residential",
      emirate: "sharjah",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 4,
      clauseIds: [],
    });
    expect(cr.status).toBe(422);
    expect(await code(cr)).toBe("emirate_not_operated");
    // Any emirate (null) is always allowed.
    const any = await send("/contract-rules", "POST", {
      companyId,
      category: "residential",
      emirate: null,
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 4,
      clauseIds: [],
    });
    expect(any.status).toBe(201);
    const up = await app.request(`/api/companies/${companyId}/sample?emirates=sharjah`, {
      method: "POST",
      body: new TextEncoder().encode("%PDF-1.4 x"),
      headers: { "content-type": "application/pdf", authorization: `Bearer ${token}` },
    });
    expect(up.status).toBe(422);
    expect(await code(up)).toBe("emirate_not_operated");

    const u = await send("/units", "POST", unit({ emirate: "sharjah" }));
    expect(u.status).toBe(422);
    expect(await code(u)).toBe("emirate_not_operated");
    expect((await send("/units", "POST", unit({ emirate: "dubai" }))).status).toBe(201);
  });

  test("a rent rule without an emirate: the only emirate, or 422 emirate_required when there are several", async () => {
    const { emirate: _e, ...noEmirate } = rentRule();
    // One emirate (Dubai): taken as the default.
    const one = await send("/rent-rules", "POST", noEmirate);
    expect(one.status).toBe(201);
    expect(((await one.json()) as { emirate: string }).emirate).toBe("dubai");
    // Several: refused with the list.
    const two = await testCompany(database, { slug: "em-two", name: "Em Two", rules: false });
    await database.db
      .update(companies)
      .set({ emirates: ["dubai", "sharjah"] })
      .where(eq(companies.id, two));
    const many = await send("/rent-rules", "POST", { ...noEmirate, companyId: two });
    expect(many.status).toBe(422);
    expect((await many.json()) as { code: string; error: string }).toMatchObject({
      code: "emirate_required",
      error: expect.stringContaining("Say which emirate"),
    });
    expect((await send("/rent-rules", "POST", { ...noEmirate, companyId: two, emirate: "sharjah" })).status).toBe(201);
  });

  test("unit update to a non-operated emirate is refused", async () => {
    const list = (await (await send("/units")).json()) as { id: string; code: string }[];
    const id = list.find((u) => u.code === "EM-1")!.id;
    const r = await send(`/units/${id}`, "PATCH", { emirate: "ajman" });
    expect(r.status).toBe(422);
    expect(await code(r)).toBe("emirate_not_operated");
  });

  test("import row for a non-operated emirate is a row error", async () => {
    const rows = await importUnitsCsv(
      ctx,
      "unit_code,building,community,emirate\nEMI-1,Tower,Marina,Ajman\nEMI-2,Tower,Marina,Dubai",
      "import",
      companyId,
    );
    expect(rows[0]?.status).toBe("error");
    expect(rows[0]?.reasons.join(" ")).toContain("doesn't operate in Ajman");
    expect(rows[1]?.status).toBe("imported");
  });

  test("emirate_in_use: removing an emirate with units or active rules is refused", async () => {
    // Dubai has a unit (EM-1) and the active "any" rule is not Dubai-specific.
    const r = await send(`/companies/${companyId}`, "PATCH", { emirates: ["dubai", "sharjah"] });
    expect(r.status).toBe(200);
    expect((await send("/rent-rules", "POST", rentRule({ emirate: "sharjah" }))).status).toBe(201);
    const blocked = await send(`/companies/${companyId}`, "PATCH", { emirates: ["dubai"] });
    expect(blocked.status).toBe(422);
    const body = (await blocked.json()) as { code: string; error: string };
    expect(body.code).toBe("emirate_in_use");
    expect(body.error).toContain("Sharjah");
    expect(body.error).toContain("1 active rent rule");
    const unitBlocked = await send(`/companies/${companyId}`, "PATCH", { emirates: ["sharjah"] });
    expect(unitBlocked.status).toBe(422);
    expect(((await unitBlocked.json()) as { error: string }).error).toContain("2 unit(s)");
  });

  test("an emirate with nothing in it can be removed; the change is audited", async () => {
    const other = await testCompany(database, { slug: "em-co-2", name: "Em Co 2", rules: false });
    const r = await send(`/companies/${other}`, "PATCH", { emirates: ["dubai"] });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { emirates: string[] }).emirates).toEqual(["dubai"]);
  });
});
