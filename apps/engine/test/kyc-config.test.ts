import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { defaultBaseRules, defaultCompanyPolicy, STARTER_FORM } from "@leasing/core";
import { companyKycConfigs, type Database, leaseEvents } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

let database: Database;
const SECRET = "s";

async function setup() {
  const t = testContext(database, "2026-11-01T04:00:00Z");
  const companyId = await testCompany(database);
  const admin = await addStaff(database, "admin");
  const officer = await addStaff(database, "leasing_officer");
  const app = createApi(t.ctx, {
    sessionSecret: SECRET,
    mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "m-"))),
  });
  const call = (user: { id: string }, method = "GET", body?: unknown) =>
    app.request(`/api/companies/${companyId}/kyc-config`, {
      method,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${issueToken(SECRET, user.id, Date.now())}`,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  return { companyId, admin, officer, call };
}
const rules = (company: unknown[] = []) => ({ base: defaultBaseRules(defaultCompanyPolicy), company });

describe.skipIf(noDb)("document form and KYC rules settings (D46)", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("starts with the starter form; an admin save makes version 1, then 2, audited", async () => {
    const s = await setup();
    const start = (await (await s.call(s.officer)).json()) as { version: number; form: { key: string }[] };
    expect(start.version).toBe(0);
    expect(start.form.map((f) => f.key)).toEqual(STARTER_FORM.map((f) => f.key));
    expect((await s.call(s.admin, "PUT", { form: STARTER_FORM, rules: rules() })).status).toBe(200);
    const form2 = STARTER_FORM.filter((f) => f.key !== "visa");
    const r = await s.call(s.admin, "PUT", { form: form2, rules: rules() });
    expect(((await r.json()) as { version: number }).version).toBe(2);
    const rows = await database.db.select().from(companyKycConfigs).where(eq(companyKycConfigs.companyId, s.companyId));
    expect(rows.filter((x) => x.active).map((x) => x.version)).toEqual([2]);
    const ev = await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "KYC_CONFIG_SAVED"));
    expect(ev).toHaveLength(2);
  });

  test("only admins save", async () => {
    const s = await setup();
    expect((await s.call(s.officer, "PUT", { form: STARTER_FORM, rules: rules() })).status).toBe(403);
  });

  test("rules on nationality, religion or race are refused", async () => {
    const s = await setup();
    const ai = await s.call(s.admin, "PUT", {
      form: STARTER_FORM,
      rules: rules([
        { id: "x", type: "ai_check", label: "Check", instruction: "Only accept applicants whose nationality is X." },
      ]),
    });
    expect(ai.status).toBe(422);
    const match = await s.call(s.admin, "PUT", {
      form: [...STARTER_FORM, { key: "nat", label: "Nationality", type: "text", required: true }],
      rules: rules([
        { id: "y", type: "answer_matches_document", label: "Nat", fieldKey: "nat", identityField: "nationality" },
      ]),
    });
    expect(match.status).toBe(422);
  });

  test("bad configs are refused with reasons", async () => {
    const s = await setup();
    const missingField = await s.call(s.admin, "PUT", {
      form: STARTER_FORM,
      rules: rules([{ id: "x", type: "answer_required", label: "Employer", fieldKey: "employer" }]),
    });
    expect(missingField.status).toBe(422);
    expect(((await missingField.json()) as { reasons: string[] }).reasons.join(" ")).toContain("employer");
    const noDocs = await s.call(s.admin, "PUT", {
      form: STARTER_FORM.filter((f) => f.type !== "document"),
      rules: rules(),
    });
    expect(noDocs.status).toBe(422);
    const twoNames = await s.call(s.admin, "PUT", {
      form: [...STARTER_FORM, { ...STARTER_FORM[0]!, key: "other_name" }],
      rules: rules(),
    });
    expect(twoNames.status).toBe(422);
  });
});
