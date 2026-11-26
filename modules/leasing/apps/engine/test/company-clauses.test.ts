import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { newId } from "@leasing/core";
import { companyClauses, contractRules, type Database, leaseEvents } from "@leasing/db";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";
let database: Database;

async function setup() {
  const t = testContext(database, "2026-11-01T04:00:00Z");
  const companyId = await testCompany(database);
  const other = await testCompany(database, { slug: "other-co", name: "Other Co" });
  const admin = await addStaff(database, "admin");
  const officer = await addStaff(database, "leasing_officer");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const call = (user: { id: string }, path: string, method = "GET", body?: unknown) =>
    app.request(path, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  const rule = async (company: string) => {
    const id = newId();
    await database.db.insert(contractRules).values({
      id,
      companyId: company,
      category: "residential",
      tenures: ["annual"],
      minCheques: 1,
      maxCheques: 4,
      clauseIds: ["parking"],
      createdBy: "test",
    });
    return id;
  };
  return { t, companyId, other, admin, officer, call, rule };
}

describe.skipIf(noDb)("manual company clauses", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("an admin adds a clause: approved on save, audited", async () => {
    const s = await setup();
    const r = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "Pets",
      text: "The tenant keeps no pets in the unit without the landlord's written consent.",
    });
    expect(r.status).toBe(201);
    const c = (await r.json()) as { id: string; status: string; hasValues: boolean };
    expect(c).toMatchObject({ status: "approved", hasValues: false });
    const [row] = await database.db.select().from(companyClauses).where(eq(companyClauses.id, c.id));
    expect(row!.approvedBy).toBe(`user:${s.admin.id}`);
    const ev = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, s.companyId), eq(leaseEvents.type, "COMPANY_CLAUSE_ADDED")));
    expect(ev).toHaveLength(1);
    const list = (await (await s.call(s.officer, `/api/companies/${s.companyId}/clauses`)).json()) as {
      inTemplate: unknown[];
      additional: { id: string }[];
    };
    expect(list.additional.map((x) => x.id)).toEqual([c.id]);
    expect(list.inTemplate).toEqual([]);
  });

  test("an officer can't add a clause", async () => {
    const s = await setup();
    const r = await s.call(s.officer, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "X",
      text: "Some text here.",
    });
    expect(r.status).toBe(403);
  });

  test("a clause with amounts needs the admin to confirm them", async () => {
    const s = await setup();
    const body = { title: "Fee", text: "A fee of AED 5,000 applies to early termination." };
    const r = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", body);
    expect(r.status).toBe(422);
    expect(((await r.json()) as { code: string }).code).toBe("confirm_values");
    const ok = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", { ...body, confirmValues: true });
    expect(ok.status).toBe(201);
    expect(((await ok.json()) as { hasValues: boolean }).hasValues).toBe(true);
  });

  test("attached to a rule: the rule gets a new version with the clause", async () => {
    const s = await setup();
    const ruleId = await s.rule(s.companyId);
    const r = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "Pets",
      text: "The tenant keeps no pets in the unit without consent.",
      ruleIds: [ruleId],
    });
    expect(r.status).toBe(201);
    const c = (await r.json()) as { id: string };
    const [active] = await database.db
      .select()
      .from(contractRules)
      .where(and(eq(contractRules.companyId, s.companyId), eq(contractRules.active, true)));
    expect(active!.supersedesId).toBe(ruleId);
    expect(active!.clauseIds).toEqual(["parking", `cc:${c.id}`]);
  });

  test("a rule of another company is refused", async () => {
    const s = await setup();
    const foreign = await s.rule(s.other);
    const r = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "Pets",
      text: "The tenant keeps no pets in the unit without consent.",
      ruleIds: [foreign],
    });
    expect(r.status).toBe(422);
    expect(await database.db.select().from(companyClauses)).toHaveLength(0);
  });

  test("an admin edits an approved clause any time; the old wording stays in the audit", async () => {
    const s = await setup();
    const add = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "Pets",
      text: "No pets in the unit.",
    });
    const { id } = (await add.json()) as { id: string };
    expect((await s.call(s.officer, `/api/company-clauses/${id}`, "PATCH", { text: "x" })).status).toBe(403);
    const fee = await s.call(s.admin, `/api/company-clauses/${id}`, "PATCH", { text: "A pet fee of AED 500 applies." });
    expect(((await fee.json()) as { code: string }).code).toBe("confirm_values");
    const ok = await s.call(s.admin, `/api/company-clauses/${id}`, "PATCH", {
      title: "Pets allowed",
      text: "A pet fee of AED 500 applies.",
      confirmValues: true,
    });
    expect(ok.status).toBe(200);
    const [row] = await database.db.select().from(companyClauses).where(eq(companyClauses.id, id));
    expect(row).toMatchObject({ title: "Pets allowed", textEn: "A pet fee of AED 500 applies.", hasValues: true });
    const [ev] = await database.db
      .select()
      .from(leaseEvents)
      .where(and(eq(leaseEvents.entityId, s.companyId), eq(leaseEvents.type, "COMPANY_CLAUSE_EDITED")));
    expect(ev!.payload).toMatchObject({ before: { title: "Pets", text: "No pets in the unit." } });
  });

  test("removing a clause takes it out of the company's active rules and the clause list", async () => {
    const s = await setup();
    const ruleId = await s.rule(s.companyId);
    const add = await s.call(s.admin, `/api/companies/${s.companyId}/clauses`, "POST", {
      title: "Pets",
      text: "No pets in the unit.",
      ruleIds: [ruleId],
    });
    const { id } = (await add.json()) as { id: string };
    const r = await s.call(s.admin, `/api/company-clauses/${id}`, "DELETE");
    expect(r.status).toBe(200);
    const [active] = await database.db
      .select()
      .from(contractRules)
      .where(and(eq(contractRules.companyId, s.companyId), eq(contractRules.active, true)));
    expect(active!.clauseIds).toEqual(["parking"]);
    const list = (await (await s.call(s.admin, `/api/companies/${s.companyId}/clauses`)).json()) as {
      additional: unknown[];
    };
    expect(list.additional).toEqual([]);
    // Already removed: nothing more to do.
    expect((await s.call(s.admin, `/api/company-clauses/${id}`, "DELETE")).status).toBe(409);
  });
});
