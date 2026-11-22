/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { deals, spaApprovals } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { runAlerts } from "../../engine/src/manager/alerts.ts";
import type { SpaContext } from "../../engine/src/manager/context.ts";
import { failClosedFacts } from "../../engine/src/manager/facts.ts";
import { dealInDraft, seedUsers, type U } from "../../engine/test/prepare-fixtures.ts";
import { AlertBell } from "../components/alert-bell";
import { AlertList } from "../components/alert-list";
import { ExportCaseForm } from "../components/export-case";
import { ExportLog, ReportsSection, RetentionSection } from "../components/records";
import { loadAlerts, loadExports, loadReports, loadRetention, type Get } from "../lib/loaders";
import { monthLabel } from "../lib/format";

const noop = async () => {};
const newId = () => crypto.randomUUID();
const SINCE = "2026-11-17T06:00:00.000Z";

describe("alert views (C23, S62)", () => {
  test("the bell is a link to the alerts with the unread count said in words; no count, no badge", () => {
    const some = render(<AlertBell unread={3} />);
    expect(some).toContain('href="/alerts"');
    expect(some).toContain("3 unread alerts");
    expect(render(<AlertBell unread={1} />)).toContain("1 unread alert<");
    const none = render(<AlertBell unread={0} />);
    expect(none).toContain("No unread alerts");
    expect(none).not.toContain('aria-hidden="true" class="absolute');
  });
  test("the list shows the sentence, when, the deal link and Mark read only on an unread one", () => {
    const html = render(
      <AlertList
        markAction={noop}
        items={[
          {
            id: "a1",
            text: "Prepared agreement for D-0001 has been waiting 30 hours.",
            level: "approver",
            dealId: "d1",
            dealRef: "D-0001",
            createdAt: SINCE,
            readAt: null,
          },
          {
            id: "a2",
            text: "Prepared agreement for D-0002 has been waiting 52 hours.",
            level: "manager",
            dealId: "d2",
            dealRef: "D-0002",
            createdAt: SINCE,
            readAt: SINCE,
          },
        ]}
      />,
    );
    expect(html).toContain("Prepared agreement for D-0001 has been waiting 30 hours.");
    expect(html).toContain('href="/work/deals/d1"');
    expect(html.match(/Mark read/g)).toHaveLength(1);
    expect(html).toContain("Escalated");
    expect(html).toContain("Read");
  });
  test("an empty list says so", () => {
    expect(render(<AlertList items={[]} markAction={noop} />)).toContain("No alerts.");
  });
});

describe("compliance records views (C23, S62)", () => {
  test("a month reads in words", () => {
    expect(monthLabel("2026-11")).toBe("November 2026");
    expect(monthLabel("junk")).toBe("junk");
  });
  test("retention: each list with its deals and day, the years marked as to confirm, Approve only on a listed one, and nothing about deleting having happened", () => {
    const html = render(
      <RetentionSection
        approveAction={noop}
        reviews={[
          {
            id: "r1",
            period: "2026-11",
            status: "listed",
            retentionYears: 5,
            cutoffOn: "2021-11-19",
            createdAt: SINCE,
            approvedBy: null,
            approvedByName: null,
            approvedAt: null,
            items: [{ ref: "D-0007", endedOn: "2021-01-05", status: "listed" }],
          },
          {
            id: "r0",
            period: "2026-10",
            status: "approved",
            retentionYears: 5,
            cutoffOn: "2021-10-19",
            createdAt: SINCE,
            approvedBy: "u",
            approvedByName: "Dana Officer",
            approvedAt: SINCE,
            items: [],
          },
        ]}
      />,
    );
    expect(html).toContain("November 2026");
    expect(html).toContain("D-0007");
    expect(html).toContain("5 years (confirm with compliance)");
    expect(html.match(/Approve list/g)).toHaveLength(1);
    expect(html).toContain("Approved by Dana Officer");
    expect(html).toContain("Nothing is deleted");
  });
  test("retention with no lists says so", () => {
    expect(render(<RetentionSection approveAction={noop} reviews={[]} />)).toContain("No lists yet.");
  });
  test("reports: month, CSV and PDF links to the download route", () => {
    const html = render(
      <ReportsSection
        reports={[
          {
            id: "0198a1b2-0000-7000-8000-000000000001",
            period: "2026-10",
            generatedAt: SINCE,
            csvSha256: "a",
            pdfSha256: "b",
          },
        ]}
      />,
    );
    expect(html).toContain("October 2026");
    expect(html).toContain('href="/compliance/reports/0198a1b2-0000-7000-8000-000000000001.csv"');
    expect(html).toContain('href="/compliance/reports/0198a1b2-0000-7000-8000-000000000001.pdf"');
    expect(render(<ReportsSection reports={[]} />)).toContain("No reports yet.");
  });
  test("the export log: who, what, when and the size", () => {
    const html = render(
      <ExportLog
        items={[
          {
            id: "e1",
            kind: "case_pack",
            dealRef: "D-0003",
            requestedBy: "u",
            requestedByName: "Mira Mlro",
            requestedAt: SINCE,
            sha256: "abcdef0123456789abcdef",
            sizeBytes: 20480,
            fileCount: 6,
          },
          {
            id: "e2",
            kind: "monthly_report",
            dealRef: null,
            requestedBy: "u",
            requestedByName: "Dana Officer",
            requestedAt: SINCE,
            sha256: "0123456789abcdef",
            sizeBytes: 300,
            fileCount: 1,
          },
        ]}
      />,
    );
    expect(html).toContain("Mira Mlro");
    expect(html).toContain("Case pack");
    expect(html).toContain("D-0003");
    expect(html).toContain("Monthly report");
    expect(html).toContain("20 KB");
    expect(html).toContain("abcdef012345");
    expect(render(<ExportLog items={[]} />)).toContain("No exports yet.");
  });
  test("the export form names a deal by its reference, posts to the export route and says what it makes", () => {
    const html = render(<ExportCaseForm />);
    expect(html).toContain('action="/compliance/export"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="ref"');
    expect(html).toContain("Export case pack");
    expect(html).toContain("Each export is logged");
  });
});

const url = spaTestDatabaseUrl();
const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");

describe.skipIf(!url)("the loaders read the real engine routes, per role (C23, S62)", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let app: ReturnType<typeof createApp>;
  const getAs =
    (who: string): Get =>
    async (path, schema) => {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${issueToken(SECRET, users[who]!.id, NOW)}` },
      });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    const clock = { now: () => new Date(NOW), today: () => "2026-11-19" } as unknown as SpaContext["clock"];
    const ctx: SpaContext = { database, clock, facts: failClosedFacts };
    const { dealId } = await dealInDraft(ctx, database, { type: "resale_ready" });
    await database.db.insert(spaApprovals).values({
      id: newId(),
      gate: "agreement_approval",
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:a`,
      title: "t",
      proposal: {},
      approverRole: "legal",
      proposedBy: "system",
      createdAt: new Date("2026-11-17T06:00:00Z"),
    });
    await runAlerts(ctx);
    void deals;
  });
  afterAll(async () => {
    await database?.close();
  });

  test("alerts: your own, parsed by the page's contract", async () => {
    const mine = await loadAlerts(getAs("legal"));
    expect(mine!.unread).toBe(1);
    expect(mine!.items[0]!.text).toMatch(/^Prepared agreement for D-\d{4} has been waiting 48 hours\.$/);
    expect((await loadAlerts(getAs("officer")))!.items).toEqual([]);
  });
  test("records: null (the page is not there) for every role but the two compliance roles, which read empty lists", async () => {
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance", "admin"]) {
      expect(await loadRetention(getAs(who))).toBeNull();
      expect(await loadReports(getAs(who))).toBeNull();
      expect(await loadExports(getAs(who))).toBeNull();
    }
    for (const who of ["compliance", "mlro"]) {
      expect((await loadRetention(getAs(who)))!.items).toEqual([]);
      expect((await loadReports(getAs(who)))!.items).toEqual([]);
      expect((await loadExports(getAs(who)))!.items).toEqual([]);
    }
  });
});
