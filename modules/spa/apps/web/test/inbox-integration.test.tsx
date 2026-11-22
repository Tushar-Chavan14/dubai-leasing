/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { issueToken } from "../../engine/test/session.ts";
import type { SpaDatabase } from "../../../packages/db/src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../../../packages/db/src/testing.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { createApp } from "../../engine/src/app.ts";
import { SpaDemoClock } from "../../engine/src/clock.ts";
import { buildWorld, EID, PASSPORT, PHONE, type World } from "../../engine/test/reads-fixture.ts";
import { InboxList } from "../components/inbox";
import { type Get, loadInbox } from "../lib/loaders";
import { type Send, submitDecision } from "../lib/inbox";
import { COMPLIANCE_WORDS } from "./fixtures";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();
const noop = async () => {};

/** The real engine routes, the real role filter and the real inbox code, end to end, on the test database. */
describe.skipIf(!url)("C31: the inbox reads and decides through the real engine", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  const token = (role: keyof World["users"]) => issueToken(SECRET, w.users[role]!.id, NOW);
  const getAs =
    (role: keyof World["users"]): Get =>
    async (path, schema) => {
      const res = await app.request(path, { headers: { authorization: `Bearer ${token(role)}` } });
      if ([400, 403, 404].includes(res.status)) return null;
      expect(res.status).toBe(200);
      return schema.parse(await res.json());
    };
  const sent: { path: string; body: any }[] = [];
  const sendAs =
    (role: keyof World["users"]): Send =>
    async (path, init) => {
      sent.push({ path, body: JSON.parse(init.body) });
      return app.request(path, { ...init, headers: { ...init.headers, authorization: `Bearer ${token(role)}` } });
    };
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  const statusOf = async (id: string) =>
    (
      (await (
        await app.request(`/api/approvals/${id}`, { headers: { authorization: `Bearer ${token("compliance")}` } })
      ).json()) as any
    ).status as string;

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
  });
  afterAll(async () => {
    await database?.close();
  });

  test("each role's inbox is the gates it decides: the manager the kyc review, compliance the review, nobody else anything", async () => {
    const ids = async (role: keyof World["users"]) => (await loadInbox(getAs(role), undefined))!.items.map((i) => i.id);
    expect(await ids("manager")).toEqual([w.held.kyc]);
    expect(await ids("compliance")).toEqual([w.held.aml]);
    for (const r of ["officer", "salesadmin", "legal", "finance", "mlro", "admin"] as const)
      expect(await ids(r)).toEqual([]);
  });

  test("the manager's page has a decide form, no personal number and no compliance word; compliance's page has the outcomes", async () => {
    const m = (await loadInbox(getAs("manager"), undefined))!;
    const html = render(<InboxList items={m.items} viewer="sales_manager" decideAction={noop} from="work" />);
    expect(html).toContain('value="approve"');
    expect(html).not.toMatch(COMPLIANCE_WORDS);
    for (const s of [PASSPORT, EID, PHONE]) expect(html).not.toContain(s);
    const c = (await loadInbox(getAs("compliance"), undefined))!;
    const chtml = render(
      <InboxList items={c.items} viewer="compliance_officer" decideAction={noop} from="compliance" />,
    );
    expect(chtml).toContain('value="stop_and_report"');
    expect(chtml).not.toContain("Open deal");
    for (const s of [PASSPORT, EID, PHONE]) expect(chtml).not.toContain(s);
  });

  test("a wrong role is refused by the engine whatever the page showed: nothing is decided", async () => {
    expect(await submitDecision(sendAs("officer"), form({ id: w.held.kyc, decision: "approve" }))).toBe("refused");
    expect(await submitDecision(sendAs("admin"), form({ id: w.held.kyc, decision: "approve" }))).toBe("refused");
    expect(
      await submitDecision(
        sendAs("manager"),
        form({ id: w.held.aml, decision: "aml", outcome: "more_info", note: "x" }),
      ),
    ).toBe("refused");
    expect(await statusOf(w.held.kyc)).toBe("pending");
    expect(await statusOf(w.held.aml)).toBe("pending");
  });

  test("the request carries the decision only, even when the form is stuffed with a role", async () => {
    sent.length = 0;
    await submitDecision(
      sendAs("compliance"),
      form({
        id: w.held.aml,
        decision: "aml",
        outcome: "more_info",
        note: "need the source of funds",
        role: "admin",
        actor: "user:x",
        decidedBy: "x",
      }),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]!.path).toBe(`/api/approvals/${w.held.aml}/decide`);
    expect(sent[0]!.body).toEqual({ decision: "aml", outcome: "more_info", note: "need the source of funds" });
  });

  test("a note-less rejection is stopped before the request; the engine's own refusal of a stuffed body is a 400", async () => {
    sent.length = 0;
    expect(await submitDecision(sendAs("manager"), form({ id: w.held.kyc, decision: "reject" }))).toBe("note");
    expect(sent).toEqual([]);
    const res = await app.request(`/api/approvals/${w.held.kyc}/decide`, {
      method: "POST",
      headers: { authorization: `Bearer ${token("manager")}`, "content-type": "application/json" },
      body: JSON.stringify({ decision: "approve", role: "admin" }),
    });
    expect(res.status).toBe(400);
  });

  test("the right role decides: the manager approves the kyc review and the card closes", async () => {
    expect(
      await submitDecision(sendAs("manager"), form({ id: w.held.kyc, decision: "approve", note: "checked by phone" })),
    ).toBe("done");
    expect(await statusOf(w.held.kyc)).toBe("approved");
    expect((await loadInbox(getAs("manager"), undefined))!.items).toEqual([]);
    expect(await submitDecision(sendAs("manager"), form({ id: w.held.kyc, decision: "approve" }))).toBe("refused");
  });

  test("a bad id is refused without a request", async () => {
    sent.length = 0;
    expect(await submitDecision(sendAs("manager"), form({ id: "not-an-id", decision: "approve" }))).toBe("decision");
    expect(sent).toEqual([]);
  });
});
