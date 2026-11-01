import { beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { companies, type Database, leaseEvents, parties } from "@leasing/db";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { fillMissingCompanyLegal } from "../src/manager/company-legal-fill.ts";
import { landlordGaps } from "../src/manager/company-legal.ts";
import { importCompaniesCsv } from "../src/manager/import.ts";
import { addStaff, freshDatabase, noDb, testContext } from "./harness.ts";

const EID = "784-1900-4000001-1";
const HEADER =
  "name,slug,kind,categories,legal_name_en,trade_licence_no,licence_authority,trade_licence_expires_on,registered_address,email,signatory_name,signatory_title,signatory_email,signatory_id_no,phone";
const full = (name: string, over: Partial<Record<string, string>> = {}) => {
  const v: Record<string, string> = {
    name,
    slug: "",
    kind: "realty",
    categories: "residential;retail",
    legal_name_en: `${name} L.L.C.`,
    trade_licence_no: "IMP-TL-1",
    licence_authority: "Test Authority",
    trade_licence_expires_on: "2030-05-31",
    registered_address: "1 Import Road Dubai",
    email: "legal@import.example",
    signatory_name: "Imp Signatory",
    signatory_title: "Director",
    signatory_email: "sig@import.example",
    signatory_id_no: EID,
    phone: "",
    ...over,
  };
  return HEADER.split(",")
    .map((k) => v[k] ?? "")
    .join(",");
};

describe.skipIf(noDb)("company import and demo legal fill (Postgres)", () => {
  let database: Database;
  let ctx: ReturnType<typeof testContext>["ctx"];
  let app: ReturnType<typeof createApi>;
  const tokens: Record<string, string> = {};

  beforeAll(async () => {
    database = await freshDatabase();
    ctx = testContext(database, "2026-10-19T04:00:00Z").ctx;
    app = createApi(ctx, {
      sessionSecret: "s",
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ["leasing_manager", "admin"] as const)
      tokens[role] = issueToken("s", (await addStaff(database, role)).id, Date.now());
  });

  const bySlug = async (slug: string) => {
    const [c] = await database.db.select().from(companies).where(eq(companies.slug, slug));
    return c!;
  };

  test("creates a company with its party and legal record", async () => {
    const rows = await importCompaniesCsv(ctx, `${HEADER}\n${full("Harbour Co")}`, "import");
    expect(rows).toMatchObject([{ row: 2, status: "imported", ref: "harbour-co", action: "created" }]);
    const c = await bySlug("harbour-co");
    const [p] = await database.db.select().from(parties).where(eq(parties.id, c.partyId!));
    expect(p?.fullNameEn).toBe("Harbour Co L.L.C.");
    expect(landlordGaps(c, p!, "2026-10-19" as never)).toEqual([]);
    expect(c.signatoryIdKind).toBe("emirates_id");
  });

  test("update changes only the provided fields and never blanks the rest", async () => {
    const csv = `name,phone,legal_name_ar\nharbour co,+971 4 000 0777,\n`;
    const rows = await importCompaniesCsv(ctx, csv, "import");
    expect(rows[0]).toMatchObject({ status: "imported", action: "updated", changedFields: ["phone"] });
    const c = await bySlug("harbour-co");
    const [p] = await database.db.select().from(parties).where(eq(parties.id, c.partyId!));
    expect(p?.phone).toBe("+971 4 000 0777");
    expect(c.signatoryName).toBe("Imp Signatory");
    // Same again: nothing to change.
    expect((await importCompaniesCsv(ctx, csv, "import"))[0]!.status).toBe("skipped");
    const ev = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, c.id));
    expect(ev.filter((e) => e.type === "COMPANY_LEGAL_UPDATED").at(-1)?.actor).toBe("import");
  });

  test("invalid rows are reported per row; a bad row doesn't block the rest", async () => {
    const csv = [
      HEADER,
      full("Bad Kind", { kind: "bank" }),
      full("Bad Cat", { categories: "marine" }),
      full("Past Licence", { trade_licence_expires_on: "2020-01-01" }),
      full("Bad Id", { signatory_id_no: "784-19-1" }),
      full("No Kind", { kind: "" }),
      "Partial Co,,developer,,,IMP-TL-2,,,,,,,,,",
      full("Good Co"),
    ].join("\n");
    const rows = await importCompaniesCsv(ctx, csv, "import");
    expect(rows.map((r) => r.status)).toEqual(["error", "error", "error", "error", "error", "error", "imported"]);
    expect(rows[0]!.reasons[0]).toStartWith("kind:");
    expect(rows[1]!.reasons[0]).toStartWith("categories");
    expect(rows[2]!.reasons.join()).toContain("trade licence must expire in the future");
    expect(rows[3]!.reasons[0]).toStartWith("signatory_id_no:");
    expect(rows[4]!.reasons[0]).toStartWith("kind: required for a new company");
    expect(rows[5]!.reasons.join()).toContain("licence_authority: required once any legal detail");
    // Rolled back rows left nothing behind.
    expect((await database.db.select().from(companies).where(eq(companies.slug, "partial-co"))).length).toBe(0);
    expect((await database.db.select().from(companies).where(eq(companies.slug, "past-licence"))).length).toBe(0);
  });

  test("admin only", async () => {
    const send = (role: string) =>
      app.request("/api/import/companies", {
        method: "POST",
        body: JSON.stringify({ csv: `${HEADER}\n${full("Role Co")}` }),
        headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
      });
    expect((await send("leasing_manager")).status).toBe(403);
    const ok = await send("admin");
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { imported: number }).imported).toBe(1);
  });

  test("ID numbers never appear in results, errors or events", async () => {
    const rows = await importCompaniesCsv(
      ctx,
      `${HEADER}\n${full("Mask Co", { signatory_id_no: "784-1900-4000009-9x", email: "bad" })}`,
      "import",
    );
    expect(rows[0]!.status).toBe("error");
    expect(JSON.stringify(rows)).not.toMatch(/784-?1900/);
    const events = await database.db.select().from(leaseEvents);
    for (const e of events) expect(JSON.stringify(e.payload)).not.toMatch(/784-?1900/);
  });

  test("demo:fill-legal fills only what is missing, is audited and idempotent", async () => {
    await database.db.insert(companies).values({
      id: crypto.randomUUID(),
      slug: "half-co",
      name: "Half Co",
      kind: "developer",
      createdBy: "test",
      signatoryName: "Kept Name",
      registeredAddress: "Kept Address",
    });
    await database.db.insert(companies).values({
      id: crypto.randomUUID(),
      slug: "silverline",
      name: "Silverline Properties",
      kind: "developer",
      createdBy: "test",
    });
    const first = await fillMissingCompanyLegal(ctx);
    expect(first.filter((r) => r.error)).toEqual([]);
    const half = first.find((r) => r.company === "Half Co")!;
    expect(half.filled).not.toContain("signatoryName");
    expect(half.filled).toContain("tradeLicenceNo");
    const c = await bySlug("half-co");
    expect(c).toMatchObject({ signatoryName: "Kept Name", registeredAddress: "Kept Address" });
    expect(c.signatoryEmail).toBe("signatory@half-co.demo.example");
    expect(c.signatoryIdNo).toMatch(/^784-1900-\d{7}-\d$/);
    const [p] = await database.db.select().from(parties).where(eq(parties.id, c.partyId!));
    expect(p).toMatchObject({ fullNameEn: "Half Co LLC", tradeLicenceExpiresOn: "2028-10-19" });
    expect(landlordGaps(c, p!, "2026-10-19" as never)).toEqual([]);
    expect((await bySlug("silverline")).signatoryName).toBe("Idris Example Malik");
    const ev = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, c.id))).find(
      (e) => e.type === "COMPANY_LEGAL_UPDATED",
    );
    expect(ev?.actor).toBe("system:demo");
    expect(JSON.stringify(ev?.payload)).not.toMatch(/784-?1900/);
    const second = await fillMissingCompanyLegal(ctx);
    expect(second.every((r) => !r.filled.length && !r.error)).toBe(true);
  });

  test("demo:fill-legal refuses outside demo mode", async () => {
    await expect(fillMissingCompanyLegal({ ...ctx, demoMode: false })).rejects.toThrow("DEMO_MODE");
  });
});
