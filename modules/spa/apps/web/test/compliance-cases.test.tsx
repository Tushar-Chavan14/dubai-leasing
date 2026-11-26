/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { buildWorld, EID, PASSPORT, PHONE, type World } from "../../engine/test/reads-fixture.ts";
import { CaseDetail, CaseList, parseTab, TAB_LABELS } from "../components/compliance-cases";
import { InboxList } from "../components/inbox";
import { CASE_TABS, type CaseView } from "../lib/contracts";
import { type Get, loadCase, loadCases } from "../lib/loaders";
import { railItems } from "@spa/core";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const noop = async () => {};

describe("C33: case list and case view, rendered", () => {
  const view = (over: Partial<CaseView> = {}): CaseView => ({
    label: "FICTIONAL, SIMULATED",
    case: {
      id: "0198a1b2-0000-7000-8000-000000000009",
      kind: "case",
      status: "open",
      openedAt: "2026-11-19T05:00:00Z",
      closedAt: null,
    },
    dealId: "d1",
    dealRef: "D-0001",
    suggestion: {
      label: "Suggestion",
      text: "<img src=x onerror=alert(1)> sanctions",
      fromModel: true,
      model: "tev1",
      instructionLike: false,
    },
    subjects: [
      {
        subjectKey: "party:p1",
        partyId: "p1",
        label: "Buyer One (buyer)",
        screening: {
          id: "s1",
          trigger: "offer",
          listLabel: "FICTIONAL, SIMULATED",
          listVersion: "v1",
          exact: false,
          notScreened: false,
          date: "2026-11-19",
          checks: [
            {
              rule: "sanctions",
              score: 0.97,
              threshold: 0.85,
              thresholdPending: false,
              over: true,
              list: "v1",
              date: "2026-11-19",
            },
            {
              rule: "pep",
              score: 0.2,
              threshold: 0.85,
              thresholdPending: false,
              over: false,
              list: "v1",
              date: "2026-11-19",
            },
          ],
          entries: [],
        },
        hits: [{ rule: "sanctions", severity: "flag", detail: "list match", listVersion: "v1" }],
        risk: {
          level: "high",
          points: 40,
          flagged: true,
          policyVersion: 1,
          rulesVersion: "r",
          breakdown: [{ source: "rule sanctions", points: 30 }],
          date: "2026-11-19",
        },
      },
    ],
    sourceOfFunds: [],
    approval: null,
    trail: [],
    ...over,
  });

  test("the tabs are the five of the design, the current one marked", () => {
    const html = render(<CaseList tab="edd" items={[]} next={null} />);
    for (const t of CASE_TABS) expect(html).toContain(TAB_LABELS[t]);
    expect(html).toMatch(/aria-current="page"[^>]*>EDD/);
    expect(html).toContain('href="/compliance?tab=reported#cases"');
  });
  test("an unknown tab is the open one", () => {
    expect(parseTab("nope")).toBe("open");
    expect(parseTab(undefined)).toBe("open");
    expect(parseTab("closed")).toBe("closed");
  });
  test("a row links to its case and labels the model wording as a suggestion", () => {
    const html = render(
      <CaseList
        tab="open"
        next="abc"
        items={[
          {
            id: "0198a1b2-0000-7000-8000-000000000009",
            kind: "case",
            status: "open",
            dealId: "d1",
            dealRef: "D-0001",
            openedAt: "2026-11-19T05:00:00Z",
            closedAt: null,
            rules: ["sanctions"],
            partyName: null,
            suggestion: {
              label: "Suggestion",
              text: "<b>x</b>",
              fromModel: true,
              model: "tev1",
              instructionLike: false,
            },
          },
        ]}
      />,
    );
    expect(html).toContain('href="/compliance/cases/0198a1b2-0000-7000-8000-000000000009"');
    expect(html).toContain("Suggestion");
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("tab=open&amp;cursor=abc");
  });
  test("the case view shows score against threshold, list and date, the risk, and escapes the suggestion", () => {
    const html = render(<CaseDetail view={view()} viewer="compliance_officer" decideAction={noop} />);
    expect(html).toContain("0.97");
    expect(html).toContain("0.85");
    expect(html).toContain("At or over");
    expect(html).toContain("Under");
    expect(html).toContain("list v1");
    expect(html).toContain("Risk: High");
    expect(html).toContain("40 points");
    expect(html).toContain("Case trail");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).not.toContain("<img");
    expect(html).toMatch(/Suggestion[^<]*written by a model/);
    expect(html).toContain("Not a finding");
  });
  test("a case with no decision waiting shows no form", () => {
    const html = render(<CaseDetail view={view()} viewer="mlro" decideAction={noop} />);
    expect(html).not.toContain("<form");
    expect(html).toContain("no decision waiting");
  });
});

describe("C33: no screen for another role", () => {
  test("only the two compliance roles have the Compliance screen, so the page 404s for everyone else", () => {
    for (const role of ["sales_officer", "sales_manager", "sales_admin", "legal", "finance", "admin"] as const)
      expect(railItems(role, "both").some((i) => i.screen === "compliance")).toBe(false);
    for (const role of ["compliance_officer", "mlro"] as const)
      expect(railItems(role, "both").some((i) => i.screen === "compliance")).toBe(true);
  });
});

describe.skipIf(!url)("C33: the case pages read the real engine", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  let caseId = "";
  const getAs =
    (role: keyof World["users"]): Get =>
    async (path, schema) => {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${issueToken(SECRET, w.users[role]!.id, NOW)}` },
      });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    caseId = (await loadCases(getAs("compliance"), "open", undefined))!.items[0]!.id;
  });
  afterAll(async () => {
    await database?.close();
  });

  test("compliance roles read the list and the case; every other role gets nothing", async () => {
    for (const role of ["compliance", "mlro"] as const) {
      expect((await loadCases(getAs(role), "open", undefined))!.items.map((i) => i.id)).toEqual([caseId]);
      expect(await loadCase(getAs(role), caseId)).not.toBeNull();
    }
    for (const role of ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const) {
      expect(await loadCases(getAs(role), "open", undefined)).toBeNull();
      expect(await loadCase(getAs(role), caseId)).toBeNull();
    }
    expect(await loadCase(getAs("compliance"), "0198a1b2-0000-7000-8000-00000000ffff")).toBeNull();
  });

  test("the pages render the tabs, the case view and the decision card, with no personal number", async () => {
    const list = (await loadCases(getAs("compliance"), "open", undefined))!;
    const lhtml = render(<CaseList tab="open" items={list.items} next={list.nextCursor} />);
    expect(lhtml).toContain("Open cases");
    expect(lhtml).toContain("Sanctions list");
    const v = (await loadCase(getAs("compliance"), caseId))!;
    const html = render(<CaseDetail view={v} viewer="compliance_officer" decideAction={noop} />);
    expect(html).toContain('value="stop_and_report"');
    expect(html).toContain('name="back" value="/compliance/cases/' + caseId + '"');
    expect(html).toContain("Case trail");
    expect(html).toContain("Source of funds");
    for (const s of [PASSPORT, EID, PHONE]) {
      expect(lhtml).not.toContain(s);
      expect(html).not.toContain(s);
    }
    // The MLRO reads the same case but does not decide the officer's flag: no form.
    const m = (await loadCase(getAs("mlro"), caseId))!;
    expect(render(<CaseDetail view={m} viewer="mlro" decideAction={noop} />)).not.toContain("<form");
  });

  test("the inbox list still draws the same card with no back address", async () => {
    const c = (await loadCase(getAs("compliance"), caseId))!;
    const html = render(
      <InboxList items={[c.approval!]} viewer="compliance_officer" decideAction={noop} from="compliance" />,
    );
    expect(html).not.toContain('name="back"');
  });
});
