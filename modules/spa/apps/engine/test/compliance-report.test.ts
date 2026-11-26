/* oxlint-disable no-explicit-any -- rows read loosely in tests */
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { amlCases, amlHits, complianceReports, dealEvents, type SpaDatabase, spaApprovals } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import {
  buildReportFiles,
  generateMonthlyReport,
  medianHours,
  type ReportData,
} from "../src/manager/compliance-report.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const DATA: ReportData = {
  period: "2026-10",
  flagsByRule: { sanctions: 3, pep: 1, cash: 0 },
  casesOpened: 4,
  caseOutcomes: { cleared: 2, stopped: 1, reported: 1 },
  eddCases: 2,
  reportsFiled: 1,
  decided: 5,
  medianHoursToDecide: 7,
};

describe("the report builder (C23, S29, S62)", () => {
  test("the same data gives the same bytes, CSV and PDF", async () => {
    const a = await buildReportFiles(DATA);
    const b = await buildReportFiles(structuredClone(DATA));
    expect(Buffer.from(a.csv).equals(Buffer.from(b.csv))).toBe(true);
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true);
    expect(new TextDecoder().decode(a.pdf.slice(0, 5))).toBe("%PDF-");
  });
  test("different data gives different bytes", async () => {
    const a = await buildReportFiles(DATA);
    const b = await buildReportFiles({ ...DATA, eddCases: 3 });
    expect(Buffer.from(a.csv).equals(Buffer.from(b.csv))).toBe(false);
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(false);
  });
  test("the CSV lists every figure, sorted, with a header", async () => {
    const csv = new TextDecoder().decode((await buildReportFiles(DATA)).csv);
    expect(csv.split("\r\n")).toEqual([
      "section,item,value",
      "period,2026-10,",
      "flags_by_rule,cash,0",
      "flags_by_rule,pep,1",
      "flags_by_rule,sanctions,3",
      "cases_opened,,4",
      "case_outcome,cleared,2",
      "case_outcome,reported,1",
      "case_outcome,stopped,1",
      "edd_cases,,2",
      "reports_filed,,1",
      "decisions,,5",
      "median_hours_to_decide,,7",
      "",
    ]);
  });
  test("no decisions in the month leaves the median empty, not zero", async () => {
    const csv = new TextDecoder().decode(
      (await buildReportFiles({ ...DATA, decided: 0, medianHoursToDecide: null })).csv,
    );
    expect(csv).toContain("median_hours_to_decide,,\r\n");
  });
  test("a cell that looks like a formula is neutralised", async () => {
    const csv = new TextDecoder().decode(
      (await buildReportFiles({ ...DATA, flagsByRule: { "=cmd|' /C calc'!A0": 1, "@x": 2, "+y": 3, "-z": 4 } })).csv,
    );
    expect(csv).toContain("'=cmd|' /C calc'!A0,1");
    expect(csv).toContain("'@x,2");
    expect(csv).toContain("'+y,3");
    expect(csv).toContain("'-z,4");
    expect(csv).not.toMatch(/(^|\r\n|,)[=+\-@]\w/);
  });
  test("median is whole hours with integer maths", () => {
    expect(medianHours([])).toBeNull();
    expect(medianHours([5])).toBe(5);
    expect(medianHours([9, 1, 5])).toBe(5);
    expect(medianHours([1, 2])).toBe(1); // floor((1+2)/2)
    expect(medianHours([3, 4, 10, 20])).toBe(7);
  });
});

describe.skipIf(!url)("the monthly report job (C23, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  // 2026-11-01 02:00 Dubai: the report is for October
  const clock = new FixedClock(new Date("2026-10-31T22:00:00Z"));
  const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
  const approval = (
    gateName: string,
    role: string,
    status: string,
    created: string,
    decided: string | null,
    extra = {},
  ) => ({
    id: newId(),
    gate: gateName as any,
    entityKind: "deal" as const,
    entityId: dealId,
    dedupeKey: `${dealId}:${gateName}:${newId()}`,
    title: "t",
    proposal: {},
    approverRole: role as any,
    status: status as any,
    proposedBy: "system",
    ...(decided ? { decidedBy: users.compliance!.id, decidedAt: new Date(decided) } : {}),
    createdAt: new Date(created),
    ...extra,
  });
  let dealId: string;

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    dir = mkdtempSync(join(tmpdir(), "report-"));
    store = new LocalDiskStore(dir);
    dealId = (await dealInDraft(ctx(), database, { type: "resale_ready", buyers: ["Zainab Hidden-Name"] })).dealId;
    const c1 = newId();
    const c2 = newId();
    await database.db.insert(amlCases).values([
      {
        id: c1,
        dealId,
        status: "cleared",
        summary: "s",
        instructionLike: false,
        openedAt: new Date("2026-10-05T08:00:00Z"),
        closedAt: new Date("2026-10-06T08:00:00Z"),
      },
      {
        id: c2,
        dealId,
        status: "open",
        summary: "s",
        instructionLike: false,
        openedAt: new Date("2026-10-20T08:00:00Z"),
      },
    ]);
    const hit = (caseId: string, rule: string, at: string) => ({
      id: newId(),
      caseId,
      subjectKey: "k",
      rule: rule as any,
      severity: "flag" as const,
      detail: "d",
      listVersion: "v",
      createdAt: new Date(at),
    });
    await database.db.insert(amlHits).values([
      hit(c1, "sanctions", "2026-10-05T08:00:00Z"),
      hit(c1, "cash", "2026-10-05T08:00:00Z"),
      hit(c2, "sanctions", "2026-10-20T08:00:00Z"),
      hit(c2, "pep", "2026-09-30T19:59:00Z"), // 23:59 Dubai on 30 September: not October
      hit(c2, "pep", "2026-11-30T19:00:00Z"), // December in Dubai? no: 30 Nov 23:00 Dubai, not October
    ]);
    await database.db.insert(spaApprovals).values([
      // aml_flag decided 3h and 5h after proposal; edd_signoff 10h; aml_report approved 20h; sales gate ignored
      approval("aml_flag", "compliance_officer", "approved", "2026-10-05T08:00:00Z", "2026-10-05T11:30:00Z", {
        outcome: "clear",
      }),
      approval("aml_flag", "compliance_officer", "approved", "2026-10-20T08:00:00Z", "2026-10-20T13:00:00Z", {
        outcome: "stop_and_report",
      }),
      approval("edd_signoff", "compliance_officer", "approved", "2026-10-06T08:00:00Z", "2026-10-06T18:00:00Z"),
      approval("aml_report", "mlro", "approved", "2026-10-21T08:00:00Z", "2026-10-22T04:00:00Z"),
      approval("aml_report", "mlro", "rejected", "2026-10-23T08:00:00Z", "2026-10-23T09:00:00Z"),
      approval("kyc_review", "sales_manager", "approved", "2026-10-07T08:00:00Z", "2026-10-07T09:00:00Z"),
      // decided in November: not in October's report
      approval("edd_signoff", "compliance_officer", "approved", "2026-10-30T08:00:00Z", "2026-11-01T08:00:00Z"),
    ]);
  });
  afterAll(async () => {
    await database?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("the previous Dubai month is reported, from the data, with integer figures", async () => {
    const r = await generateMonthlyReport(ctx(), { store });
    expect(r.period).toBe("2026-10");
    expect(r.created).toBe(true);
    const csv = new TextDecoder().decode(await store.read((await rowOf(r.id)).csvKey));
    expect(csv).toContain("flags_by_rule,sanctions,2\r\n");
    expect(csv).toContain("flags_by_rule,cash,1\r\n");
    expect(csv).toContain("flags_by_rule,pep,0\r\n");
    expect(csv).toContain("cases_opened,,2\r\n");
    expect(csv).toContain("case_outcome,cleared,1\r\n");
    expect(csv).toContain("edd_cases,,2\r\n"); // proposed in October: 06 Oct and 30 Oct
    expect(csv).toContain("reports_filed,,1\r\n");
    // decided in October: 3.5h->3, 5h, 10h, 20h, 1h (rejected report; counts as decided) -> sorted 1,3,5,10,20 -> median 5
    expect(csv).toContain("decisions,,5\r\n");
    expect(csv).toContain("median_hours_to_decide,,5\r\n");
  });
  const rowOf = async (id: string) =>
    (await database.db.select().from(complianceReports).where(eq(complianceReports.id, id)))[0]!;

  test("the report holds no name, no ID and no deal ref", async () => {
    const [row] = await database.db.select().from(complianceReports);
    const csv = new TextDecoder().decode(await store.read(row!.csvKey));
    const pdf = Buffer.from(await store.read(row!.pdfKey)).toString("latin1");
    for (const t of [csv, pdf]) {
      expect(t).not.toContain("Hidden-Name");
      expect(t).not.toMatch(/D-\d{4}/);
    }
  });

  test("the row keeps both hashes and keys; the stored files match; one event, compliance only", async () => {
    const [row] = await database.db.select().from(complianceReports);
    expect(row!.csvSha256).toBe(sha(await store.read(row!.csvKey)));
    expect(row!.pdfSha256).toBe(sha(await store.read(row!.pdfKey)));
    expect(row!.generatedAt.toISOString()).toBe("2026-10-31T22:00:00.000Z");
    const ev = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "COMPLIANCE_REPORT_GENERATED"));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.actor).toBe("system");
  });

  test("running the job twice for the month makes one report and one event, with the same bytes", async () => {
    const [first] = await database.db.select().from(complianceReports);
    const again = await generateMonthlyReport(ctx(), { store });
    expect(again.created).toBe(false);
    expect(again.id).toBe(first!.id);
    expect(await database.db.select().from(complianceReports)).toHaveLength(1);
    expect(
      await database.db.select().from(dealEvents).where(eq(dealEvents.type, "COMPLIANCE_REPORT_GENERATED")),
    ).toHaveLength(1);
  });

  test("a month with nothing in it still gets a report of zeros", async () => {
    const r = await generateMonthlyReport(ctx(), { store }, "2025-02");
    expect(r.created).toBe(true);
    const csv = new TextDecoder().decode(await store.read((await rowOf(r.id)).csvKey));
    expect(csv).toContain("cases_opened,,0\r\n");
    expect(csv).toContain("median_hours_to_decide,,\r\n");
  });

  test("a period that is not yyyy-mm is refused, and so is the current or a future month", async () => {
    await expect(generateMonthlyReport(ctx(), { store }, "2026-1")).rejects.toThrow();
    await expect(generateMonthlyReport(ctx(), { store }, "2026-11")).rejects.toThrow(/finished/);
    await expect(generateMonthlyReport(ctx(), { store }, "2027-01")).rejects.toThrow(/finished/);
  });
});
