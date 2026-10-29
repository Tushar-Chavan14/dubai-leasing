import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { newId } from "@leasing/core";
import { conversations, type Database, parties, units } from "@leasing/db";
import { FakeLlm, type SystemOneResponse } from "@leasing/llm";
import { beforeEach, describe, expect, test } from "bun:test";
import { createApi } from "../src/api/app.ts";
import { freshDatabase, noDb, testContext, testCompany } from "./harness.ts";

const SECRET = "test-secret";
const CHANNEL_SECRET = "w".repeat(40);
let database: Database;
let app: ReturnType<typeof createApi>;

const none = (): SystemOneResponse => ({
  model: "tev1:test",
  answers: {
    intent: { type: "choice", choice: "none", confidence: 0.9, probabilities: {} },
    language: { type: "choice", choice: "en", confidence: 0.99, probabilities: {} },
    bedrooms: { type: "choice", choice: "none", confidence: 0.9, probabilities: {} },
    community: { type: "choice", choice: "none", confidence: 0.9, probabilities: {} },
    commercial: { type: "noul", noul: 0.02 },
    vip: { type: "noul", noul: 0.02 },
    complaint: { type: "noul", noul: 0.02 },
    system_instruction: { type: "noul", noul: 0.02 },
  },
});

const call = (
  path: string,
  body: unknown,
  opts: { auth?: string | null; ip?: string; instance?: ReturnType<typeof createApi> } = {},
) =>
  (opts.instance ?? app).request(path, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.auth === null ? {} : { authorization: `Bearer ${opts.auth ?? CHANNEL_SECRET}` }),
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
    },
    body: JSON.stringify(body),
  });

const webUpdate = (visitorId: string, over: Record<string, unknown> = {}) => ({
  channel: "web",
  kind: "text",
  text: "sara@example.com",
  updateId: newId(),
  chatId: visitorId,
  from: { id: visitorId },
  ...over,
});

describe.skipIf(noDb)("web channel relay routes", () => {
  beforeEach(async () => {
    database = await freshDatabase();
    const t = testContext(database, "2026-11-02T04:00:00Z", { llm: new FakeLlm(none) });
    const landlord = newId();
    await database.db.insert(parties).values({ id: landlord, kind: "company", fullNameEn: "Fictional Holdings LLC" });
    await database.db.insert(units).values({
      companyId: await testCompany(database),
      id: newId(),
      code: "JVC-0412",
      building: "Demo Residence",
      community: "Jumeirah Village Circle",
      bedrooms: 1,
      state: "LISTED",
      askingRentFils: 7_400_000,
      landlordPartyId: landlord,
    });
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      channelSecret: CHANNEL_SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
  });

  test("the channel secret is required on both web routes", async () => {
    const v = newId();
    for (const path of ["/channel/web/updates", "/channel/web/history"]) {
      expect((await call(path, webUpdate(v), { auth: null })).status).toBe(401);
      expect((await call(path, webUpdate(v), { auth: "wrong" })).status).toBe(401);
    }
    const off = createApi(testContext(database, "2026-11-02T04:00:00Z").ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    expect((await call("/channel/web/updates", webUpdate(v), { instance: off })).status).toBe(503);
    expect((await call("/channel/web/history", { visitorId: v }, { instance: off })).status).toBe(503);
  });

  test("the web route refuses Telegram updates and a chat id that is not the sender", async () => {
    const v = newId();
    const tg = { channel: "telegram", kind: "text", text: "hi", updateId: "1", chatId: "5", from: { id: "5" } };
    expect((await call("/channel/web/updates", tg)).status).toBe(400);
    expect((await call("/channel/web/updates", webUpdate(v, { from: { id: newId() } }))).status).toBe(400);
    expect((await call("/channel/web/updates", webUpdate("not-a-uuid", { from: { id: "not-a-uuid" } }))).status).toBe(
      400,
    );
  });

  test("a visitor chats; history is only their own; the same message id in two visitors is separate", async () => {
    const a = newId();
    const b = newId();
    const shared = newId();
    const ra = await call("/channel/web/updates", webUpdate(a, { updateId: shared }));
    expect(ra.status).toBe(200);
    const ba = (await ra.json()) as { reply: { text: string; buttons: { data: string }[] } };
    expect(ba.reply.buttons.map((b) => b.data)).toEqual(["contact:skip"]);
    const rb = await call("/channel/web/updates", webUpdate(b, { updateId: shared, text: "omar@example.com" }));
    expect(rb.status).toBe(200);
    const convs = await database.db.select().from(conversations);
    expect(convs.map((c) => c.externalChatId).toSorted()).toEqual([a, b].toSorted());
    expect(convs.find((c) => c.externalChatId === a)!.contactEmail).toBe("sara@example.com");
    expect(convs.find((c) => c.externalChatId === b)!.contactEmail).toBe("omar@example.com");

    const hist = async (visitorId: string, extra: object = {}) =>
      (await (await call("/channel/web/history", { visitorId, ...extra })).json()) as {
        direction: string;
        body: string;
      }[];
    const ha = await hist(a);
    expect(ha.map((m) => m.direction)).toEqual(["in", "out"]);
    expect(JSON.stringify(ha)).not.toContain("omar@");
    expect(await hist(newId())).toEqual([]);
    expect(await hist(a, { after: "2030-01-01T00:00:00Z" })).toEqual([]);
    expect((await call("/channel/web/history", { visitorId: "nope" })).status).toBe(400);
    // A redelivered message returns the stored reply.
    const again = await call("/channel/web/updates", webUpdate(a, { updateId: shared }));
    expect(((await again.json()) as { reply: unknown }).reply).toEqual(ba.reply);
  });

  test("the per-IP limit answers 429 once the hour's budget is spent; other addresses are unaffected", async () => {
    const bad = { channel: "web" }; // refused as invalid, but still counted
    let last = 0;
    for (let i = 0; i < 201; i++) last = (await call("/channel/web/updates", bad, { ip: "9.9.9.9, 10.0.0.1" })).status;
    expect(last).toBe(429);
    expect((await call("/channel/web/updates", bad, { ip: "8.8.8.8" })).status).not.toBe(429);
  });
});
