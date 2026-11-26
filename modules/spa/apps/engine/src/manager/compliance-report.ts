import { type PdfBlock, renderPdf } from "@platform/adapters";
import { addMonths, calendarDate, newId, startOfDubaiDay } from "@platform/kernel";
import { createHash } from "node:crypto";
import { isComplianceGate, type SpaRole } from "@spa/core";
import { AML_HIT_RULES, amlCases, amlHits, complianceReports, spaApprovals, spaExports, withSpaTx } from "@spa/db";
import { and, desc, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { requireCompliance } from "./compliance.ts";
import type { SpaContext } from "./context.ts";
import { csvLine } from "./csv.ts";
import { conflict, notFound, unavailable, unprocessable } from "./errors.ts";
import { appendDealEvent } from "./events.ts";
import type { ExportStore } from "./case-export.ts";

/** Everything the monthly report says: counts and whole hours, no name, no ID and no deal (S29, S62). */
export interface ReportData {
  period: string;
  flagsByRule: Record<string, number>;
  casesOpened: number;
  caseOutcomes: Record<string, number>;
  eddCases: number;
  reportsFiled: number;
  /** Compliance gates decided in the month. */
  decided: number;
  /** Median of the whole hours between a gate's proposal and its decision; null when nothing was decided. */
  medianHoursToDecide: number | null;
}

const CLOSED_STATUSES = ["cleared", "stopped", "reported"] as const;
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;
const MS_HOUR = 3_600_000;

/** The median of whole hours, integer maths: an even count takes the floor of the two middle values' mean. */
export function medianHours(hours: readonly number[]): number | null {
  if (!hours.length) return null;
  const s = hours.toSorted((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : Math.floor((s[mid - 1]! + s[mid]!) / 2);
}

const sorted = (r: Record<string, number>) => Object.entries(r).toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

/**
 * The CSV and the PDF of one month. Pure: the same data gives the same bytes (the PDF carries a fixed date, not the time it was made). Cells that a spreadsheet would read as formulas are made text.
 */
export async function buildReportFiles(d: ReportData): Promise<{ csv: Uint8Array; pdf: Uint8Array }> {
  const lines: (string | number | null)[][] = [
    ["section", "item", "value"],
    ["period", d.period, null],
    ...sorted(d.flagsByRule).map(([k, v]) => ["flags_by_rule", k, v]),
    ["cases_opened", null, d.casesOpened],
    ...sorted(d.caseOutcomes).map(([k, v]) => ["case_outcome", k, v]),
    ["edd_cases", null, d.eddCases],
    ["reports_filed", null, d.reportsFiled],
    ["decisions", null, d.decided],
    ["median_hours_to_decide", null, d.medianHoursToDecide],
  ];
  const csv = new TextEncoder().encode(lines.map(csvLine).join(""));
  const blocks: PdfBlock[] = [
    { kind: "title", text: `Compliance report ${d.period}` },
    { kind: "meta", rows: [["Audience", "Compliance officer and MLRO only"]] },
    { kind: "heading", text: "Flags by rule" },
    { kind: "facts", rows: sorted(d.flagsByRule).map(([k, v]) => [k, String(v)]) },
    { kind: "heading", text: "Cases" },
    {
      kind: "facts",
      rows: [
        ["Opened", String(d.casesOpened)],
        ...sorted(d.caseOutcomes).map(([k, v]): [string, string] => [`Closed: ${k}`, String(v)]),
      ],
    },
    { kind: "heading", text: "Reviews" },
    {
      kind: "facts",
      rows: [
        ["Enhanced due diligence cases", String(d.eddCases)],
        ["Reports filed", String(d.reportsFiled)],
        ["Decisions taken", String(d.decided)],
        ["Median hours to decide", d.medianHoursToDecide === null ? "none decided" : String(d.medianHoursToDecide)],
      ],
    },
    { kind: "small", text: "Counts only: no names, no documents, no deal references. Hours are whole hours." },
  ];
  // renderPdf stamps a fixed date, so the same blocks always give the same bytes.
  const pdf = await renderPdf({ title: `Compliance report ${d.period}`, subject: "Monthly compliance report" }, blocks);
  return { csv, pdf };
}

/** Collects one month's figures from the database (the Dubai calendar month). */
export async function collectReportData(ctx: SpaContext, period: string): Promise<ReportData> {
  const db = ctx.database.db;
  const first = calendarDate(`${period}-01`);
  const from = startOfDubaiDay(first);
  const to = startOfDubaiDay(addMonths(first, 1));
  const hitRows = await db
    .select({ rule: amlHits.rule })
    .from(amlHits)
    .where(and(gte(amlHits.createdAt, from), lt(amlHits.createdAt, to)));
  const flagsByRule: Record<string, number> = Object.fromEntries(AML_HIT_RULES.map((r) => [r, 0]));
  for (const h of hitRows) flagsByRule[h.rule] = (flagsByRule[h.rule] ?? 0) + 1;
  const opened = await db
    .select({ id: amlCases.id })
    .from(amlCases)
    .where(and(gte(amlCases.openedAt, from), lt(amlCases.openedAt, to)));
  const closed = await db
    .select({ status: amlCases.status })
    .from(amlCases)
    .where(and(isNotNull(amlCases.closedAt), gte(amlCases.closedAt, from), lt(amlCases.closedAt, to)));
  const caseOutcomes: Record<string, number> = Object.fromEntries(CLOSED_STATUSES.map((s) => [s, 0]));
  for (const c of closed) if (c.status in caseOutcomes) caseOutcomes[c.status] = (caseOutcomes[c.status] ?? 0) + 1;
  const edd = await db
    .select({ id: spaApprovals.id })
    .from(spaApprovals)
    .where(
      and(eq(spaApprovals.gate, "edd_signoff"), gte(spaApprovals.createdAt, from), lt(spaApprovals.createdAt, to)),
    );
  const decidedRows = await db
    .select({
      gate: spaApprovals.gate,
      status: spaApprovals.status,
      createdAt: spaApprovals.createdAt,
      decidedAt: spaApprovals.decidedAt,
    })
    .from(spaApprovals)
    .where(
      and(
        inArray(spaApprovals.gate, ["aml_flag", "edd_signoff", "aml_report"]),
        ne(spaApprovals.status, "pending"),
        ne(spaApprovals.status, "cancelled"),
        isNotNull(spaApprovals.decidedAt),
        gte(spaApprovals.decidedAt, from),
        lt(spaApprovals.decidedAt, to),
      ),
    );
  const hours = decidedRows
    .filter((r) => isComplianceGate(r.gate))
    .map((r) => Math.floor((r.decidedAt!.getTime() - r.createdAt.getTime()) / MS_HOUR));
  return {
    period,
    flagsByRule,
    casesOpened: opened.length,
    caseOutcomes,
    eddCases: edd.length,
    reportsFiled: decidedRows.filter((r) => r.gate === "aml_report" && r.status === "approved").length,
    decided: hours.length,
    medianHoursToDecide: medianHours(hours),
  };
}

/** The `yyyy-mm` of the Dubai month before today. */
export function previousPeriod(ctx: SpaContext): string {
  return addMonths(calendarDate(`${ctx.clock.today().slice(0, 7)}-01`), -1).slice(0, 7);
}

/**
 * Writes the compliance report of a finished month (default: the previous one) once (S29, S62): a CSV and a PDF in the
 * store, a `compliance_reports` row, and a compliance-only event. Safe to run twice: the second run changes nothing.
 */
export async function generateMonthlyReport(
  ctx: SpaContext,
  deps: { store: Pick<ExportStore, "put"> },
  period: string = previousPeriod(ctx),
): Promise<{ id: string; period: string; created: boolean }> {
  if (!PERIOD.test(period)) throw unprocessable("invalid_period", "the period must be yyyy-mm");
  if (period >= ctx.clock.today().slice(0, 7)) throw unprocessable("period_not_finished", "that month isn't finished");
  const db = ctx.database.db;
  const [have] = await db
    .select({ id: complianceReports.id })
    .from(complianceReports)
    .where(eq(complianceReports.period, period));
  if (have) return { id: have.id, period, created: false };
  const files = await buildReportFiles(await collectReportData(ctx, period));
  const csv = await deps.store.put(files.csv, "csv");
  const pdf = await deps.store.put(files.pdf, "pdf");
  const id = newId();
  return withSpaTx(ctx.database, async (tx) => {
    const rows = await tx.db
      .insert(complianceReports)
      .values({
        id,
        period,
        csvSha256: csv.sha256,
        pdfSha256: pdf.sha256,
        csvKey: csv.path,
        pdfKey: pdf.path,
        generatedAt: ctx.clock.now(),
      })
      .onConflictDoNothing()
      .returning({ id: complianceReports.id });
    if (!rows.length) {
      const [row] = await tx.db
        .select({ id: complianceReports.id })
        .from(complianceReports)
        .where(eq(complianceReports.period, period));
      return { id: row!.id, period, created: false };
    }
    await appendDealEvent(tx, ctx, {
      entity: { kind: "settings", id },
      type: "COMPLIANCE_REPORT_GENERATED",
      actor: "system",
      payload: { period, csvSha256: csv.sha256, pdfSha256: pdf.sha256 },
    });
    return { id, period, created: true };
  });
}

/** The reports, newest month first, for a compliance role. */
export async function listReports(ctx: SpaContext, user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined }) {
  requireCompliance(user);
  const rows = await ctx.database.db.select().from(complianceReports).orderBy(desc(complianceReports.period));
  return rows.map((r) => ({
    id: r.id,
    period: r.period,
    generatedAt: r.generatedAt.toISOString(),
    csvSha256: r.csvSha256,
    pdfSha256: r.pdfSha256,
  }));
}

/**
 * Hands a compliance role one file of a report (S62) and records the download as an export: who, which file (its hash and
 * key) and when. A file missing from storage or no longer matching its hash is refused, never served.
 */
export async function downloadReport(
  ctx: SpaContext,
  deps: { store: Pick<ExportStore, "read"> },
  reportId: string,
  ext: "csv" | "pdf",
  user: { id: string; role: SpaRole; roles?: readonly SpaRole[] | undefined },
): Promise<{ bytes: Uint8Array; contentType: string; fileName: string }> {
  requireCompliance(user);
  const [r] = await ctx.database.db.select().from(complianceReports).where(eq(complianceReports.id, reportId));
  if (!r) throw notFound("report");
  const key = ext === "csv" ? r.csvKey : r.pdfKey;
  const want = ext === "csv" ? r.csvSha256 : r.pdfSha256;
  let bytes: Uint8Array;
  try {
    bytes = await deps.store.read(key);
  } catch {
    throw unavailable("export_file_missing", "this report can't be read from storage");
  }
  if (createHash("sha256").update(bytes).digest("hex") !== want)
    throw conflict("export_file_changed", "the stored report no longer matches its recorded hash");
  await withSpaTx(ctx.database, async (tx) => {
    await tx.db.insert(spaExports).values({
      id: newId(),
      dealId: null,
      kind: "monthly_report",
      requestedBy: user.id,
      requestedAt: ctx.clock.now(),
      sha256: want,
      sizeBytes: bytes.byteLength,
      storageKey: key,
      fileCount: 1,
    });
    await appendDealEvent(tx, ctx, {
      entity: { kind: "settings", id: r.id },
      type: "COMPLIANCE_REPORT_EXPORTED",
      actor: `user:${user.id}`,
      payload: { period: r.period, format: ext, sha256: want },
    });
  });
  return {
    bytes,
    contentType: ext === "csv" ? "text/csv; charset=utf-8" : "application/pdf",
    fileName: `compliance-${r.period}.${ext}`,
  };
}
