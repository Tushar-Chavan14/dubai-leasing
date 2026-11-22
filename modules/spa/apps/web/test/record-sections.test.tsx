/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { renderToStaticMarkup as render } from "react-dom/server";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { COMPLIANCE_WORDS, EID, PASSPORT, PHONE } from "../../engine/test/reads-fixture.ts";
import { buildLateWorld, FILE_FACTS, IBAN, type LateWorld } from "../../engine/test/record-late-fixture.ts";
import { CaseDetail } from "../components/compliance-cases";
import { DealRecord } from "../components/deal-record";
import { loadCase, loadCases, loadRecordPage, type Get } from "../lib/loaders";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const noop = async () => {};

const ROLES = [
  ["officer", "sales_officer"],
  ["manager", "sales_manager"],
  ["salesadmin", "sales_admin"],
  ["admin", "admin"],
  ["legal", "legal"],
  ["finance", "finance"],
  ["compliance", "compliance_officer"],
  ["mlro", "mlro"],
] as const;
const STAFF = ["documents", "agreement", "signing", "noc", "finance", "registration"];
const SHOWN: Record<string, string[]> = {
  sales_officer: [...STAFF, "settlement"],
  sales_manager: [...STAFF, "settlement"],
  sales_admin: [...STAFF, "settlement"],
  admin: STAFF,
  legal: [...STAFF, "settlement"],
  finance: [...STAFF, "settlement"],
  compliance_officer: ["documents", "aml"],
  mlro: ["documents", "aml"],
};
const ALL = ["documents", "aml", "agreement", "signing", "noc", "finance", "settlement", "registration"];

describe.skipIf(!url)("C39: the record's evidence sections render through the real engine, per role (S71)", () => {
  let database: SpaDatabase;
  let w: LateWorld;
  let app: ReturnType<typeof createApp>;
  const getAs =
    (key: keyof LateWorld["users"]): Get =>
    async (path, schema) => {
      const res = await app.request(path, {
        headers: { authorization: `Bearer ${issueToken(SECRET, w.users[key]!.id, NOW)}` },
      });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };
  const page = async (key: keyof LateWorld["users"], role: string, dealId: string) => {
    const r = (await loadRecordPage(getAs(key), dealId, undefined))!;
    return render(<DealRecord record={r.record} events={r.events.items} nextEvents={null} viewer={role as never} />);
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildLateWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  test("each role sees exactly its sections, as headings, on a deal that reached every step", async () => {
    for (const [key, role] of ROLES) {
      const html = await page(key, role, w.late.dealId);
      for (const id of ALL) expect(html.includes(`id="${id}"`), `${role} ${id}`).toBe(SHOWN[role]!.includes(id));
      expect(html).not.toMatch(/<(form|button|input)\b/);
    }
  });

  test("what the sections say: documents, agreement, signing, NOC, banks, settlement and registration", async () => {
    const html = await page("finance", "finance", w.late.dealId);
    expect(html).toContain("Passport");
    expect(html).toContain("Read, not confirmed");
    expect(html).toContain("19 Nov 2026");
    expect(html).toContain("Assignment form");
    expect(html).toContain("version 2");
    expect(html).toContain("Link expired");
    expect(html).toContain("Signed");
    expect(html).toContain("AED 1,200,000");
    expect(html).toContain("Balances to zero");
    expect(html).toContain("AED 500,000");
    expect(html).toContain("Payer name needs review");
    expect(html).toContain("Trustee transfer");
    expect(html).toContain("Rejected");
  });

  test("no compliance word, no personal number, no file or link fact on any other role's page", async () => {
    for (const [key, role] of ROLES) {
      if (role === "compliance_officer" || role === "mlro") continue;
      for (const id of [w.held.dealId, w.late.dealId, w.reg.dealId, w.early.dealId]) {
        const html = await page(key, role, id);
        expect(html, `${role}`).not.toMatch(COMPLIANCE_WORDS);
        for (const s of [PASSPORT, EID, PHONE, IBAN, ...FILE_FACTS]) expect(html).not.toContain(s);
      }
    }
  });

  test("no personal number or file fact on a compliance role's page either", async () => {
    for (const [key, role] of [ROLES[6], ROLES[7]]) {
      for (const id of [w.held.dealId, w.late.dealId]) {
        const html = await page(key, role, id);
        for (const s of [PASSPORT, EID, PHONE, IBAN, ...FILE_FACTS]) expect(html).not.toContain(s);
      }
    }
  });

  test("a compliance role reads case status, risk level and count with a link to the case", async () => {
    const caseId = (await loadCases(getAs("compliance"), "open", undefined))!.items[0]!.id;
    for (const [key, role] of [ROLES[6], ROLES[7]]) {
      const html = await page(key, role, w.held.dealId);
      expect(html).toContain("High");
      expect(html).toContain("1 case");
      expect(html).toContain(`href="/compliance/cases/${caseId}"`);
    }
    expect(await page("admin", "admin", w.held.dealId)).not.toContain("/compliance/cases/");
  });

  test("the case view links to the deal record in the compliance area", async () => {
    const caseId = (await loadCases(getAs("compliance"), "open", undefined))!.items[0]!.id;
    const view = (await loadCase(getAs("compliance"), caseId))!;
    const html = render(<CaseDetail view={view} viewer="compliance_officer" decideAction={noop} />);
    expect(html).toContain(`href="/compliance/deals/${w.held.dealId}"`);
  });

  test("a section is absent before its step, and documents are not drawn when there are none", async () => {
    const sales = await page("officer", "sales_officer", w.held.dealId);
    for (const id of ALL) expect(sales.includes(`id="${id}"`)).toBe(false);
    const comp = await page("compliance", "compliance_officer", w.held.dealId);
    expect(comp.includes('id="aml"')).toBe(true);
    expect(comp.includes('id="signing"')).toBe(false);
  });
});

describe("C39: the web source (S71)", () => {
  const root = `${import.meta.dir}/..`;
  const files = [
    "components/record-sections.tsx",
    "components/deal-record.tsx",
    "app/(staff)/compliance/deals/[id]/page.tsx",
  ];
  const read = async () => Promise.all(files.map((f) => Bun.file(`${root}/${f}`).text()));

  test("the new files exist and call no write route, no form and no button", async () => {
    for (const t of await read()) {
      expect(t).not.toMatch(
        /\.\$(post|put|patch|delete)\b|method:\s*["']POST|<form\b|<button\b|<input\b|"use server"/i,
      );
    }
  });
  test("the record loader still posts nothing and the web reads no clock", async () => {
    const hits: string[] = [];
    for (const dir of ["app", "components", "lib"])
      for await (const f of new Glob(`${dir}/**/*.{ts,tsx}`).scan({ cwd: root })) {
        const text = await Bun.file(`${root}/${f}`).text();
        if (/Date\.now\s*\(|new Date\s*\(\s*\)/.test(text)) hits.push(f);
      }
    expect(hits).toEqual([]);
    const loaders = await Bun.file(`${root}/lib/loaders.ts`).text();
    expect(loaders).not.toMatch(/\.\$(post|put|patch|delete)\b|method:\s*["']POST/i);
  });
  test("no leasing word in the new files", async () => {
    const OTHER = /\b(leas(e|es|ing)|tenan\w*|landlords?|ejari|rental|rent)\b|:3000|:4000|leasing_/i;
    for (const t of await read()) {
      const code = t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
      expect(code).not.toMatch(OTHER);
    }
  });
  test("the compliance deal page asks for the compliance screen, so no other role gets it", async () => {
    const t = await Bun.file(`${root}/app/(staff)/compliance/deals/[id]/page.tsx`).text();
    expect(t).toContain('requireScreen("compliance")');
    expect(t).toContain("loadRecordPage");
    expect(t).toContain("<DealRecord");
  });
});
