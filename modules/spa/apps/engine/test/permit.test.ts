import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { dealEvents, listings, type SpaDatabase, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  createListing,
  expirePermits,
  listingStep,
  recordListingSignature,
  recordOwnership,
} from "../src/manager/listings.ts";
import { createParty } from "../src/manager/parties.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const clock = new FixedClock(new Date("2026-11-18T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
const actor = "user:00000000-0000-7000-8000-0000000000aa" as const;

async function published(permitExpiresOn: string, publish = true) {
  const id = newId();
  const agent = {
    id,
    email: `agent-${id.slice(-6)}@spa-demo.test`,
    name: "Rania Agent",
    role: "sales_officer" as const,
  };
  await database.db.insert(spaUsers).values(agent);
  const owner = await createParty(
    ctx(),
    {
      kind: "person",
      fullNameEn: "Hidden Owner Name",
      nationality: "Testland",
      email: "owner@example.test",
      passportNo: "X0000001",
    },
    actor,
  );
  const l = await createListing(
    ctx(),
    {
      title: "2-bed apartment, Marina Vista",
      community: "Dubai Marina",
      bedrooms: 2,
      sizeSqft: 1180,
      propertyDescription: "Bright corner unit.",
      askingPriceFils: 185_000_000,
      permitNo: "[PERMIT NO.]",
      permitIssuedOn: "2026-06-01",
      permitExpiresOn,
      agentUserId: agent.id,
      sellers: [{ role: "seller", partyId: owner.id, order: 1, shareBps: 10_000 }],
    },
    actor,
  );
  await recordOwnership(
    ctx(),
    l.id,
    { kind: "title_deed", ref: "TD-SECRET-123", ownersAsOnDocument: ["Hidden Owner Name"] },
    actor,
  );
  await recordListingSignature(ctx(), l.id, owner.id, actor);
  await listingStep(ctx(), l.id, "VERIFY", { actor });
  await listingStep(ctx(), l.id, "ACTIVATE", { actor });
  if (publish) await listingStep(ctx(), l.id, "PUBLISH", { actor });
  return l;
}
const stateOf = async (id: string) => (await database.db.select().from(listings).where(eq(listings.id, id)))[0]!.state;

describe.skipIf(!url)("permit sweep and public page (C6)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-18T06:00:00Z"));
    await database?.close();
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("a permit's last valid day is today: stays published today, goes tomorrow, once", async () => {
    const l = await published("2026-11-18");
    expect((await expirePermits(ctx())).unpublished).toEqual([]);
    expect(await stateOf(l.id)).toBe("PUBLISHED");
    clock.advanceDays(1);
    expect((await expirePermits(ctx())).unpublished).toEqual([l.id]);
    expect((await expirePermits(ctx())).unpublished).toEqual([]);
    expect(await stateOf(l.id)).toBe("ACTIVE");
    const evs = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, l.id));
    expect(evs.filter((e) => e.type === "UNPUBLISH").map((e) => e.actor)).toEqual(["system:permit-expire"]);
  });

  test("an active (unpublished) listing with an expired permit is left alone", async () => {
    const l = await published("2026-11-30", false);
    clock.advanceDays(30);
    expect((await expirePermits(ctx())).unpublished).toEqual([]);
    expect(await stateOf(l.id)).toBe("ACTIVE");
  });

  test("the public page shows only safe fields, and only for published listings", async () => {
    const app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: "s".repeat(40),
      demoMode: false,
      nowMs: () => 0,
    });
    const l = await published("2027-05-01");
    const r = await app.request(`/public/listings/${l.ref}`);
    expect(r.status).toBe(200);
    const body = (await r.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual(
      [
        "agent",
        "askingPriceFils",
        "bedrooms",
        "community",
        "description",
        "permitNo",
        "ref",
        "sizeSqft",
        "title",
      ].toSorted(),
    );
    expect((body.agent as { name: string }).name).toBe("Rania Agent");
    const text = JSON.stringify(body);
    expect(text).not.toContain("Hidden Owner Name");
    expect(text).not.toContain("TD-SECRET-123");
    const active = await published("2027-05-01", false);
    expect((await app.request(`/public/listings/${active.ref}`)).status).toBe(404);
    expect((await app.request("/public/listings/L-9999")).status).toBe(404);
  });

  test("review #3: a published listing whose permit has lapsed is not public, even before the sweep", async () => {
    const appAt = (date: string) =>
      createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: {
          now: () => new Date(`${date}T06:00:00Z`),
          today: () => date,
          offsetDays: 0,
          refresh: async () => {},
        } as never,
        sessionSecret: "s".repeat(40),
        demoMode: false,
        nowMs: () => 0,
      });
    const l = await published("2026-11-18");
    expect((await appAt("2026-11-18").request(`/public/listings/${l.ref}`)).status).toBe(200);
    expect((await appAt("2026-11-19").request(`/public/listings/${l.ref}`)).status).toBe(404);
  });
});
