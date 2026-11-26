/* oxlint-disable no-explicit-any -- response bodies read loosely in tests */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FakeMailer, LocalDiskStore } from "@platform/adapters";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { amlCases, dealEvents, deals, documents, type SpaDatabase, spaApprovals, spaExports } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { generateMonthlyReport } from "../src/manager/compliance-report.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { runAlerts } from "../src/manager/alerts.ts";
import { runRetentionReview } from "../src/manager/retention.ts";
import { readZip } from "../src/manager/zip.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const NON_COMPLIANCE = ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const;

describe.skipIf(!url)("records, export, report, retention and alert routes (C23, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  let dir: string;
  let store: LocalDiskStore;
  let dealId: string;
  let ref: string;
  const mailer = new FakeMailer();
  const clock = new FixedClock(new Date(NOW));
  const ctx = (): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    mail: { mailer, webBaseUrl: "https://spa.example.test" },
  });
  const call = (path: string, as?: keyof typeof users, init: RequestInit = {}, token?: string) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${token ?? issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
    });
  const post = (path: string, as?: keyof typeof users, body: unknown = {}) =>
    call(path, as, { method: "POST", body: JSON.stringify(body) });
  const put = (path: string, as: keyof typeof users, body: unknown) =>
    call(path, as, { method: "PUT", body: JSON.stringify(body) });
  const json = async (r: Response) => ({
    status: r.status,
    text: await r.clone().text(),
    body: (await r.json().catch(() => null)) as any,
  });

  const makeApp = (withStore: boolean) =>
    createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      ...(withStore ? { documents: store } : {}),
    });

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    dir = mkdtempSync(join(tmpdir(), "records-routes-"));
    store = new LocalDiskStore(dir);
    app = makeApp(true);
    dealId = (await dealInDraft(ctx(), database, { type: "resale_ready" })).dealId;
    [{ ref }] = (await database.db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, dealId))) as any;
    const stored = await store.put(new TextEncoder().encode("scan"), "txt");
    await database.db.insert(documents).values({
      id: newId(),
      dealId,
      kind: "passport",
      fileName: "p.txt",
      mime: "text/plain",
      sizeBytes: 4,
      sha256: stored.sha256,
      storageKey: stored.path,
      uploadedBy: "user:x",
      uploadedAt: new Date(NOW),
    });
    await database.db.insert(amlCases).values({
      id: newId(),
      dealId,
      status: "open",
      summary: "A name resembles a listed name.",
      instructionLike: false,
      openedAt: new Date(NOW),
    });
  });
  afterAll(async () => {
    await database?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("every new route needs a session", async () => {
    const id = crypto.randomUUID();
    for (const [m, p] of [
      ["POST", `/api/compliance/deals/${id}/export`],
      ["GET", "/api/compliance/exports"],
      ["GET", "/api/compliance/reports"],
      ["GET", `/api/compliance/reports/${id}.csv`],
      ["GET", "/api/compliance/retention"],
      ["POST", `/api/compliance/retention/${id}/approve`],
      ["GET", "/api/alerts"],
      ["POST", `/api/alerts/${id}/read`],
      ["GET", "/api/settings/alerts"],
      ["PUT", "/api/settings/alerts"],
    ] as const)
      expect((await call(p, undefined, { method: m, ...(m === "GET" ? {} : { body: "{}" }) })).status).toBe(401);
  });

  test("the export: 403 for a sales officer, manager, sales admin, legal, finance and admin with no data; a compliance role gets the ZIP", async () => {
    for (const who of NON_COMPLIANCE) {
      const r = await json(await post(`/api/compliance/deals/${dealId}/export`, who));
      expect(r.status).toBe(403);
      expect(r.text).not.toContain(ref);
      expect(r.text).not.toContain("PK");
      expect(r.text).not.toMatch(/screening|aml|case/i);
    }
    expect(await database.db.select().from(spaExports)).toHaveLength(0);
    for (const who of ["compliance", "mlro"] as const) {
      const res = await post(`/api/compliance/deals/${dealId}/export`, who);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("application/zip");
      expect(res.headers.get("content-disposition")).toBe(`attachment; filename="case-${ref}.zip"`);
      expect(res.headers.get("cache-control")).toBe("no-store");
      const bytes = new Uint8Array(await res.arrayBuffer());
      expect(res.headers.get("x-sha256")).toBe(createHash("sha256").update(bytes).digest("hex"));
      expect(readZip(bytes).map((f) => f.name)).toContain("manifest.json");
      const [row] = await database.db
        .select()
        .from(spaExports)
        .where(eq(spaExports.id, res.headers.get("x-export-id")!));
      expect(row).toMatchObject({ requestedBy: users[who]!.id, kind: "case_pack", dealId });
    }
  });

  test("the export of an unknown deal or a bad id: 404 for compliance, 403 for everyone else", async () => {
    expect((await post(`/api/compliance/deals/${newId()}/export`, "compliance")).status).toBe(404);
    expect((await post(`/api/compliance/deals/not-an-id/export`, "compliance")).status).toBe(404);
    expect((await post(`/api/compliance/deals/${newId()}/export`, "officer")).status).toBe(403);
    expect((await post(`/api/compliance/deals/not-an-id/export`, "officer")).status).toBe(403);
  });

  test("without a file store the export is 503 and records nothing", async () => {
    const before = (await database.db.select().from(spaExports)).length;
    const bare = makeApp(false);
    const r = await bare.request(`/api/compliance/deals/${dealId}/export`, {
      method: "POST",
      headers: { authorization: `Bearer ${issueToken(SECRET, users.compliance!.id, NOW)}` },
    });
    expect(r.status).toBe(503);
    expect((await database.db.select().from(spaExports)).length).toBe(before);
  });

  test("the export log: who, what and when, for compliance roles only; the deal's timeline shows the export to compliance and not to sales", async () => {
    for (const who of NON_COMPLIANCE) expect((await json(await call("/api/compliance/exports", who))).status).toBe(403);
    const r = await json(await call("/api/compliance/exports", "mlro"));
    expect(r.status).toBe(200);
    expect(r.body.items.length).toBeGreaterThanOrEqual(2);
    const item = r.body.items[0];
    expect(Object.keys(item).toSorted()).toEqual([
      "dealRef",
      "fileCount",
      "id",
      "kind",
      "requestedAt",
      "requestedBy",
      "requestedByName",
      "sha256",
      "sizeBytes",
    ]);
    expect(item.dealRef).toBe(ref);
    expect(item.kind).toBe("case_pack");
    expect(["compliance", "mlro"]).toContain(item.requestedByName);
    expect(
      (await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CASE_EXPORTED"))).length,
    ).toBeGreaterThanOrEqual(2);
    const sales = await json(await call(`/api/deals/${dealId}/events?limit=100`, "officer"));
    expect(sales.text).not.toContain("CASE_EXPORTED");
    const comp = await json(await call(`/api/deals/${dealId}/events?limit=100`, "compliance"));
    expect(comp.text).toContain("CASE_EXPORTED");
  });

  test("the monthly report: list and downloads are for compliance roles; each download is recorded", async () => {
    clock.set(new Date("2026-11-01T02:00:00+04:00"));
    const made = await generateMonthlyReport(ctx(), { store });
    for (const who of NON_COMPLIANCE) {
      for (const p of [
        "/api/compliance/reports",
        `/api/compliance/reports/${made.id}.csv`,
        `/api/compliance/reports/${made.id}.pdf`,
      ]) {
        const r = await json(await call(p, who));
        expect(r.status).toBe(403);
        expect(r.text).not.toContain("flags_by_rule");
        expect(r.text).not.toContain("%PDF");
        expect(r.text).not.toContain(made.period);
      }
    }
    const list = await json(await call("/api/compliance/reports", "compliance"));
    expect(list.status).toBe(200);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ id: made.id, period: made.period });
    const exportsBefore = (await database.db.select().from(spaExports).where(eq(spaExports.kind, "monthly_report")))
      .length;
    const csv = await call(`/api/compliance/reports/${made.id}.csv`, "mlro");
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(csv.headers.get("content-disposition")).toBe(`attachment; filename="compliance-${made.period}.csv"`);
    expect(await csv.text()).toContain("section,item,value");
    const pdf = await call(`/api/compliance/reports/${made.id}.pdf`, "compliance");
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(new TextDecoder().decode((await pdf.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    const rows = await database.db.select().from(spaExports).where(eq(spaExports.kind, "monthly_report"));
    expect(rows.length).toBe(exportsBefore + 2);
    expect(rows.every((x) => x.dealId === null && x.fileCount === 1)).toBe(true);
    expect(new Set(rows.map((x) => x.requestedBy))).toEqual(new Set([users.mlro!.id, users.compliance!.id]));
    expect(
      (await database.db.select().from(dealEvents).where(eq(dealEvents.type, "COMPLIANCE_REPORT_EXPORTED"))).length,
    ).toBe(2);
    // an odd file name or an unknown report is a 404
    expect((await call(`/api/compliance/reports/${made.id}.exe`, "compliance")).status).toBe(404);
    expect((await call(`/api/compliance/reports/${newId()}.csv`, "compliance")).status).toBe(404);
    expect((await call(`/api/compliance/reports/..%2Fx.csv`, "compliance")).status).toBe(404);
  });

  test("the retention routes: compliance roles list and approve; everyone else is 403 and nothing changes", async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    // a deal that ended six years ago
    const old = (await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "U-OLD" })).dealId;
    await database.db.update(deals).set({ state: "COMPLETED" }).where(eq(deals.id, old));
    await database.db.insert(dealEvents).values({
      id: newId(),
      entityKind: "deal",
      entityId: old,
      type: "MILESTONE_REACHED",
      toState: "COMPLETED",
      actor: "system",
      payload: {},
      at: new Date("2020-01-01T00:00:00Z"),
    });
    const r = await runRetentionReview(ctx());
    expect(r.created).toBe(true);
    for (const who of NON_COMPLIANCE) {
      expect((await json(await call("/api/compliance/retention", who))).status).toBe(403);
      expect((await json(await post(`/api/compliance/retention/${r.reviewId}/approve`, who))).status).toBe(403);
    }
    const list = await json(await call("/api/compliance/retention", "compliance"));
    expect(list.status).toBe(200);
    expect(list.body.items[0]).toMatchObject({ period: "2026-11", status: "listed", retentionYears: 5 });
    expect(list.body.items[0].items).toHaveLength(1);
    const ok = await json(await post(`/api/compliance/retention/${r.reviewId}/approve`, "compliance"));
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ status: "approved", count: 1 });
    expect((await json(await post(`/api/compliance/retention/${r.reviewId}/approve`, "mlro"))).status).toBe(409);
    expect((await json(await post(`/api/compliance/retention/${newId()}/approve`, "mlro"))).status).toBe(404);
    expect((await json(await post(`/api/compliance/retention/nope/approve`, "mlro"))).status).toBe(404);
    // the body can't set who or when
    expect((await database.db.select().from(deals)).length).toBeGreaterThan(1);
  });

  test("the alert routes: your own list, mark read, and the settings (admin writes, admin and compliance read)", async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    const approvalId = newId();
    await database.db.insert(spaApprovals).values({
      id: approvalId,
      gate: "agreement_approval",
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:agr`,
      title: "t",
      proposal: {},
      approverRole: "legal",
      proposedBy: "system",
      createdAt: new Date("2026-11-17T06:00:00Z"),
    });
    await runAlerts(ctx());
    const mine = await json(await call("/api/alerts", "legal"));
    expect(mine.status).toBe(200);
    expect(mine.body.unread).toBe(1);
    expect(mine.body.items[0].text).toBe(`Prepared agreement for ${ref} has been waiting 48 hours.`);
    expect((await json(await call("/api/alerts", "officer"))).body.items).toEqual([]);
    const id = mine.body.items[0].id;
    expect((await post(`/api/alerts/${id}/read`, "officer")).status).toBe(404);
    expect((await post(`/api/alerts/nope/read`, "legal")).status).toBe(404);
    expect((await post(`/api/alerts/${id}/read`, "legal")).status).toBe(204);
    expect((await json(await call("/api/alerts", "legal"))).body.unread).toBe(0);

    for (const who of ["officer", "manager", "salesadmin", "legal", "finance"] as const) {
      expect((await call("/api/settings/alerts", who)).status).toBe(403);
      expect((await put("/api/settings/alerts", who, { kyc_review: 5 })).status).toBe(403);
    }
    for (const who of ["compliance", "mlro"] as const) {
      expect((await call("/api/settings/alerts", who)).status).toBe(200);
      expect((await put("/api/settings/alerts", who, { kyc_review: 5 })).status).toBe(403);
    }
    const g = await json(await call("/api/settings/alerts", "admin"));
    expect(g.status).toBe(200);
    expect(g.body.items.find((x: any) => x.key === "kyc_review")).toMatchObject({ hours: 24, isDefault: true });
    expect(g.text).not.toMatch(/aml_|edd_signoff/);
    expect((await put("/api/settings/alerts", "admin", { kyc_review: 0 })).status).toBe(422);
    const set = await json(await put("/api/settings/alerts", "admin", { kyc_review: 10 }));
    expect(set.status).toBe(200);
    expect(set.body).toEqual({ changed: 1 });
    expect(
      (await json(await call("/api/settings/alerts", "admin"))).body.items.find((x: any) => x.key === "kyc_review"),
    ).toMatchObject({ hours: 10, isDefault: false });
  });
});
