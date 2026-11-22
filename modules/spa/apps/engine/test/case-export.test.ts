/* oxlint-disable no-explicit-any -- rows read loosely in tests */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import {
  amlCases,
  amlHits,
  dealEvents,
  deals,
  documents,
  helperRuns,
  type SpaDatabase,
  spaApprovals,
  spaExports,
  screenings,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { exportCasePack } from "../src/manager/case-export.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { readZip } from "../src/manager/zip.ts";
import { dealInDraft, party, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const AT = new Date("2026-11-19T06:00:00Z");

describe.skipIf(!url)("case export pack (C23, S29, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  let dealId: string;
  let ref: string;
  const ctx = (): SpaContext => ({ database, clock: new FixedClock(AT), facts: failClosedFacts });
  const DOC_A = new TextEncoder().encode("passport scan A");
  const DOC_B = new Uint8Array([1, 2, 3, 4, 5]);

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    dir = mkdtempSync(join(tmpdir(), "case-export-"));
    store = new LocalDiskStore(dir);
    const made = await dealInDraft(ctx(), database, { type: "resale_ready", buyers: ["Buyer One"] });
    dealId = made.dealId;
    [{ ref }] = (await database.db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, dealId))) as any;
    for (const [i, bytes] of [DOC_A, DOC_B].entries()) {
      const put = await store.put(bytes, i === 0 ? "txt" : "bin");
      await database.db.insert(documents).values({
        id: newId(),
        dealId,
        partyId: made.buyerIds[0]!,
        kind: "passport",
        fileName: i === 0 ? "../../etc/passwd.txt" : "scan b.bin",
        mime: "application/octet-stream",
        sizeBytes: bytes.byteLength,
        sha256: put.sha256,
        storageKey: put.path,
        uploadedBy: "user:x",
        uploadedAt: AT,
      });
    }
    await database.db.insert(screenings).values({
      id: newId(),
      dealId,
      partyId: made.buyerIds[0]!,
      subjectKey: "buyer-1",
      trigger: "offer",
      listVersion: "demo-list-1",
      sanctionsScore: 0.91,
      pepScore: null,
      exact: false,
      matches: { name: "Buyer One" },
      screenedAt: AT,
    } as any);
    const caseId = newId();
    const approvalId = newId();
    await database.db.insert(spaApprovals).values([
      {
        id: approvalId,
        gate: "aml_flag",
        entityKind: "deal",
        entityId: dealId,
        dedupeKey: `${dealId}:aml_flag`,
        title: "Warning sign",
        proposal: {},
        rulesVersion: "dubai-sales-2026-01",
        approverRole: "compliance_officer",
        status: "approved",
        outcome: "clear",
        proposedBy: "system",
        decidedBy: users.compliance!.id,
        decidedAt: new Date("2026-11-18T10:00:00Z"),
        decisionNote: '=HYPERLINK("http://x"), cleared after review',
        createdAt: new Date("2026-11-17T10:00:00Z"),
      },
      {
        id: newId(),
        gate: "kyc_review",
        entityKind: "deal",
        entityId: dealId,
        dedupeKey: `${dealId}:kyc_review`,
        title: "Names don't match",
        proposal: {},
        rulesVersion: "dubai-sales-2026-01",
        approverRole: "sales_manager",
        status: "rejected",
        proposedBy: "system",
        decidedBy: users.manager!.id,
        decidedAt: new Date("2026-11-17T12:00:00Z"),
        decisionNote: "Eid 784-1985-1234567-1 on file",
        createdAt: new Date("2026-11-17T11:00:00Z"),
      },
    ]);
    await database.db.insert(amlCases).values({
      id: caseId,
      dealId,
      status: "cleared",
      approvalId,
      summary: "A name resembles a listed name.",
      instructionLike: false,
      openedAt: AT,
    });
    await database.db.insert(amlHits).values({
      id: newId(),
      caseId,
      subjectKey: "buyer-1",
      rule: "sanctions" as any,
      severity: "flag",
      detail: "score 0.91",
      listVersion: "demo-list-1",
      createdAt: AT,
    });
    await database.db.insert(helperRuns).values({
      id: newId(),
      helper: "kyc",
      dealId,
      entityKind: "deal",
      entityId: dealId,
      status: "ok",
      result: {},
      reasons: [],
      rulesVersion: "dubai-sales-2026-01",
      kycConfigVersion: 3,
      amlPolicyVersion: 2,
      createdAt: new Date("2026-11-17T09:00:00Z"),
    });
  });
  afterAll(async () => {
    await database?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  const exportsCount = async () => (await database.db.select().from(spaExports)).length;

  test("a sales officer, manager, sales admin, legal, finance and admin are refused (403), even for a deal that does not exist", async () => {
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const) {
      for (const id of [dealId, newId()]) {
        const r = await exportCasePack(ctx(), { store }, id, users[who]!).catch((e) => e);
        expect(r.status).toBe(403);
      }
    }
    expect(await exportsCount()).toBe(0);
    expect(await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CASE_EXPORTED"))).toHaveLength(0);
  });

  test("an unknown deal is a 404 for a compliance role", async () => {
    const r = await exportCasePack(ctx(), { store }, newId(), users.compliance!).catch((e) => e);
    expect(r.status).toBe(404);
  });

  test("a compliance officer's pack holds the five parts and a manifest whose hashes match every file", async () => {
    const out = await exportCasePack(ctx(), { store }, dealId, users.compliance!);
    const files = readZip(out.bytes);
    expect(files.every((f) => f.crcOk)).toBe(true);
    const names = files.map((f) => f.name);
    expect(names).toContain("summary.pdf");
    expect(names).toContain("screenings.json");
    expect(names).toContain("decisions.csv");
    expect(names).toContain("manifest.json");
    expect(names.filter((n) => n.startsWith("documents/"))).toHaveLength(2);
    expect(names.at(-1)).toBe("manifest.json");
    const byName = new Map(files.map((f) => [f.name, f.bytes]));
    expect(new TextDecoder().decode(byName.get("summary.pdf")!.slice(0, 5))).toBe("%PDF-");
    const manifest = JSON.parse(new TextDecoder().decode(byName.get("manifest.json")!));
    expect(manifest.deal).toBe(ref);
    expect(manifest.files.map((f: any) => f.name).toSorted()).toEqual(
      names.filter((n) => n !== "manifest.json").toSorted(),
    );
    for (const f of manifest.files) {
      expect(f.sha256).toBe(createHash("sha256").update(byName.get(f.name)!).digest("hex"));
      expect(f.bytes).toBe(byName.get(f.name)!.byteLength);
    }
    // documents are the stored bytes, under a safe name (a path in the file name can't escape the folder)
    const docNames = names.filter((n) => n.startsWith("documents/"));
    for (const n of docNames) {
      expect(n).not.toContain("..");
      expect(n.split("/")).toHaveLength(2);
    }
    expect(docNames.some((n) => Buffer.from(byName.get(n)!).equals(Buffer.from(DOC_A)))).toBe(true);
    expect(docNames.some((n) => Buffer.from(byName.get(n)!).equals(Buffer.from(DOC_B)))).toBe(true);
  });

  test("screenings.json carries the screenings, the case and its hits in full", async () => {
    const out = await exportCasePack(ctx(), { store }, dealId, users.mlro!);
    const sj = JSON.parse(
      new TextDecoder().decode(readZip(out.bytes).find((f) => f.name === "screenings.json")!.bytes),
    );
    expect(sj.screenings).toHaveLength(1);
    expect(sj.screenings[0].listVersion).toBe("demo-list-1");
    expect(sj.screenings[0].matches.name).toBe("Buyer One");
    expect(sj.cases).toHaveLength(1);
    expect(sj.cases[0].hits).toHaveLength(1);
    expect(sj.cases[0].hits[0].rule).toBe("sanctions");
  });

  test("decisions.csv has every decision with actor, reason, gate, rulebook and versions; free text is masked and formulas neutralised", async () => {
    const out = await exportCasePack(ctx(), { store }, dealId, users.compliance!);
    const csv = new TextDecoder().decode(readZip(out.bytes).find((f) => f.name === "decisions.csv")!.bytes);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "source,id,at,gate_or_helper,outcome,actor,reason,rulebook,policy_version,kyc_config_version,aml_policy_version",
    );
    // two decided approvals and one helper run, oldest first
    expect(lines).toHaveLength(4);
    expect(lines[1]).toContain("helper_run");
    expect(lines[1]).toContain(",kyc,ok,helper:kyc,");
    expect(lines[1]).toContain(",dubai-sales-2026-01,,3,2");
    const aml = lines.find((l) => l.includes("aml_flag"))!;
    expect(aml).toContain(`user:${users.compliance!.id}`);
    expect(aml).toContain("clear");
    expect(aml).toContain("dubai-sales-2026-01");
    expect(aml).toContain("'=HYPERLINK");
    expect(aml).not.toMatch(/,=HYPERLINK/);
    const kyc = lines.find((l) => l.includes("kyc_review"))!;
    expect(kyc).toContain(`user:${users.manager!.id}`);
    expect(kyc).not.toContain("784-1985-1234567-1");
    expect(kyc).toContain("rejected");
    // the policy version is the deal's own
    expect(aml.split(",").some((c) => c === "0")).toBe(true);
  });

  test("each export is a row (who, what, when, hash, size, files) and a compliance-only event; the stored zip matches", async () => {
    const before = await exportsCount();
    const out = await exportCasePack(ctx(), { store }, dealId, users.mlro!);
    expect(await exportsCount()).toBe(before + 1);
    const [row] = (await database.db.select().from(spaExports).where(eq(spaExports.id, out.exportId))) as any[];
    expect(row.requestedBy).toBe(users.mlro!.id);
    expect(row.requestedAt.toISOString()).toBe(AT.toISOString());
    expect(row.kind).toBe("case_pack");
    expect(row.dealId).toBe(dealId);
    expect(row.sha256).toBe(createHash("sha256").update(out.bytes).digest("hex"));
    expect(row.sha256).toBe(out.sha256);
    expect(row.sizeBytes).toBe(out.bytes.byteLength);
    expect(row.fileCount).toBe(readZip(out.bytes).length);
    expect(Buffer.from(await store.read(row.storageKey)).equals(Buffer.from(out.bytes))).toBe(true);
    const ev = (await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CASE_EXPORTED"))) as any[];
    const mine = ev.find((e) => e.payload.exportId === out.exportId);
    expect(mine.actor).toBe(`user:${users.mlro!.id}`);
    expect(mine.entityId).toBe(dealId);
    expect(mine.payload.sha256).toBe(row.sha256);
  });

  test("a document whose file is missing fails the export (503) and records nothing", async () => {
    const other = (await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "U-2" })).dealId;
    await database.db.insert(documents).values({
      id: newId(),
      dealId: other,
      kind: "passport",
      fileName: "x.bin",
      mime: "application/octet-stream",
      sizeBytes: 3,
      sha256: "0".repeat(64),
      storageKey: "zz/missing.bin",
      uploadedBy: "user:x",
      uploadedAt: AT,
    });
    const before = await exportsCount();
    const r = await exportCasePack(ctx(), { store }, other, users.compliance!).catch((e) => e);
    expect(r.status).toBe(503);
    expect(await exportsCount()).toBe(before);
  });

  test("a stored file whose bytes no longer match its recorded hash stops the export (409)", async () => {
    const other = (await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "U-3" })).dealId;
    const put = await store.put(new TextEncoder().encode("tampered"), "txt");
    await database.db.insert(documents).values({
      id: newId(),
      dealId: other,
      kind: "passport",
      fileName: "x.txt",
      mime: "text/plain",
      sizeBytes: 8,
      sha256: "f".repeat(64),
      storageKey: put.path,
      uploadedBy: "user:x",
      uploadedAt: AT,
    });
    const r = await exportCasePack(ctx(), { store }, other, users.compliance!).catch((e) => e);
    expect(r.status).toBe(409);
  });

  test("a party you cannot name stays out of the summary text: no ID number appears anywhere in summary.pdf's inputs", async () => {
    const out = await exportCasePack(ctx(), { store }, dealId, users.compliance!);
    const manifest = JSON.parse(
      new TextDecoder().decode(readZip(out.bytes).find((f) => f.name === "manifest.json")!.bytes),
    );
    expect(JSON.stringify(manifest)).not.toMatch(/\d{3}-\d{4}-\d{7}-\d/);
    void party;
  });
});
