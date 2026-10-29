import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { contractRules, type Database, leaseEvents, rentRules } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";

describe.skipIf(noDb)("portfolio API (Postgres)", () => {
  let database: Database;
  let app: ReturnType<typeof createApi>;
  let companyId = "";
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z");
    companyId = await testCompany(database, { slug: "port-co", name: "Port Co", rules: false });
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_officer", "admin"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
  });

  const send = (role: string, path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
    });

  const rule = (over: Record<string, unknown> = {}) => ({
    companyId,
    category: "residential",
    emirate: "dubai",
    minPctBp: -500,
    maxPctBp: 1000,
    ...over,
  });
  const contract = (over: Record<string, unknown> = {}) => ({
    companyId,
    category: "residential",
    tenures: ["annual"],
    minCheques: 1,
    maxCheques: 4,
    clauseIds: ["no_pets"],
    ...over,
  });

  test("officer gets 403 on every write", async () => {
    const id = "00000000-0000-4000-8000-000000000001";
    const writes: [string, string, unknown][] = [
      ["/companies", "POST", { name: "X Co", kind: "owner" }],
      [`/companies/${companyId}`, "PATCH", { active: false }],
      ["/rent-rules", "POST", rule()],
      [`/rent-rules/${id}`, "PUT", rule()],
      [`/rent-rules/${id}`, "DELETE", undefined],
      ["/contract-rules", "POST", contract()],
      [`/contract-rules/${id}`, "PUT", contract()],
      [`/contract-rules/${id}`, "DELETE", undefined],
    ];
    for (const [path, method, body] of writes)
      expect((await send("leasing_officer", path, method, body)).status).toBe(403);
    expect((await send("leasing_officer", "/companies")).status).toBe(200);
  });

  test("admin creates a company; slug derived; duplicate slug is 409; unitCount present", async () => {
    const res = await send("admin", "/companies", "POST", { name: "  Acme Realty & Sons! ", kind: "realty" });
    expect(res.status).toBe(201);
    expect(((await res.json()) as { slug: string }).slug).toBe("acme-realty-sons");
    expect((await send("admin", "/companies", "POST", { name: "Acme Realty Sons", kind: "realty" })).status).toBe(409);
    expect((await send("admin", "/companies", "POST", { name: "!", kind: "realty" })).status).toBe(422);
    const list = (await (await send("admin", "/companies")).json()) as { slug: string; unitCount: number }[];
    expect(list.find((c) => c.slug === "acme-realty-sons")?.unitCount).toBe(0);
  });

  test("admin patches a company", async () => {
    const res = await send("admin", `/companies/${companyId}`, "PATCH", { active: false, email: "a@b.ae" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { active: boolean }).active).toBe(false);
    await send("admin", `/companies/${companyId}`, "PATCH", { active: true });
    expect((await send("admin", `/companies/00000000-0000-4000-8000-000000000009`, "PATCH", {})).status).toBe(404);
  });

  test("rent rule: create, validate, replace leaves one active, delete deactivates", async () => {
    const created = await send("admin", "/rent-rules", "POST", rule());
    expect(created.status).toBe(201);
    const first = (await created.json()) as { id: string };

    expect((await send("admin", "/rent-rules", "POST", rule({ minPctBp: 500, maxPctBp: -500 }))).status).toBe(422);
    expect((await send("admin", "/rent-rules", "POST", rule({ minRentFils: 500, maxRentFils: 100 }))).status).toBe(422);
    expect((await send("admin", "/rent-rules", "POST", rule({ subtype: "shop" }))).status).toBe(422);
    expect((await send("admin", "/rent-rules", "POST", rule({ minPctBp: -9000 }))).status).toBe(400);
    expect((await send("admin", "/rent-rules", "POST", rule({ emirate: "abu_dhabi" }))).status).toBe(400);
    expect((await send("admin", "/rent-rules", "POST", rule({ minRentFils: -1 }))).status).toBe(400);
    expect((await send("admin", "/rent-rules", "POST", rule({ maxRentFils: 2 ** 60 }))).status).toBe(400);

    const put = await send("admin", `/rent-rules/${first.id}`, "PUT", {
      ...rule({ maxPctBp: 800 }),
      companyId: undefined,
    });
    expect(put.status).toBe(200);
    const second = (await put.json()) as { id: string; supersedesId: string };
    expect(second.supersedesId).toBe(first.id);
    const rows = await database.db.select().from(rentRules).where(eq(rentRules.companyId, companyId));
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([second.id]);
    expect(rows.find((r) => r.id === first.id)?.active).toBe(false);

    expect((await send("admin", `/rent-rules/${first.id}`, "PUT", rule())).status).toBe(409);

    const active = (await (await send("admin", `/rent-rules?companyId=${companyId}`)).json()) as unknown[];
    expect(active).toHaveLength(1);
    const hist = (await (await send("admin", `/rent-rules?companyId=${companyId}&history=1`)).json()) as unknown[];
    expect(hist.length).toBe(rows.length);

    expect((await send("admin", `/rent-rules/${second.id}`, "DELETE")).status).toBe(200);
    expect(((await (await send("admin", `/rent-rules?companyId=${companyId}`)).json()) as unknown[]).length).toBe(0);
  });

  test("contract rule: create, validate, replace, delete", async () => {
    const created = await send("admin", "/contract-rules", "POST", contract());
    expect(created.status).toBe(201);
    const first = (await created.json()) as { id: string };

    expect((await send("admin", "/contract-rules", "POST", contract({ clauseIds: ["bogus"] }))).status).toBe(400);
    expect((await send("admin", "/contract-rules", "POST", contract({ tenures: [] }))).status).toBe(400);
    expect((await send("admin", "/contract-rules", "POST", contract({ minCheques: 13 }))).status).toBe(400);
    expect((await send("admin", "/contract-rules", "POST", contract({ minCheques: 6, maxCheques: 2 }))).status).toBe(
      422,
    );

    const put = await send("admin", `/contract-rules/${first.id}`, "PUT", {
      ...contract({ maxCheques: 6 }),
      companyId: undefined,
    });
    expect(put.status).toBe(200);
    const second = (await put.json()) as { id: string };
    const rows = await database.db.select().from(contractRules).where(eq(contractRules.companyId, companyId));
    expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([second.id]);
    expect((await send("admin", `/contract-rules/${second.id}`, "DELETE")).status).toBe(200);
    expect((await send("admin", `/contract-rules/${second.id}`, "DELETE")).status).toBe(200);
  });

  test("company and rule writes are audited with the actor and rulesVersion", async () => {
    const co = (await (await send("admin", "/companies", "POST", { name: "Audit Co", kind: "owner" })).json()) as {
      id: string;
    };
    await send("admin", `/companies/${co.id}`, "PATCH", { email: "x@y.ae" });
    const r1 = (await (await send("admin", "/rent-rules", "POST", rule({ companyId: co.id }))).json()) as {
      id: string;
    };
    const r2 = (await (
      await send("admin", `/rent-rules/${r1.id}`, "PUT", { ...rule({ maxPctBp: 800 }), companyId: undefined })
    ).json()) as { id: string };
    await send("admin", `/rent-rules/${r2.id}`, "DELETE");
    const c1 = (await (await send("admin", "/contract-rules", "POST", contract({ companyId: co.id }))).json()) as {
      id: string;
    };
    const c2 = (await (
      await send("admin", `/contract-rules/${c1.id}`, "PUT", { ...contract({ maxCheques: 6 }), companyId: undefined })
    ).json()) as { id: string };
    await send("admin", `/contract-rules/${c2.id}`, "DELETE");

    const events = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, co.id))).sort((a, b) =>
      a.id < b.id ? -1 : 1,
    );
    expect(events.map((e) => e.type)).toEqual([
      "COMPANY_CREATED",
      "COMPANY_UPDATED",
      "RENT_RULE_CREATED",
      "RENT_RULE_REPLACED",
      "RENT_RULE_DEACTIVATED",
      "CONTRACT_RULE_CREATED",
      "CONTRACT_RULE_REPLACED",
      "CONTRACT_RULE_DEACTIVATED",
    ]);
    for (const e of events) {
      expect(e.entityKind).toBe("company");
      expect(e.actor).toStartWith("user:");
      expect(e.rulesVersion).not.toBeNull();
    }
    expect(events[1]!.payload).toMatchObject({ changed: { email: { from: null, to: "x@y.ae" } } });
    expect(events[3]!.payload).toMatchObject({ ruleId: r2.id, supersedesId: r1.id });
    expect(events[4]!.payload).toMatchObject({ ruleId: r2.id });
    expect(events[6]!.payload).toMatchObject({ ruleId: c2.id, supersedesId: c1.id });
  });

  test("GET /sri rows carry category and per-sqft average", async () => {
    const rows = (await (await send("admin", "/sri")).json()) as Record<string, unknown>[];
    for (const r of rows) {
      expect(r).toHaveProperty("category");
      expect(r).toHaveProperty("avgAnnualRentPerSqftFils");
    }
  });
});
