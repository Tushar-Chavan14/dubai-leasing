/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { FakeLlm, type SystemOneResponse } from "@platform/llm";
import { callTool, say, ScriptedAgentModel, type AgentModel } from "@platform/llm/agent";
import {
  agreements,
  assistantMessages,
  copilotDrafts,
  copilotProposals,
  dealEvents,
  deals,
  documentRequests,
  signatures,
  signingEnvelopes,
  spaTasks,
  spaUsers,
  type SpaDatabase,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, desc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { prepareForProposal } from "../src/manager/copilot.ts";
import { addTemplateVersion, createTemplate } from "../src/manager/templates.ts";
import { dealInDraft, mouTpl, RB, seedUsers, toData, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const SECRET = "s".repeat(40);
const T0 = Date.parse("2026-11-19T06:00:00Z");

describe.skipIf(!url)("C36 copilot routes (S68)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  let now = T0;
  const clock = new FixedClock(new Date(T0));
  const mailer = new FakeMailer();
  const jobs: { name: string; data: unknown; opts: unknown }[] = [];
  /** Set by a test to make the queue fail, so a confirmed proposal's effect throws. */
  let queueDown = false;
  /** The chat model of the moment; each chat test sets its script. */
  let current: AgentModel = new ScriptedAgentModel([() => say("ok")]);
  const delegate: AgentModel = { name: "chat-test", respond: (...a) => current.respond(...a) };
  const gate = new FakeLlm((): SystemOneResponse => ({
    model: "fake-decide",
    answers: {
      scope: { type: "choice", choice: "deals", confidence: 1, probabilities: { off_topic: 0.01, deals: 0.99 } },
    },
  }));
  let app: ReturnType<typeof createApp>;
  const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts, rulebook: () => RB });
  const token = (u: U) => issueToken(SECRET, u.id, now);
  const api = async (method: string, path: string, as?: U, body?: unknown) => {
    const r = await app.request(path, {
      method,
      headers: { "content-type": "application/json", ...(as ? { authorization: `Bearer ${token(as)}` } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    return { status: r.status, text, body: text ? (JSON.parse(text) as any) : null };
  };
  const rows = async (sql: string, args: unknown[] = []) => (await database.pool.query(sql, args)).rows;
  const threadOf = async (u: U): Promise<string> => {
    const r = await api("POST", "/api/copilot/chat", u, { text: "hello" });
    return r.body.threadId;
  };
  let n = 0;
  const draftDeal = () =>
    dealInDraft(ctx(), database, { type: "resale_ready", buyers: [`Buyer ${++n}`], sellers: [`Seller ${n}`] });
  const propose = async (
    u: U,
    kind: string,
    dealId: string | null,
    payload: Record<string, unknown> = {},
    thread?: string,
  ) => api("POST", "/api/copilot/proposals", u, { threadId: thread ?? (await threadOf(u)), kind, dealId, payload });

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    app = createApp({
      database,
      jobs: {
        boss: {
          getQueue: async () => ({}),
          send: async (name: string, data: unknown, opts: unknown) => {
            if (queueDown) throw new Error("queue down");
            jobs.push({ name, data, opts });
            return "job-1";
          },
        } as never,
        lastHeartbeat: () => null,
      },
      clock: clock as unknown as SpaDemoClock,
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => now,
      rulebook: () => RB,
      mail: { mailer, webBaseUrl: "https://spa.example.test" },
      assistants: { model: delegate, llm: gate, tag: "chat-test" },
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("GET /api/copilot/rulebook", () => {
    test("returns the value with its rulesVersion, for every role", async () => {
      for (const u of Object.values(users)) {
        const r = await api("GET", "/api/copilot/rulebook?key=registrationFeeBps", u);
        expect(r.status).toBe(200);
        expect(r.body).toMatchObject({
          key: "registrationFeeBps",
          rulesVersion: "dubai-sales-2026-01",
          status: "confirmed",
          bps: 400,
          percent: 4,
        });
      }
    });
    test("money keys come back in fils, and the payer as a word", async () => {
      const a = await api("GET", "/api/copilot/rulebook?key=trusteeFeeFils", users.officer);
      expect(a.body).toMatchObject({ status: "confirmed", amountFils: 400_000 });
      const b = await api("GET", "/api/copilot/rulebook?key=minBookingBps", users.officer);
      expect(b.body).toMatchObject({ bps: 1000, percent: 10 });
    });
    test("a value still awaiting legal says 'pending confirmation' and carries no number", async () => {
      const pending = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => now,
      });
      const r = await pending.request("/api/copilot/rulebook?key=trusteeFeeFils", {
        headers: { authorization: `Bearer ${token(users.officer!)}` },
      });
      const body = (await r.json()) as any;
      expect(body).toEqual({
        key: "trusteeFeeFils",
        rulesVersion: "dubai-sales-2026-01",
        status: "pending confirmation",
      });
    });
    test("a deal's own rulebook version is used when a deal is named", async () => {
      const { dealId } = await draftDeal();
      const r = await api("GET", `/api/copilot/rulebook?key=registrationFeeBps&dealId=${dealId}`, users.officer);
      expect(r.body.rulesVersion).toBe("dubai-sales-2026-01");
    });
    test("an unknown key, an AML key and a missing session are refused", async () => {
      expect((await api("GET", "/api/copilot/rulebook?key=nope", users.officer)).status).toBe(400);
      expect((await api("GET", "/api/copilot/rulebook?key=amlNameMatchThreshold", users.officer)).status).toBe(400);
      expect((await api("GET", "/api/copilot/rulebook", users.officer)).status).toBe(400);
      expect((await api("GET", "/api/copilot/rulebook?key=registrationFeeBps")).status).toBe(401);
    });
  });

  describe("GET /api/deals/:id/noc-status", () => {
    test("sales, legal, finance and admin read it; compliance roles get 403; no document ids leak", async () => {
      const { dealId } = await draftDeal();
      for (const k of ["officer", "manager", "salesadmin", "legal", "finance", "admin"]) {
        const r = await api("GET", `/api/deals/${dealId}/noc-status`, users[k]);
        expect(r.status).toBe(200);
        expect(r.body).toEqual({ noc: null, bankLetters: [] });
      }
      for (const k of ["compliance", "mlro"])
        expect((await api("GET", `/api/deals/${dealId}/noc-status`, users[k])).status).toBe(403);
      expect((await api("GET", `/api/deals/${newId()}/noc-status`, users.officer)).status).toBe(404);
      expect((await api("GET", `/api/deals/${dealId}/noc-status`)).status).toBe(401);
    });
  });

  describe("the compliance case routes stay closed to the sales roles", () => {
    test("a sales role gets 403 on the case list and a case; a compliance role gets 200", async () => {
      for (const k of ["officer", "manager", "salesadmin", "legal", "finance", "admin"]) {
        expect((await api("GET", "/api/compliance/cases", users[k])).status).toBe(403);
        expect((await api("GET", `/api/compliance/cases/${newId()}`, users[k])).status).toBe(403);
      }
      expect((await api("GET", "/api/compliance/cases", users.mlro)).status).toBe(200);
      expect((await api("GET", "/api/compliance/cases", users.compliance)).status).toBe(200);
    });
  });

  describe("proposals: store, confirm, cancel, expire", () => {
    test("storing a proposal does nothing: no request, no task, no event, no job", async () => {
      const { dealId } = await draftDeal();
      const before = (await rows("select count(*)::int as n from deal_events"))[0].n;
      const r = await propose(users.officer!, "request_documents", dealId);
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ kind: "request_documents", status: "proposed" });
      expect(r.body.summary).toMatch(/documents/i);
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
      expect((await rows("select count(*)::int as n from deal_events"))[0].n).toBe(before);
    });

    test("request_documents: confirm by the same user runs requestDocuments as them, with an event marked viaProposal", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ status: "confirmed", result: { requested: 2 } });
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        2,
      );
      const [ev] = await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, dealId), eq(dealEvents.type, "COPILOT_PROPOSAL_CONFIRMED")));
      expect(ev).toMatchObject({
        actor: `user:${users.officer!.id}`,
        payload: { proposalId: p.body.id, kind: "request_documents", viaProposal: true },
      });
      const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.body.id));
      expect(row).toMatchObject({ status: "confirmed" });
      expect(row!.confirmedAt).not.toBeNull();
    });

    test("create_task: the task exists only after Confirm, as kind copilot_task for the chosen role", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "create_task", dealId, {
        title: "Call the seller about the NOC",
        forRole: "finance",
      });
      expect(p.status).toBe(201);
      expect(await database.db.select().from(spaTasks).where(eq(spaTasks.kind, "copilot_task"))).toHaveLength(0);
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(200);
      const [t] = await database.db.select().from(spaTasks).where(eq(spaTasks.kind, "copilot_task"));
      expect(t).toMatchObject({
        role: "finance",
        title: "Call the seller about the NOC",
        dealId,
        dedupeKey: `copilot:${p.body.id}`,
        status: "open",
      });
      expect(c.body.result).toMatchObject({ taskId: t!.id });
    });

    test("create_task: a compliance word in the title, a compliance role as target or a missing title is refused at storing", async () => {
      const u = users.officer!;
      expect((await propose(u, "create_task", null, { title: "Check the sanctions list" })).status).toBe(422);
      expect((await propose(u, "create_task", null, { title: "Chase it", forRole: "mlro" })).status).toBe(422);
      expect((await propose(u, "create_task", null, { title: "x" })).status).toBe(422);
      expect((await propose(u, "create_task", null, { title: "Call the broker" })).status).toBe(201);
    });

    test("prepare_agreement: queues the job on Confirm only; the agreement still waits for legal", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "prepare_agreement", dealId);
      expect(p.status).toBe(201);
      jobs.length = 0;
      expect(jobs).toHaveLength(0);
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(200);
      expect(c.body.result).toMatchObject({ queued: true });
      expect(jobs.map((j) => j.name)).toEqual(["spa.prepare"]);
      expect(await database.db.select().from(agreements).where(eq(agreements.dealId, dealId))).toHaveLength(0);
    });

    test("prepare_agreement: a deal not in the agreement step is refused at storing, and at Confirm if it moved since", async () => {
      const a = await draftDeal();
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, a.dealId));
      expect((await propose(users.officer!, "prepare_agreement", a.dealId)).status).toBe(409);
      const b = await draftDeal();
      const p = await propose(users.officer!, "prepare_agreement", b.dealId);
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, b.dealId));
      jobs.length = 0;
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(409);
      expect(jobs).toHaveLength(0);
      const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.body.id));
      expect(row!.status).toBe("proposed");
    });

    test("a refusal about the agreement step never names a compliance hold to a sales role, at storing or at Confirm", async () => {
      const a = await draftDeal();
      await database.db.update(deals).set({ state: "AML_HOLD" }).where(eq(deals.id, a.dealId));
      const stored = await propose(users.officer!, "prepare_agreement", a.dealId);
      expect(stored.status).toBe(409);
      expect(stored.text).not.toMatch(/aml|screening|sanction/i);
      const b = await draftDeal();
      const p = await propose(users.officer!, "prepare_agreement", b.dealId);
      await database.db.update(deals).set({ state: "AML_HOLD" }).where(eq(deals.id, b.dealId));
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(409);
      expect(c.text).not.toMatch(/aml|screening|sanction/i);
    });

    test("an effect that throws leaves the proposal confirmed with a failure result; a second Confirm is 409 and nothing runs twice", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "prepare_agreement", dealId);
      jobs.length = 0;
      queueDown = true;
      let c;
      try {
        c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      } finally {
        queueDown = false;
      }
      expect(c.status).toBe(200);
      expect(c.body).toMatchObject({ status: "confirmed", result: { failed: true } });
      expect(typeof c.body.result.message).toBe("string");
      const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.body.id));
      expect(row).toMatchObject({ status: "confirmed", result: { failed: true } });
      const events = await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, dealId), eq(dealEvents.type, "COPILOT_PROPOSAL_CONFIRMED")));
      expect(events).toHaveLength(1);
      const again = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(again.status).toBe(409);
      expect(jobs).toHaveLength(0);
    });

    test("the agreement-step refusal in the Confirm race says nothing about the deal's state", async () => {
      const a = await draftDeal();
      await database.db.update(deals).set({ state: "AML_HOLD" }).where(eq(deals.id, a.dealId));
      const err = await prepareForProposal(ctx(), { send: async () => null } as never, a.dealId, users.officer!).catch(
        (e) => e,
      );
      expect(err).toMatchObject({ status: 409, code: "not_in_agreement_draft" });
      expect(String(err.message)).not.toMatch(/aml|hold|screening|sanction/i);
    });

    test("deals are not scoped to a user: another sales role reads and proposes on a deal this officer created", async () => {
      const { dealId } = await draftDeal();
      await database.db
        .update(deals)
        .set({ createdBy: `user:${users.officer!.id}` })
        .where(eq(deals.id, dealId));
      expect((await api("GET", `/api/deals/${dealId}`, users.manager)).status).toBe(200);
      expect((await propose(users.manager!, "request_documents", dealId)).status).toBe(201);
    });

    test("resend_signing_link: Confirm sends a new link to that signer, as the user; a signer who signed is refused at storing", async () => {
      const w = await draftDeal();
      const t = await createTemplate(ctx(), { name: `mou-${++n}`, documentKind: "mou" }, users.admin!);
      const v = await addTemplateVersion(
        ctx(),
        { templateId: t.id, docId: "d1", docHash: "a".repeat(64), data: toData(mouTpl()) },
        users.admin!,
      );
      const agreementId = newId();
      await database.db.insert(agreements).values({
        id: agreementId,
        dealId: w.dealId,
        kind: "mou",
        version: 1,
        templateVersionId: v.id,
        status: "approved",
        docHash: "h",
        storageKey: "k",
        valuesHash: "v",
        fieldSources: {},
        rulesVersion: "dubai-sales-2026-01",
        policyVersion: 1,
        preparedBy: "system",
        preparedAt: new Date(T0),
      });
      const envelopeId = newId();
      await database.db.insert(signingEnvelopes).values({
        id: envelopeId,
        dealId: w.dealId,
        agreementId,
        docHash: "h",
        status: "open",
        createdAt: new Date(T0),
      });
      const sigId = newId();
      const signedId = newId();
      const mk = (id: string, seq: number, partyId: string, signed: boolean) =>
        database.db.insert(signatures).values({
          id,
          envelopeId,
          seq,
          role: "purchaser",
          partyId,
          nameOnAgreement: `Buyer ${seq}`,
          email: `b${seq}@example.test`,
          linkTokenHash: `hash-${id}`,
          linkExpiresAt: new Date(T0 + 86_400_000 * 7),
          anchor: {},
          ...(signed ? { signedAt: new Date(T0), typedName: "Buyer", consent: true, linkUsedAt: new Date(T0) } : {}),
        });
      await mk(signedId, 1, w.buyerIds[0]!, true);
      await mk(sigId, 2, w.buyerIds[0]!, false);
      expect((await propose(users.officer!, "resend_signing_link", w.dealId, { signatureId: signedId })).status).toBe(
        409,
      );
      expect((await propose(users.officer!, "resend_signing_link", w.dealId, { signatureId: newId() })).status).toBe(
        404,
      );
      const p = await propose(users.officer!, "resend_signing_link", w.dealId, { signatureId: sigId });
      expect(p.status).toBe(201);
      mailer.sent.length = 0;
      expect(mailer.sent).toHaveLength(0);
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect(c.status).toBe(200);
      expect(c.body.result).toMatchObject({ status: "sent" });
      expect(mailer.sent).toHaveLength(1);
      expect(mailer.sent[0]!.to).toBe("b2@example.test");
    });

    test("another user's Confirm or Cancel is 403 and nothing runs; the proposal stays proposed", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      for (const who of [users.manager!, users.salesadmin!, users.admin!, users.mlro!]) {
        expect((await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, who)).status).toBe(403);
        expect((await api("POST", `/api/copilot/proposals/${p.body.id}/cancel`, who)).status).toBe(403);
      }
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
      const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.body.id));
      expect(row!.status).toBe("proposed");
      expect((await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`)).status).toBe(401);
      expect((await api("POST", `/api/copilot/proposals/${newId()}/confirm`, users.officer)).status).toBe(404);
    });

    test("cancel: the proposal is cancelled, and a later Confirm is 409", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      expect((await api("POST", `/api/copilot/proposals/${p.body.id}/cancel`, users.officer)).body).toMatchObject({
        status: "cancelled",
      });
      expect((await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer)).status).toBe(409);
      expect((await api("POST", `/api/copilot/proposals/${p.body.id}/cancel`, users.officer)).status).toBe(409);
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
    });

    test("confirming twice is 409 and runs once", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      const first = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      const again = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      expect([first.status, again.status]).toEqual([200, 409]);
      expect(
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, dealId), eq(dealEvents.type, "COPILOT_PROPOSAL_CONFIRMED"))),
      ).toHaveLength(1);
    });

    test("an expired proposal is 410, is marked expired, and runs nothing", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      expect(new Date(p.body.expiresAt).getTime()).toBeGreaterThan(T0);
      const later = new Date(p.body.expiresAt).getTime() + 1000;
      const keep = now;
      now = later;
      // The engine's calendar is the SPA Clock: move the test's FixedClock past the expiry for the request.
      clock.set(new Date(later));
      const c = await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer);
      clock.set(new Date(T0));
      now = keep;
      expect(c.status).toBe(410);
      const [row] = await database.db.select().from(copilotProposals).where(eq(copilotProposals.id, p.body.id));
      expect(row!.status).toBe("expired");
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
    });

    test("the role is checked again at Confirm: a user whose role changed since is refused", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      await database.db.update(spaUsers).set({ role: "finance" }).where(eq(spaUsers.id, users.officer!.id));
      try {
        expect((await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer)).status).toBe(403);
      } finally {
        await database.db.update(spaUsers).set({ role: "sales_officer" }).where(eq(spaUsers.id, users.officer!.id));
      }
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
    });

    test("the deal state is checked again at Confirm: a cancelled deal is 409", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, dealId));
      expect((await api("POST", `/api/copilot/proposals/${p.body.id}/confirm`, users.officer)).status).toBe(409);
      expect((await propose(users.officer!, "request_documents", dealId)).status).toBe(409);
    });

    test("storing is checked: kinds by role, a deal that exists, a thread that is the caller's, a valid body", async () => {
      const { dealId } = await draftDeal();
      // legal may not propose request_documents; a sales role may not propose via another user's thread
      expect((await propose(users.legal!, "request_documents", dealId)).status).toBe(403);
      expect((await propose(users.mlro!, "prepare_agreement", dealId)).status).toBe(403);
      expect((await propose(users.officer!, "request_documents", newId())).status).toBe(404);
      const theirs = await threadOf(users.manager!);
      expect((await propose(users.officer!, "request_documents", dealId, {}, theirs)).status).toBe(404);
      expect(
        (await api("POST", "/api/copilot/proposals", users.officer, { kind: "approve_gate", dealId })).status,
      ).toBe(400);
      expect((await propose(users.officer!, "approve_gate", dealId)).status).toBe(400);
      expect((await api("POST", "/api/copilot/proposals", undefined, {})).status).toBe(401);
      // a proposal for a deal needs a deal
      expect((await propose(users.officer!, "request_documents", null)).status).toBe(400);
    });

    test("a proposal row cannot be edited, even by SQL: the payload is fixed", async () => {
      const { dealId } = await draftDeal();
      const p = await propose(users.officer!, "request_documents", dealId);
      await expect(
        database.pool.query("update copilot_proposals set payload = '{}' where id = $1", [p.body.id]),
      ).rejects.toThrow(/payload/);
    });
  });

  describe("drafts", () => {
    test("a draft is stored for its user, read back by them only, and cannot be edited or deleted", async () => {
      const { dealId } = await draftDeal();
      const thread = await threadOf(users.officer!);
      const r = await api("POST", "/api/copilot/drafts", users.officer, {
        threadId: thread,
        kind: "email",
        dealId,
        to: "buyer",
        subject: "Your documents",
        body: "Dear buyer, please send the documents.",
      });
      expect(r.status).toBe(201);
      expect(r.body).toMatchObject({ kind: "email" });
      const got = await api("GET", `/api/copilot/drafts/${r.body.id}`, users.officer);
      expect(got.body).toMatchObject({ kind: "email", dealId });
      expect(got.body.body).toContain("Subject: Your documents");
      expect((await api("GET", `/api/copilot/drafts/${r.body.id}`, users.manager)).status).toBe(404);
      expect((await api("GET", `/api/copilot/drafts/${r.body.id}`)).status).toBe(401);
      await expect(
        database.pool.query("update copilot_drafts set body = 'x' where id = $1", [r.body.id]),
      ).rejects.toThrow(/immutable/);
      await expect(database.pool.query("delete from copilot_drafts where id = $1", [r.body.id])).rejects.toThrow(
        /immutable/,
      );
    });

    test("drafts are checked by kind and role; a number or a compliance word never lands in a draft for a non-compliance role", async () => {
      const { dealId } = await draftDeal();
      const thread = await threadOf(users.officer!);
      const post = (u: U, body: Record<string, unknown>, t = thread) =>
        api("POST", "/api/copilot/drafts", u, { threadId: t, dealId, ...body });
      // an officer may not write an approval note; legal may not write an email
      expect((await post(users.officer!, { kind: "approval_note", body: "Looks right to me." })).status).toBe(403);
      const lt = await threadOf(users.legal!);
      expect(
        (
          await post(
            users.legal!,
            { kind: "email", to: "buyer", subject: "Hello there", body: "A message for you." },
            lt,
          )
        ).status,
      ).toBe(403);
      expect(
        (await post(users.officer!, { kind: "summary", body: "The deal is waiting for the screening result." })).status,
      ).toBe(422);
      expect((await post(users.officer!, { kind: "summary", body: "The deal is in the agreement step." })).status).toBe(
        201,
      );
      expect((await post(users.officer!, { kind: "bogus", body: "The deal is in the agreement step." })).status).toBe(
        400,
      );
      expect((await post(users.officer!, { kind: "summary", body: "short" })).status).toBe(400);
      const mt = await threadOf(users.mlro!);
      expect(
        (await post(users.mlro!, { kind: "summary", body: "The screening found a match on one buyer." }, mt)).status,
      ).toBe(201);
    });

    test("draft PII is masked before it is stored", async () => {
      const { dealId } = await draftDeal();
      const thread = await threadOf(users.officer!);
      const r = await api("POST", "/api/copilot/drafts", users.officer, {
        threadId: thread,
        kind: "summary",
        dealId,
        body: "The buyer's passport is N1234567 and the phone is +971 50 123 4567.",
      });
      const [row] = await database.db.select().from(copilotDrafts).where(eq(copilotDrafts.id, r.body.id));
      expect(row!.body).not.toContain("N1234567");
      expect(row!.body).not.toContain("123 4567");
    });
  });

  describe("POST /api/copilot/chat and GET /api/copilot/thread", () => {
    test("a signed-in user chats: the turn runs as them, the thread is a staff thread keyed by a hash, and the turn is stored", async () => {
      current = new ScriptedAgentModel([() => say("Nothing is waiting for you right now.")]);
      const r = await api("POST", "/api/copilot/chat", users.officer, { text: "What is waiting for me?" });
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({
        reply: "Nothing is waiting for you right now.",
        kind: "answer",
        verified: true,
        unverified: [],
        proposals: [],
        drafts: [],
      });
      const [t] = await rows("select * from assistant_threads where id = $1", [r.body.threadId]);
      expect(t.kind).toBe("staff");
      expect(t.principal_hash).not.toContain(users.officer!.id);
      const msgs = await database.db
        .select()
        .from(assistantMessages)
        .where(eq(assistantMessages.threadId, r.body.threadId))
        .orderBy(desc(assistantMessages.at));
      expect(msgs.some((m) => m.role === "assistant" && m.modelTag === "chat-test")).toBe(true);
      const th = await api("GET", "/api/copilot/thread", users.officer);
      expect(th.body.messages.map((m: any) => m.role)).toContain("assistant");
      expect(th.body.messages.every((m: any) => m.role === "user" || m.role === "assistant")).toBe(true);
      const other = await api("GET", "/api/copilot/thread", users.manager);
      expect(JSON.stringify(other.body)).not.toContain("What is waiting for me?");
    });

    test("a chat needs a session, a body, and a configured model", async () => {
      expect((await api("POST", "/api/copilot/chat", undefined, { text: "hi" })).status).toBe(401);
      expect((await api("POST", "/api/copilot/chat", users.officer, { text: "" })).status).toBe(400);
      expect((await api("POST", "/api/copilot/chat", users.officer, { text: "x".repeat(2001) })).status).toBe(400);
      const bare = createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => now,
      });
      const r = await bare.request("/api/copilot/chat", {
        method: "POST",
        headers: { authorization: `Bearer ${token(users.officer!)}`, "content-type": "application/json" },
        body: JSON.stringify({ text: "hi" }),
      });
      expect(r.status).toBe(503);
    });

    test("tools run through the user's own routes: a sales officer reads deals; the same call as legal is refused by the route and the model is told so", async () => {
      const d = await draftDeal();
      current = new ScriptedAgentModel([
        () => callTool("search_deals", { q: "D-" }),
        () => say("Here are your deals."),
      ]);
      const a = await api("POST", "/api/copilot/chat", users.officer, { text: "Find the deals" });
      expect(a.body.tools).toEqual([{ name: "search_deals", ok: true }]);
      current = new ScriptedAgentModel([
        () => callTool("get_settlement", { dealId: d.dealId }),
        () => say("I can't read that statement."),
      ]);
      const b = await api("POST", "/api/copilot/chat", users.admin, { text: "Open the settlement" });
      // admin is not offered get_settlement at all
      expect(b.body.tools).toEqual([{ name: "get_settlement", ok: false }]);
    });

    test("a proposal from chat comes back as a card, stays proposed, and Confirm is a separate request", async () => {
      const { dealId } = await draftDeal();
      current = new ScriptedAgentModel([() => callTool("request_documents", { dealId })]);
      const r = await api("POST", "/api/copilot/chat", users.officer, { text: "Ask for the documents" });
      expect(r.body.reply).toContain("Nothing has happened yet");
      expect(r.body.proposals).toHaveLength(1);
      expect(r.body.proposals[0]).toMatchObject({ kind: "request_documents", status: "proposed" });
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        0,
      );
      const c = await api("POST", `/api/copilot/proposals/${r.body.proposals[0].id}/confirm`, users.officer);
      expect(c.status).toBe(200);
      expect(await database.db.select().from(documentRequests).where(eq(documentRequests.dealId, dealId))).toHaveLength(
        2,
      );
    });

    test("a draft from chat comes back with its text for the card", async () => {
      current = new ScriptedAgentModel([
        () => callTool("draft_summary", { body: "The deal is in the agreement step and waits for legal." }),
      ]);
      const r = await api("POST", "/api/copilot/chat", users.officer, { text: "Summarise it" });
      expect(r.body.drafts).toHaveLength(1);
      expect(r.body.drafts[0]).toMatchObject({
        kind: "summary",
        body: "The deal is in the agreement step and waits for legal.",
      });
    });

    test("compliance visibility: a sales officer's question about a case gets the neutral line; mlro's gets the case", async () => {
      const held = await draftDeal();
      current = new ScriptedAgentModel([() => callTool("get_compliance_case", {}), () => say("One open case.")]);
      const a = await api("POST", "/api/copilot/chat", users.officer, { text: "Show me the AML case on D-1" });
      expect(a.body.kind).toBe("guarded");
      expect(a.text).not.toMatch(/sanction|screening|\bpep\b|\bedd\b|\brisk\b/i);
      const b = await api("POST", "/api/copilot/chat", users.mlro, { text: "Show me the AML case list" });
      expect(b.body.tools).toEqual([{ name: "get_compliance_case", ok: true }]);
      expect(held.dealId).toBeTruthy();
    });

    test("the reply never carries an AML word to a non-compliance role, whatever the model says or a tool returned", async () => {
      current = new ScriptedAgentModel([() => say("This deal has a sanctions hit.")]);
      const r = await api("POST", "/api/copilot/chat", users.finance, { text: "How is the deal?" });
      expect(r.body.reply).toBe("Compliance review is open.");
      expect(r.text).not.toMatch(/sanction/i);
    });

    test("a model claim of an unverified fee is marked, not hidden", async () => {
      current = new ScriptedAgentModel([() => say("The registration fee is 7% of the price.")]);
      const r = await api("POST", "/api/copilot/chat", users.officer, { text: "What is the fee?" });
      expect(r.body).toMatchObject({ verified: false });
      expect(r.body.unverified).toContain("7%");
    });

    test("PII in a reply is masked on the way out", async () => {
      current = new ScriptedAgentModel([() => say("The passport is N1234567.")]);
      const r = await api("POST", "/api/copilot/chat", users.officer, { text: "What is the passport?" });
      expect(r.text).not.toContain("N1234567");
    });
  });

  test("the copilot adds no route that approves, sends, signs, submits, clears or edits settings", async () => {
    const text = await Bun.file(`${import.meta.dir}/../src/manager/copilot.ts`).text();
    expect(text).not.toMatch(
      /decideApproval|decideForSession|signWithLink|sendSpaMail|requestRegistration|putAmlPolicy|publishKycSettings|setHelperMode|clearDefaultFlag|approveChaseTemplate/,
    );
    // The only manager functions a proposal confirms are the four named ones.
    for (const fn of ["requestDocuments", "openTask", "resendSigningLink", "enqueuePrepare"])
      expect(text).toContain(fn);
  });
});
