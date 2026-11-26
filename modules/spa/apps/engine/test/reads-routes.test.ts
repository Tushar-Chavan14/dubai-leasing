/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { issueToken } from "@platform/kernel";
import { dealEvents, deals, spaApprovals, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { proposeApproval } from "../src/manager/approvals.ts";
import { buildWorld, ctxOf, COMPLIANCE_WORDS, EID, PASSPORT, PHONE, type World } from "./reads-fixture.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

describe.skipIf(!url)("C29: read routes and the role filter (S57)", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  const token = (role: keyof World["users"]) => issueToken(SECRET, w.users[role]!.id, NOW);
  const call = (path: string, as?: keyof World["users"], init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${token(as)}` } : {}),
        ...init.headers,
      },
    });
  const get = async (path: string, as: keyof World["users"]) => {
    const r = await call(path, as);
    return { status: r.status, text: await r.clone().text(), body: (await r.json()) as any };
  };
  const post = async (path: string, as: keyof World["users"], body: unknown) => {
    const r = await call(path, as, { method: "POST", body: JSON.stringify(body) });
    return { status: r.status, text: await r.clone().text(), body: (await r.json()) as any };
  };
  const SALES = ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const;
  const COMPLIANCE = ["compliance", "mlro"] as const;
  const ALL = [...SALES, ...COMPLIANCE] as const;

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

  test("every read route needs a session", async () => {
    for (const p of [
      "/api/deals",
      `/api/deals/${w.held.dealId}`,
      `/api/deals/${w.held.dealId}/events`,
      "/api/approvals?scope=inbox",
      `/api/approvals/${w.held.kyc}`,
      "/api/tasks",
      "/api/summary",
    ])
      expect((await call(p)).status).toBe(401);
    expect((await call(`/api/approvals/${w.held.kyc}/decide`, undefined, { method: "POST", body: "{}" })).status).toBe(
      401,
    );
  });

  describe("GET /api/deals", () => {
    test("one row per deal with the words staff read, and no ID, passport or phone number for any role", async () => {
      for (const role of ALL) {
        const r = await get("/api/deals", role);
        expect(r.status).toBe(200);
        expect(r.body.items).toHaveLength(2);
        for (const s of [PASSPORT, EID, PHONE, "N****567"]) expect(r.text).not.toContain(s);
        expect(r.text).not.toMatch(/passport|emirates|phone/i);
        const held = r.body.items.find((d: any) => d.id === w.held.dealId);
        expect(held).toMatchObject({
          type: "resale_ready",
          typeLabel: "Ready resale",
          buyers: ["Buyer One"],
          sellers: ["Seller One"],
          stageLabel: "On hold · review open",
          onHold: true,
          inDefault: false,
        });
        expect(held.ref).toMatch(/^D-\d{4}$/);
        expect(held.property.kind).toBe("listing");
        if (!COMPLIANCE.includes(role as never)) {
          expect(held.stage).toBe("ON_HOLD");
          expect(r.text).not.toMatch(COMPLIANCE_WORDS);
        } else expect(held.stage).toBe("AML_HOLD");
      }
    });
    test("waitingFor: a compliance review is a neutral label for sales and the compliance role for compliance", async () => {
      const sales = (await get("/api/deals", "officer")).body.items;
      const held = sales.find((d: any) => d.id === w.held.dealId);
      expect(held.waitingFor).toMatchObject({ role: null, label: "Compliance review" });
      // The pending kyc_review is older than the compliance review? No: the oldest pending approval decides. Both are
      // pending from the same clock; the words never name the gate to a role that can't see it.
      const comp = (await get("/api/deals", "compliance")).body.items.find((d: any) => d.id === w.held.dealId);
      expect(comp.waitingFor.role === "compliance_officer" || comp.waitingFor.role === "sales_manager").toBe(true);
      const plain = sales.find((d: any) => d.id === w.plain.dealId);
      expect(plain.waitingFor).toMatchObject({ role: "sales_officer", label: "Prepare the agreement" });
      expect(new Date(plain.waitingFor.since).toString()).not.toBe("Invalid Date");
      expect(typeof plain.waitingFor.waitedDays).toBe("number");
    });
    test("filters: type, stage, hold, default, mine and q (a name, a ref; never an ID number)", async () => {
      const ids = async (qs: string, as: keyof World["users"] = "officer") =>
        ((await get(`/api/deals?${qs}`, as)).body.items as { id: string }[]).map((d) => d.id);
      expect(await ids("type=primary_offplan")).toEqual([w.plain.dealId]);
      expect(await ids("type=resale_ready")).toEqual([w.held.dealId]);
      expect(await ids("stage=AGREEMENT_DRAFT")).toEqual([w.plain.dealId]);
      expect(await ids("stage=ON_HOLD")).toEqual([w.held.dealId]);
      expect(await ids("stage=ON_HOLD", "compliance")).toEqual([w.held.dealId]);
      expect(await ids("stage=AML_HOLD", "compliance")).toEqual([w.held.dealId]);
      expect(await ids("hold=true")).toEqual([w.held.dealId]);
      expect(await ids("q=buyer%20one")).toEqual([w.held.dealId]);
      const [ref] = await database.db.select({ ref: deals.ref }).from(deals).where(eq(deals.id, w.plain.dealId));
      expect(await ids(`q=${ref!.ref}`)).toEqual([w.plain.dealId]);
      expect(await ids(`q=${PASSPORT}`)).toEqual([]);
      expect(await ids(`q=${encodeURIComponent(EID)}`)).toEqual([]);
      expect(await ids("q=%25")).toEqual([]);
      expect(await ids("mine=true")).toEqual([]);
      await database.db
        .update(deals)
        .set({
          inDefault: true,
          inDefaultSince: "2026-11-18",
          inDefaultReason: "overdue",
          createdBy: `user:${w.users.officer!.id}`,
        })
        .where(eq(deals.id, w.plain.dealId));
      expect(await ids("default=true")).toEqual([w.plain.dealId]);
      expect(await ids("mine=true")).toEqual([w.plain.dealId]);
      expect(await ids("mine=true", "manager")).toEqual([]);
    });
    test("a sales role can't ask for the stage by its internal name, and bad input is a 400", async () => {
      expect((await get("/api/deals?stage=AML_HOLD", "officer")).status).toBe(400);
      expect((await get("/api/deals?stage=NOPE", "officer")).status).toBe(400);
      expect((await get("/api/deals?type=nope", "officer")).status).toBe(400);
      expect((await get("/api/deals?limit=101", "officer")).status).toBe(400);
      expect((await get("/api/deals?limit=0", "officer")).status).toBe(400);
      expect((await get("/api/deals?cursor=garbage", "officer")).status).toBe(400);
    });
    test("cursor paging: limit 1 walks both deals once", async () => {
      const first = await get("/api/deals?limit=1", "officer");
      expect(first.body.items).toHaveLength(1);
      expect(first.body.nextCursor).toBeString();
      const second = await get(`/api/deals?limit=1&cursor=${first.body.nextCursor}`, "officer");
      expect(second.body.items).toHaveLength(1);
      expect(second.body.items[0].id).not.toBe(first.body.items[0].id);
      expect(second.body.nextCursor).toBeNull();
    });
  });

  describe("GET /api/deals/:id", () => {
    test("the record assembles every section that applies; a sales role reads 'Compliance review: open' and no AML word or ID number", async () => {
      for (const role of ALL) {
        const r = await get(`/api/deals/${w.held.dealId}`, role);
        expect(r.status).toBe(200);
        for (const s of [PASSPORT, EID, PHONE]) expect(r.text).not.toContain(s);
        expect(Object.keys(r.body.sections).toSorted()).toEqual(
          [
            "approvals",
            "chasing",
            "compliance",
            "documents",
            "helper_runs",
            "parties",
            "steps",
            "tasks",
            // C39 (S71): the compliance review is one more section, for the two compliance roles only.
            ...(COMPLIANCE.includes(role as never) ? ["aml"] : []),
          ].toSorted(),
        );
        expect(r.body.sections.compliance).toMatchObject({ label: "Compliance review", status: "open" });
        expect(r.body.deal).toMatchObject({ ref: expect.stringMatching(/^D-/), typeLabel: "Ready resale" });
        if (!COMPLIANCE.includes(role as never)) {
          expect(r.text).not.toMatch(COMPLIANCE_WORDS);
          expect(r.body.deal.stage).toBe("ON_HOLD");
        }
      }
    });
    test("a primary deal has a payment plan section; a resale has none", async () => {
      const p = await get(`/api/deals/${w.plain.dealId}`, "officer");
      expect(Object.keys(p.body.sections)).toContain("payment_plan");
      const resale = await get(`/api/deals/${w.held.dealId}`, "officer");
      expect(Object.keys(resale.body.sections)).not.toContain("payment_plan");
    });
    test("a deal that does not exist, or a bad id, is a 404", async () => {
      expect((await get(`/api/deals/${crypto.randomUUID()}`, "officer")).status).toBe(404);
      expect((await get("/api/deals/not-an-id", "officer")).status).toBe(404);
    });
  });

  describe("GET /api/deals/:id/events", () => {
    test("newest first, filtered by role, paged", async () => {
      const comp = await get(`/api/deals/${w.held.dealId}/events`, "compliance");
      const types = comp.body.items.map((e: any) => e.type);
      expect(types).toContain("AML_POLICY_PUBLISHED");
      expect(types).toContain("FUTURE_EVENT");
      const at = comp.body.items.map((e: any) => Date.parse(e.at));
      expect(at).toEqual(at.toSorted((a: number, b: number) => b - a));
      for (const role of SALES) {
        const r = await get(`/api/deals/${w.held.dealId}/events`, role);
        const seen = r.body.items.map((e: any) => e.type);
        expect(seen).toContain("COMPLIANCE_REVIEW_RECORDED");
        expect(seen).not.toContain("AML_POLICY_PUBLISHED");
        expect(seen).not.toContain("FUTURE_EVENT");
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
      const p1 = await get(`/api/deals/${w.held.dealId}/events?limit=2`, "officer");
      expect(p1.body.items).toHaveLength(2);
      const p2 = await get(`/api/deals/${w.held.dealId}/events?limit=100&cursor=${p1.body.nextCursor}`, "officer");
      const all = await get(`/api/deals/${w.held.dealId}/events?limit=100`, "officer");
      expect([...p1.body.items, ...p2.body.items].map((e: any) => e.id)).toEqual(all.body.items.map((e: any) => e.id));
    });
    test("paging with hidden events in between never skips a visible one", async () => {
      const all = (await get(`/api/deals/${w.held.dealId}/events?limit=100`, "officer")).body.items.map(
        (e: any) => e.id,
      );
      const walked: string[] = [];
      let cursor = "";
      for (let i = 0; i < 20; i++) {
        const r = await get(`/api/deals/${w.held.dealId}/events?limit=1${cursor}`, "officer");
        walked.push(...r.body.items.map((e: any) => e.id));
        if (!r.body.nextCursor) break;
        cursor = `&cursor=${r.body.nextCursor}`;
      }
      expect(walked).toEqual(all);
    });
    test("an unknown deal is a 404", async () => {
      expect((await get(`/api/deals/${crypto.randomUUID()}/events`, "officer")).status).toBe(404);
    });
  });

  describe("approvals", () => {
    test("inbox: each role sees the gates it decides; a compliance gate is in no sales inbox; admin has none", async () => {
      const ids = async (role: keyof World["users"]) =>
        ((await get("/api/approvals?scope=inbox", role)).body.items as { id: string }[]).map((a) => a.id);
      expect(await ids("manager")).toEqual([w.held.kyc]);
      expect(await ids("compliance")).toEqual([w.held.aml]);
      expect(await ids("officer")).toEqual([]);
      expect(await ids("admin")).toEqual([]);
      expect(await ids("mlro")).toEqual([]);
      const m = await get("/api/approvals?scope=inbox", "manager");
      expect(m.body.items[0]).toMatchObject({
        gate: "kyc_review",
        entityRef: expect.stringMatching(/^D-/),
        mayDecide: { ok: true },
      });
      expect(m.text).not.toMatch(COMPLIANCE_WORDS);
      for (const s of [PASSPORT, PHONE]) expect(m.text).not.toContain(s);
    });
    test("deal scope: sales read a neutral entry for the compliance gate; compliance read all", async () => {
      const sales = await get(`/api/approvals?scope=deal&dealId=${w.held.dealId}`, "manager");
      expect(sales.body.items.map((a: any) => a.gate).toSorted()).toEqual(["compliance_review", "kyc_review"]);
      const neutral = sales.body.items.find((a: any) => a.gate === "compliance_review");
      expect(neutral).toEqual({
        id: w.held.aml,
        gate: "compliance_review",
        title: "Compliance review",
        status: "open",
        entity: { kind: "deal", id: w.held.dealId },
        entityRef: expect.any(String),
      });
      expect(sales.text).not.toMatch(COMPLIANCE_WORDS);
      const comp = await get(`/api/approvals?scope=deal&dealId=${w.held.dealId}`, "compliance");
      expect(comp.body.items.map((a: any) => a.gate).toSorted()).toEqual(["aml_flag", "kyc_review"]);
      expect((await get("/api/approvals?scope=deal", "manager")).status).toBe(400);
      expect((await get("/api/approvals?scope=nope", "manager")).status).toBe(400);
    });
    test("one approval: neutral for a role that can't see it, in full for compliance; unknown is 404", async () => {
      for (const role of SALES) {
        const r = await get(`/api/approvals/${w.held.aml}`, role);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({ gate: "compliance_review", title: "Compliance review", status: "open" });
        expect(r.body.proposal).toBeUndefined();
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
      const c = await get(`/api/approvals/${w.held.aml}`, "compliance");
      expect(c.body).toMatchObject({ gate: "aml_flag", proposal: { rule: "sanctions" } });
      expect((await get(`/api/approvals/${crypto.randomUUID()}`, "manager")).status).toBe(404);
      expect((await get("/api/approvals/x", "manager")).status).toBe(404);
    });
  });

  describe("GET /api/tasks and /api/summary", () => {
    test("tasks: your own role's; a manager sees every non-compliance role's; compliance tasks only to compliance", async () => {
      const titles = async (qs: string, role: keyof World["users"]) =>
        ((await get(`/api/tasks${qs}`, role)).body.items as { title: string }[]).map((t) => t.title);
      expect(await titles("", "officer")).toEqual(["Confirm the bank amount"]);
      expect(await titles("", "manager")).toEqual([]);
      expect(await titles("?scope=all", "manager")).toEqual(["Confirm the bank amount"]);
      expect(await titles("", "compliance")).toEqual(["Look at this payment"]);
      expect(await titles("", "admin")).toEqual([]);
      expect((await get("/api/tasks?scope=all", "officer")).status).toBe(403);
      expect(await titles(`?dealId=${w.held.dealId}`, "officer")).toEqual(["Confirm the bank amount"]);
      expect(await titles("?status=done", "officer")).toEqual([]);
      expect((await get("/api/tasks?status=nope", "officer")).status).toBe(400);
    });
    test("summary: open counts per role, with the stage a role may read", async () => {
      const m = (await get("/api/summary", "manager")).body;
      expect(m.inbox).toEqual({ open: 1 });
      expect(m.deals.open).toBe(2);
      expect(m.deals.onHold).toBe(1);
      expect(m.deals.byStage).toEqual({ ON_HOLD: 1, AGREEMENT_DRAFT: 1 });
      expect((await get("/api/summary", "officer")).body.tasks).toEqual({ open: 1 });
      const c = (await get("/api/summary", "compliance")).body;
      expect(c.inbox).toEqual({ open: 1 });
      expect(c.deals.byStage).toEqual({ AML_HOLD: 1, AGREEMENT_DRAFT: 1 });
      expect((await get("/api/summary", "officer")).text).not.toMatch(COMPLIANCE_WORDS);
      expect((await get("/api/summary", "admin")).body.inbox).toEqual({ open: 0 });
    });
  });

  describe("POST /api/approvals/:id/decide", () => {
    const pending = async (id: string) =>
      (await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, id)))[0]!.status;
    test("the body carries only the decision: a role or an actor in it is refused and decides nothing", async () => {
      for (const extra of [{ role: "sales_manager" }, { actor: "user:x" }, { decidedBy: w.users.manager!.id }]) {
        const r = await post(`/api/approvals/${w.held.kyc}/decide`, "manager", { decision: "approve", ...extra });
        expect(r.status).toBe(400);
        expect(await pending(w.held.kyc)).toBe("pending");
      }
      // Admin forging a role in the body is no better off.
      const forged = await post(`/api/approvals/${w.held.kyc}/decide`, "admin", {
        decision: "approve",
        role: "sales_manager",
      });
      expect(forged.status).toBe(400);
      expect(await pending(w.held.kyc)).toBe("pending");
    });
    test("admin, the wrong role and a sales role on a compliance gate are 403, and the compliance gate says nothing about itself", async () => {
      expect((await post(`/api/approvals/${w.held.kyc}/decide`, "admin", { decision: "approve" })).status).toBe(403);
      expect((await post(`/api/approvals/${w.held.kyc}/decide`, "officer", { decision: "approve" })).status).toBe(403);
      for (const role of SALES) {
        const r = await post(`/api/approvals/${w.held.aml}/decide`, role, { decision: "aml", outcome: "clear" });
        expect(r.status).toBe(403);
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
      // MLRO decides aml_report only, not the officer's flag.
      expect(
        (await post(`/api/approvals/${w.held.aml}/decide`, "mlro", { decision: "aml", outcome: "clear" })).status,
      ).toBe(403);
      expect(await pending(w.held.aml)).toBe("pending");
    });
    test("the proposer can't decide their own proposal", async () => {
      const own = await proposeApproval(ctxOf(database), {
        gate: "kyc_review",
        entity: { kind: "deal", id: w.plain.dealId },
        dedupeKey: `${w.plain.dealId}:kyc_review:own`,
        title: "Check the documents",
        proposal: {},
        proposedBy: `user:${w.users.manager!.id}`,
      });
      expect((await post(`/api/approvals/${own.id}/decide`, "manager", { decision: "approve" })).status).toBe(403);
      expect(await pending(own.id)).toBe("pending");
    });
    test("the right role decides with the session's own identity; a second decision is 409", async () => {
      const ok = await post(`/api/approvals/${w.held.kyc}/decide`, "manager", {
        decision: "approve",
        note: "documents fine",
      });
      expect(ok.status).toBe(200);
      expect(ok.body.status).toBe("approved");
      const [row] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, w.held.kyc));
      expect(row!.decidedBy).toBe(w.users.manager!.id);
      expect((await post(`/api/approvals/${w.held.kyc}/decide`, "manager", { decision: "approve" })).status).toBe(409);
      const ev = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "APPROVAL_DECIDED"));
      expect(ev.some((e) => e.actor === `user:${w.users.manager!.id}`)).toBe(true);
    });
    test("a compliance officer decides the compliance gate (more information keeps the hold)", async () => {
      const r = await post(`/api/approvals/${w.held.aml}/decide`, "compliance", {
        decision: "aml",
        outcome: "more_info",
        note: "ask for the source of funds",
      });
      expect(r.status).toBe(200);
      expect(r.body.outcome).toBe("more_info");
      // After the decision, sales still read only 'closed'.
      const sales = await get(`/api/approvals/${w.held.aml}`, "manager");
      expect(sales.body).toMatchObject({ gate: "compliance_review", status: "closed" });
      expect(sales.text).not.toMatch(/more_info|source of funds/);
    });
    test("an invalid decision is a 422 and an unknown approval a 404", async () => {
      expect(
        (await post(`/api/approvals/${crypto.randomUUID()}/decide`, "manager", { decision: "approve" })).status,
      ).toBe(404);
      expect((await post(`/api/approvals/x/decide`, "manager", { decision: "approve" })).status).toBe(404);
    });
  });
});
