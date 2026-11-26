/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { FixedClock, issueToken } from "@platform/kernel";
import { dealEvents, spaHelperSettings, spaTasks, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { setHelperMode } from "../src/manager/helper-modes.ts";
import { type DocumentStore, uploadDocument } from "../src/manager/noc.ts";
import { COMPLIANCE_WORDS } from "./reads-fixture.ts";
import { dealInDraft, RB, seedUsers, type U } from "./prepare-fixtures.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

describe.skipIf(!url)("C24: helper settings routes and the off mode (S59)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  let sent: { name: string }[] = [];
  const boss = {
    getQueue: async () => ({}),
    send: async (name: string) => (sent.push({ name }), "job"),
  };
  const ctx = (): SpaContext => ({
    database,
    clock: new FixedClock(new Date(NOW)),
    facts: failClosedFacts,
    rulebook: () => RB,
  });
  const store: DocumentStore = {
    async put(bytes, ext) {
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      return { sha256, path: `${sha256.slice(0, 2)}/${sha256}.${ext}`, bytes: bytes.byteLength };
    },
  };
  let app: ReturnType<typeof createApp>;
  const call = (path: string, as?: keyof typeof users, init: RequestInit = {}) =>
    app.request(path, {
      ...init,
      headers: {
        "content-type": "application/json",
        ...(as ? { authorization: `Bearer ${issueToken(SECRET, users[as]!.id, NOW)}` } : {}),
      },
    });
  const out = async (r: Response) => ({
    status: r.status,
    text: await r.clone().text(),
    body: (await r.json()) as any,
  });
  const put = async (body: unknown, as?: keyof typeof users) =>
    out(await call("/api/settings/helpers", as, { method: "PUT", body: JSON.stringify(body) }));
  const tasksOf = (dealId: string) => database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId));

  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    sent = [];
    app = createApp({
      database,
      jobs: { boss: boss as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      documents: store,
      rulebook: () => RB,
      models: { vision: "vision-model:1", chat: "chat-model:1", decision: "decision-model:1" },
    });
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  describe("GET and PUT /api/settings/helpers", () => {
    test("both need a session", async () => {
      expect((await call("/api/settings/helpers")).status).toBe(401);
      expect((await call("/api/settings/helpers", undefined, { method: "PUT", body: "{}" })).status).toBe(401);
    });

    test("an admin and a sales manager read it; every other role gets 403 and no AML wording", async () => {
      for (const as of ["admin", "manager"] as const) {
        const r = await out(await call("/api/settings/helpers", as));
        expect(r.status).toBe(200);
        expect(r.body.canEdit).toBe(as === "admin");
        expect(r.body.helpers).toHaveLength(7);
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
      for (const as of ["officer", "salesadmin", "legal", "finance", "compliance", "mlro"] as const) {
        const r = await out(await call("/api/settings/helpers", as));
        expect(r.status).toBe(403);
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
    });

    test("models are shown read-only from the engine's tags", async () => {
      const r = await out(await call("/api/settings/helpers", "admin"));
      const by = Object.fromEntries(r.body.helpers.map((h: any) => [h.helper, h]));
      expect([by.spa_kyc.model, by.registry.model, by.spa_prepare.model]).toEqual([
        "vision-model:1",
        "decision-model:1",
        null,
      ]);
    });

    test("an admin sets a mode: a version row and an event; a manager can't; a non-switchable helper and a model field are 422", async () => {
      const r = await put({ helper: "spa_kyc", mode: "review" }, "admin");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ helper: "spa_kyc", scope: "*", mode: "review", version: 1, changed: true });
      expect((await put({ helper: "spa_kyc", mode: "off" }, "admin")).body.version).toBe(2);
      const again = await put({ helper: "spa_kyc", mode: "off" }, "admin");
      expect(again.body).toMatchObject({ version: 2, changed: false });
      expect((await put({ helper: "spa_kyc", mode: "auto" }, "manager")).status).toBe(403);
      expect(await database.db.select().from(spaHelperSettings)).toHaveLength(2);
      expect((await put({ helper: "aml_screening", mode: "off" }, "admin")).body).toMatchObject({
        code: "not_switchable",
      });
      expect((await put({ helper: "spa_kyc", mode: "off", model: "x" }, "admin")).body).toMatchObject({
        code: "model_read_only",
      });
      const events = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "HELPER_MODE_SET"));
      expect(events).toHaveLength(2);
      const get = await out(await call("/api/settings/helpers", "manager"));
      expect(get.body.helpers.find((h: any) => h.helper === "spa_kyc").settings[0]).toMatchObject({
        mode: "off",
        version: 2,
      });
    });
  });

  describe("off mode", () => {
    const off = (helper: string, scope?: string) =>
      setHelperMode(ctx(), users.admin!, { helper, mode: "off", ...(scope ? { scope } : {}) });
    const post = async (path: string, as: keyof typeof users = "officer") =>
      out(await call(path, as, { method: "POST", body: "{}" }));

    test("the KYC route answers 409 helper_off, queues nothing and opens one task, however often it is asked", async () => {
      const { dealId, buyerIds } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await off("spa_kyc");
      for (let i = 0; i < 2; i++) {
        const r = await post(`/api/deals/${dealId}/parties/${buyerIds[0]}/kyc/run`);
        expect([r.status, r.body.code]).toEqual([409, "helper_off"]);
        expect(r.text).not.toMatch(COMPLIANCE_WORDS);
      }
      expect(sent).toEqual([]);
      const tasks = await tasksOf(dealId);
      expect(tasks).toHaveLength(1);
      expect([tasks[0]!.kind, tasks[0]!.role, tasks[0]!.status]).toEqual(["helper_off", "sales_officer", "open"]);
      expect(tasks[0]!.title).not.toMatch(COMPLIANCE_WORDS);
      expect(JSON.stringify(tasks[0]!.detail)).not.toMatch(/@|passport/i);
    });

    test("the company, ownership and prepare routes are the same; a helper still on keeps queueing", async () => {
      const primary = await dealInDraft(ctx(), database, { type: "primary_offplan", unitNo: "A-1" });
      const resale = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await off("spa_company_check");
      await off("spa_ownership_check");
      await off("spa_prepare");
      const c = await post(`/api/deals/${primary.dealId}/parties/${primary.sellerIds[0]}/company-check/run`);
      expect([c.status, c.body.code]).toEqual([409, "helper_off"]);
      const o = await post(`/api/deals/${resale.dealId}/ownership-check/run`);
      expect([o.status, o.body.code]).toEqual([409, "helper_off"]);
      const p = await post(`/api/deals/${primary.dealId}/prepare`);
      expect([p.status, p.body.code]).toEqual([409, "helper_off"]);
      expect(sent).toEqual([]);
      expect((await tasksOf(primary.dealId)).map((t) => t.kind)).toEqual(["helper_off", "helper_off"]);
      expect((await tasksOf(resale.dealId)).map((t) => t.kind)).toEqual(["helper_off"]);
      // KYC was not switched: its route still queues.
      const k = await post(`/api/deals/${resale.dealId}/parties/${resale.buyerIds[0]}/kyc/run`);
      expect(k.status).toBe(202);
      expect(sent).toHaveLength(1);
    });

    test("the document reader is off per kind: a NOC read is refused, a title deed read still queues", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
      const noc = await uploadDocument(
        ctx(),
        store,
        dealId,
        { kind: "noc", fileName: "n.png", bytes: png },
        users.officer!,
      );
      const deed = await uploadDocument(
        ctx(),
        store,
        dealId,
        { kind: "title_deed", fileName: "d.png", bytes: png },
        users.officer!,
      );
      await off("spa_document_reader", "noc");
      const r = await post(`/api/documents/${noc.id}/read`);
      expect([r.status, r.body.code]).toEqual([409, "helper_off"]);
      expect(sent).toEqual([]);
      expect((await post(`/api/documents/${deed.id}/read`)).status).toBe(202);
      expect(sent).toHaveLength(1);
      expect((await tasksOf(dealId)).map((t) => t.kind)).toEqual(["helper_off"]);
    });

    test("turning a helper back on queues again, and the open task stays for the agent to finish", async () => {
      const { dealId, buyerIds } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await off("spa_kyc");
      await post(`/api/deals/${dealId}/parties/${buyerIds[0]}/kyc/run`);
      await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "auto" });
      const r = await post(`/api/deals/${dealId}/parties/${buyerIds[0]}/kyc/run`);
      expect(r.status).toBe(202);
      expect((await tasksOf(dealId)).map((t) => t.status)).toEqual(["open"]);
    });
  });
});
