import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type CalendarDate, newId } from "@leasing/core";
import { applications, type Database, leaseEvents, leases, parties, unitPhotos, units } from "@leasing/db";
import { beforeEach, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { APPLICATION_MAIL_JOB, sendApplicationMail } from "../src/manager/applications.ts";
import { freshDatabase, noDb, testContext } from "./harness.ts";

const SECRET = "test-secret";
const CHANNEL_SECRET = "p".repeat(40);
let database: Database;
let app: ReturnType<typeof createApi>;
let t: ReturnType<typeof testContext>;
let store: LocalDiskStore;
let landlord: string;
let listed: string;

const get = (path: string, opts: { auth?: string | null; ip?: string; instance?: ReturnType<typeof createApi> } = {}) =>
  (opts.instance ?? app).request(path, {
    headers: {
      ...(opts.auth === null ? {} : { authorization: `Bearer ${opts.auth ?? CHANNEL_SECRET}` }),
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
    },
  });
const post = (body: unknown, opts: { auth?: string | null; ip?: string } = {}) =>
  app.request("/public/enquiries", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(opts.auth === null ? {} : { authorization: `Bearer ${opts.auth ?? CHANNEL_SECRET}` }),
      ...(opts.ip ? { "x-forwarded-for": opts.ip } : {}),
    },
    body: JSON.stringify(body),
  });

async function addUnit(over: Partial<typeof units.$inferInsert> = {}) {
  const id = newId();
  await database.db.insert(units).values({
    id,
    code: `U-${id.slice(-6)}`,
    building: "Demo Residence",
    community: "Jumeirah Village Circle",
    bedrooms: 1,
    state: "LISTED",
    askingRentFils: 7_400_000,
    landlordPartyId: landlord,
    ...over,
  });
  return id;
}

const slotsOf = async (id: string) => (await (await get(`/public/units/${id}/slots`)).json()) as { at: string }[];
const enquiry = (unitId: string, slot: string, over: Record<string, unknown> = {}) => ({
  unitId,
  name: "Sara Test",
  email: "Sara@Example.com",
  slot,
  ...over,
});

describe.skipIf(noDb)("public listings and enquiry routes", () => {
  beforeEach(async () => {
    database = await freshDatabase();
    t = testContext(database, "2026-11-02T04:00:00Z");
    landlord = newId();
    await database.db.insert(parties).values({ id: landlord, kind: "company", fullNameEn: "Fictional Holdings LLC" });
    listed = await addUnit({
      description: "  Bright one bed.  ",
      virtualTourUrl: "https://tour.example/1",
      floor: 7,
      parkingSpaces: 1,
      bathrooms: 2,
      areaSqft: 800,
    });
    store = new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-")));
    app = createApi(t.ctx, { sessionSecret: SECRET, channelSecret: CHANNEL_SECRET, mediaStore: store });
  });

  test("the channel secret is required (401), and the routes are off without one (503)", async () => {
    for (const path of ["/public/units", `/public/units/${listed}`, `/public/units/${listed}/slots`]) {
      expect((await get(path, { auth: null })).status).toBe(401);
      expect((await get(path, { auth: "wrong" })).status).toBe(401);
    }
    expect((await post(enquiry(listed, "2026-11-03T06:00:00Z"), { auth: null })).status).toBe(401);
    const off = createApi(testContext(database, "2026-11-02T04:00:00Z").ctx, {
      sessionSecret: SECRET,
      mediaStore: store,
    });
    expect((await get("/public/units", { instance: off })).status).toBe(503);
  });

  test("only bookable units are listed; rent is formatted; no landlord or internal fields", async () => {
    const prep = await addUnit({ state: "PREP" });
    const unsettled = await addUnit({ askingRentFils: 99_000_000 }); // far outside the company range, no approval
    const noPrice = await addUnit({ askingRentFils: null });
    const contracted = await addUnit();
    await database.db.insert(leases).values({
      id: newId(),
      unitId: contracted,
      ref: "L-9999",
      state: "CONTRACT",
      startOn: "2026-12-01" as CalendarDate,
      endOn: "2027-11-30" as CalendarDate,
      annualRentFils: 7_400_000,
      cheques: 4,
      depositFils: 370_000,
      rulesVersion: t.ctx.rulesVersion,
    });
    const res = await get("/public/units");
    expect(res.status).toBe(200);
    const list = (await res.json()) as Record<string, unknown>[];
    const ids = list.map((u) => u.id);
    expect(ids).toContain(listed);
    for (const hidden of [prep, unsettled, noPrice, contracted]) expect(ids).not.toContain(hidden);
    const u = list.find((x) => x.id === listed)!;
    expect(u.rent).toBe("AED 74,000.00");
    expect(u.rentFils).toBe(7_400_000);
    expect(u.description).toBe("Bright one bed.");
    expect(JSON.stringify(u)).not.toMatch(/landlord|Fictional/i);
    expect((await get(`/public/units/${prep}`)).status).toBe(404);
    expect((await get(`/public/units/${contracted}/slots`)).status).toBe(404);
    expect((await get("/public/units/not-a-uuid")).status).toBe(404);
  });

  test("unit detail has the extra facts; photos serve only for that bookable unit", async () => {
    const photo = async (unitId: string, bytes: string) => {
      const saved = await store.put(Buffer.from(bytes), "jpg");
      const id = newId();
      await database.db.insert(unitPhotos).values({
        id,
        unitId,
        sha256: saved.sha256,
        path: saved.path,
        mime: "image/jpeg",
        bytes: bytes.length,
        uploadedBy: "test",
      });
      return id;
    };
    const mine = await photo(listed, "mine");
    const other = await addUnit();
    const theirs = await photo(other, "theirs");
    const prep = await addUnit({ state: "PREP" });
    const prepPhoto = await photo(prep, "prep");

    const d = (await (await get(`/public/units/${listed}`)).json()) as Record<string, unknown>;
    expect(d.floor).toBe(7);
    expect(d.parkingSpaces).toBe(1);
    expect(d.virtualTourUrl).toBe("https://tour.example/1");
    expect(d.photoUrls).toEqual([`/public/units/${listed}/photos/${mine}`]);

    const ok = await get(`/public/units/${listed}/photos/${mine}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/jpeg");
    expect(await ok.text()).toBe("mine");
    expect((await get(`/public/units/${listed}/photos/${theirs}`)).status).toBe(404);
    expect((await get(`/public/units/${prep}/photos/${prepPhoto}`)).status).toBe(404);

    // The row exists but the file is gone from the store: 404, not 500.
    const lost = await photo(listed, "lost");
    const [row] = await database.db.select().from(unitPhotos).where(eq(unitPhotos.id, lost));
    await database.db.update(unitPhotos).set({ path: "missing/nope.jpg" }).where(eq(unitPhotos.id, row!.id));
    const gone404 = await get(`/public/units/${listed}/photos/${lost}`);
    expect(gone404.status).toBe(404);
    expect(((await gone404.json()) as { code: string }).code).toBe("not_found");

    await database.db.update(units).set({ virtualTourUrl: "http://insecure.example" }).where(eq(units.id, listed));
    expect(
      ((await (await get(`/public/units/${listed}`)).json()) as { virtualTourUrl: unknown }).virtualTourUrl,
    ).toBeNull();
  });

  test("slots are listed in Dubai time", async () => {
    const slots = (await (await get(`/public/units/${listed}/slots`)).json()) as { at: string; label: string }[];
    expect(slots.length).toBeGreaterThan(0);
    expect(new Date(slots[0]!.at).getTime()).toBeGreaterThan(t.clock.now().getTime());
    expect(slots[0]!.label).toMatch(/\d/);
  });

  test("an enquiry books the viewing, creates the application (web_form) and emails the invitation", async () => {
    const [slot] = await slotsOf(listed);
    const visitorId = newId();
    const res = await post(enquiry(listed, slot!.at, { phone: "050 123 4567", visitorId }));
    expect(res.status).toBe(201);
    const { ref } = (await res.json()) as { ref: string };
    expect(ref).toBeTruthy();
    const [a] = await database.db.select().from(applications).where(eq(applications.unitId, listed));
    expect(a!.source).toBe("web_form");
    expect(a!.state).toBe("VIEWING");
    expect(a!.ref).toBe(ref);
    expect(a!.viewingAt!.toISOString()).toBe(new Date(slot!.at).toISOString());
    const [p] = await database.db.select().from(parties).where(eq(parties.id, a!.partyId));
    expect(p!.email).toBe("sara@example.com");
    expect(p!.phone).toBe("+971501234567");
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, a!.id));
    expect(events.find((e) => e.type === "APPLICATION_CREATED")!.actor).toBe(`enquirer:web-form:${visitorId}`);
    const job = t.scheduler.jobs.find((j) => j.name === APPLICATION_MAIL_JOB)!;
    expect(job).toBeTruthy();
    await sendApplicationMail(t.ctx, String(job.data.applicationId), job.data.kind as never, Number(job.data.seq));
    expect(t.mailer.sent.at(-1)!.to).toBe("sara@example.com");
    // The taken slot is no longer offered.
    expect((await slotsOf(listed)).map((s) => s.at)).not.toContain(slot!.at);
  });

  test("without a visitorId the actor carries a fresh uuid", async () => {
    const [slot] = await slotsOf(listed);
    expect((await post(enquiry(listed, slot!.at))).status).toBe(201);
    const [a] = await database.db.select().from(applications).where(eq(applications.unitId, listed));
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, a!.id));
    expect(events.find((e) => e.type === "APPLICATION_CREATED")!.actor).toMatch(
      /^enquirer:web-form:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });

  test("a taken slot, a unit that is gone, a duplicate and a bad body are refused", async () => {
    const [s1, s2] = await slotsOf(listed);
    expect((await post(enquiry(listed, s1!.at))).status).toBe(201);
    const taken = await post(enquiry(listed, s1!.at, { email: "other@example.com" }));
    expect(taken.status).toBe(409);
    expect(((await taken.json()) as { code: string }).code).toBe("viewing_slot_taken");

    const dup = await post(enquiry(listed, s2!.at));
    expect(dup.status).toBe(409);
    expect(((await dup.json()) as { code: string }).code).toBe("already_enquired");

    const gone = await addUnit({ state: "PREP" });
    const g = await post(enquiry(gone, s2!.at, { email: "third@example.com" }));
    expect(g.status).toBe(409);
    expect(((await g.json()) as { code: string }).code).toBe("unit_not_bookable");

    // A time that is not one of the offered slots.
    const off = await post(enquiry(listed, "2026-11-03T06:07:00Z", { email: "x@example.com" }));
    expect(off.status).toBe(409);
    const offBody = (await off.json()) as { code: string; error: string };
    expect(offBody.code).toBe("viewing_slot_unavailable");
    expect(offBody.error).toBe("That time isn't available. Pick another.");
    const past = await post(enquiry(listed, "2020-01-01T06:00:00Z", { email: "x@example.com" }));
    expect(((await past.json()) as { code: string }).code).toBe("viewing_slot_unavailable");
    expect((await post(enquiry(listed, s2!.at, { name: "S" }))).status).toBe(400);
    expect((await post(enquiry(listed, s2!.at, { email: "nope" }))).status).toBe(400);
    expect((await post(enquiry(listed, s2!.at, { phone: "abc" }))).status).toBe(400);
  });

  test("two enquiries racing for the same slot: one 201, one 409", async () => {
    const [s] = await slotsOf(listed);
    const res = await Promise.all([
      post(enquiry(listed, s!.at, { email: "a@example.com" })),
      post(enquiry(listed, s!.at, { email: "b@example.com" })),
    ]);
    expect(res.map((r) => r.status).toSorted()).toEqual([201, 409]);
    const loser = res.find((r) => r.status === 409)!;
    expect(((await loser.json()) as { code: string }).code).toBe("viewing_slot_taken");
  });

  test("one email holds at most 3 open web-form applications", async () => {
    const ids = [listed, await addUnit(), await addUnit(), await addUnit()];
    for (const id of ids.slice(0, 3)) {
      const [s] = await slotsOf(id);
      expect((await post(enquiry(id, s!.at))).status).toBe(201);
    }
    const [s] = await slotsOf(ids[3]!);
    const res = await post(enquiry(ids[3]!, s!.at));
    expect(res.status).toBe(429);
    expect(((await res.json()) as { code: string }).code).toBe("too_many_enquiries");
    expect((await post(enquiry(ids[3]!, s!.at, { email: "someone-else@example.com" }))).status).toBe(201);
  });

  test("a call with no forwarded address is still limited (shared bucket)", async () => {
    const [s] = await slotsOf(listed);
    for (let i = 0; i < 10; i++) expect((await post(enquiry(listed, s!.at, { name: "x" }))).status).toBe(400);
    expect((await post(enquiry(listed, s!.at))).status).toBe(429);
  });

  test("the enquiry route is limited per IP (10 an hour)", async () => {
    const [s] = await slotsOf(listed);
    for (let i = 0; i < 10; i++) {
      const r = await post(enquiry(listed, s!.at, { name: "x" }), { ip: "203.0.113.9, 10.0.0.1" }); // 400s still count
      expect(r.status).toBe(400);
    }
    expect((await post(enquiry(listed, s!.at), { ip: "203.0.113.9" })).status).toBe(429);
    expect((await post(enquiry(listed, s!.at, { name: "x" }), { ip: "203.0.113.10" })).status).toBe(400);
  });
});
