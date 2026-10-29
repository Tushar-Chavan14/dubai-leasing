import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import type { CalendarDate } from "@leasing/core";
import { companies, type Database, leaseEvents, parties, units } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { landlordGapMessage, landlordGaps } from "../src/manager/company-legal.ts";
import { importUnitsCsv } from "../src/manager/import.ts";
import { addStaff, freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const SECRET = "test-secret";
const EID = "784-1900-3000001-4";

const legal = (over: Record<string, unknown> = {}) => ({
  legalNameEn: "Landlord Test L.L.C.",
  legalNameAr: null,
  tradeLicenceNo: "TEST-TL-77",
  tradeLicenceAuthority: "Test Authority",
  tradeLicenceExpiresOn: "2030-01-31",
  reraOrn: null,
  registeredAddress: "2 Test Road, Dubai",
  email: "legal@landlord-test.example",
  phone: null,
  chequePayeeName: null,
  signatoryName: "Sam Signatory",
  signatoryTitle: "Director",
  signatoryEmail: "sam@landlord-test.example",
  signatoryIdKind: "emirates_id",
  signatoryIdNo: EID,
  signatoryIdExpiresOn: "2031-01-31",
  ...over,
});

describe.skipIf(noDb)("company is the landlord (D44, Postgres)", () => {
  let database: Database;
  let app: ReturnType<typeof createApi>;
  let ctx: ReturnType<typeof testContext>["ctx"];
  let companyId = "";
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-10-19T04:00:00Z");
    ctx = t.ctx;
    app = createApi(ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_officer", "finance", "admin"] as const) {
      tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
    }
    // A bare company: no signatory, no address.
    const [c] = await database.db
      .insert(companies)
      .values({ id: crypto.randomUUID(), slug: "bare-co", name: "Bare Co", kind: "developer", createdBy: "test" })
      .returning();
    companyId = c!.id;
  });

  const send = (role: string, path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
    });

  test("a company without details reports what is missing", async () => {
    const r = await send("admin", `/companies/${companyId}/legal`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as { missing: string[] };
    expect(body.missing).toContain("authorised signatory name");
    expect(body.missing).toContain("registered address");
    const list = (await (await send("admin", "/companies")).json()) as { id: string; legalComplete: boolean }[];
    expect(list.find((x) => x.id === companyId)?.legalComplete).toBe(false);
    // Read routes are read-only: no party was created for the bare company.
    const [bare] = await database.db.select().from(companies).where(eq(companies.id, companyId));
    expect(bare?.partyId).toBeNull();
    expect(await database.db.select().from(parties)).toHaveLength(0);
    const gaps = body.missing;
    expect(landlordGapMessage("Bare Co", gaps)).toStartWith("Complete Bare Co's legal details in Settings → Companies");
  });

  test("only an admin saves; the party row and company columns are written", async () => {
    expect((await send("leasing_officer", `/companies/${companyId}/legal`, "PUT", legal())).status).toBe(403);
    const r = await send("admin", `/companies/${companyId}/legal`, "PUT", legal());
    expect(r.status).toBe(200);
    const [co] = await database.db.select().from(companies).where(eq(companies.id, companyId));
    expect(co?.partyId).toBeTruthy();
    const [party] = await database.db.select().from(parties).where(eq(parties.id, co!.partyId!));
    expect(party).toMatchObject({
      kind: "company",
      fullNameEn: "Landlord Test L.L.C.",
      tradeLicenceNo: "TEST-TL-77",
      tradeLicenceExpiresOn: "2030-01-31",
      email: "legal@landlord-test.example",
    });
    expect(co).toMatchObject({ signatoryName: "Sam Signatory", registeredAddress: "2 Test Road, Dubai" });
    expect(landlordGaps(co!, party!, "2026-10-19" as CalendarDate)).toEqual([]);
    // An expired licence blocks again.
    expect(landlordGaps(co!, party!, "2031-01-01" as CalendarDate)).toEqual(["a trade licence that has not expired"]);
    const list = (await (await send("admin", "/companies")).json()) as { id: string; legalComplete: boolean }[];
    expect(list.find((x) => x.id === companyId)?.legalComplete).toBe(true);
  });

  test("the audit event names the changed fields and never holds the ID number", async () => {
    await send("admin", `/companies/${companyId}/legal`, "PUT", legal({ signatoryIdNo: "784-1900-3000002-2" }));
    const events = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, companyId))).filter(
      (e) => e.type === "COMPANY_LEGAL_UPDATED",
    );
    expect(events.length).toBeGreaterThanOrEqual(2);
    const last = events.sort((a, b) => a.at.getTime() - b.at.getTime()).at(-1)!;
    expect(last.actor).toMatch(/^user:/);
    expect(last.payload).toMatchObject({ changedFields: ["signatoryIdNo"], idChanged: true });
    for (const e of events) expect(JSON.stringify(e.payload)).not.toMatch(/784-?1900/);
  });

  test("validation: licence expiry in the future, ID format, email", async () => {
    const bad = async (over: Record<string, unknown>) =>
      (await send("admin", `/companies/${companyId}/legal`, "PUT", legal(over))).status;
    expect(await bad({ tradeLicenceExpiresOn: "2026-10-19" })).toBe(422);
    expect(await bad({ signatoryIdNo: "784-19-1" })).toBe(400);
    expect(await bad({ signatoryEmail: "not-an-email" })).toBe(400);
    expect(await bad({ signatoryIdKind: "passport", signatoryIdNo: "N1234567" })).toBe(200);
  });

  test("finance sees the signatory ID and licence number masked; leasing officer and admin see them in full", async () => {
    await send("admin", `/companies/${companyId}/legal`, "PUT", legal());
    type View = { legal: { signatoryIdNo: string; tradeLicenceNo: string } };
    const f = (await (await send("finance", `/companies/${companyId}/legal`)).json()) as View;
    expect(f.legal.signatoryIdNo).not.toBe(EID);
    expect(f.legal.signatoryIdNo).toMatch(/^\*+[\d-]{3}$/);
    expect(f.legal.tradeLicenceNo).toMatch(/^\*+.{3}$/);
    expect(f.legal.tradeLicenceNo).not.toBe("TEST-TL-77");
    for (const role of ["leasing_officer", "admin"]) {
      const v = (await (await send(role, `/companies/${companyId}/legal`)).json()) as View;
      expect(v.legal.signatoryIdNo).toBe(EID);
      expect(v.legal.tradeLicenceNo).toBe("TEST-TL-77");
    }
  });

  test("unit import: company column by name or slug; unknown company is a row error", async () => {
    const other = await testCompany(database, { slug: "imp-co", name: "Import Co" });
    const csv = [
      "unit_code,building,community,company",
      "IMP-1,Tower,Marina,Import Co",
      "IMP-2,Tower,Marina,bare-co",
      "IMP-3,Tower,Marina,Nobody Realty",
      "IMP-4,Tower,Marina,",
    ].join("\n");
    const rows = await importUnitsCsv(ctx, csv, "import", null);
    expect(rows.map((r) => r.status)).toEqual(["imported", "imported", "error", "error"]);
    expect(rows[2]!.reasons[0]).toContain("unknown or inactive company");
    expect(rows[3]!.reasons[0]).toContain("company: required");
    const [u1] = await database.db.select().from(units).where(eq(units.code, "IMP-1"));
    const [u2] = await database.db.select().from(units).where(eq(units.code, "IMP-2"));
    expect(u1?.companyId).toBe(other);
    expect(u2?.companyId).toBe(companyId);
    expect(u1?.landlordPartyId).toBeNull();
    // The default company fills rows that leave the column out.
    const again = await importUnitsCsv(ctx, "unit_code,building,community\nIMP-5,Tower,Marina", "import", other);
    expect(again[0]!.status).toBe("imported");
  });

  test("unit page shows the company's legal name as the landlord", async () => {
    const [u] = await database.db.select().from(units).where(eq(units.code, "IMP-2"));
    const r = await send("admin", `/units/${u!.id}`);
    const body = (await r.json()) as { landlord: { companyId: string; name: string }; landlordPartyId?: unknown };
    expect(body.landlord).toEqual({ companyId, name: "Landlord Test L.L.C." });
    expect(body.landlordPartyId).toBeUndefined();
  });
});
