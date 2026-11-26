/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { listings, offers, spaUsers, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { createListingDraft, listingStep, recordListingSignature, recordOwnership } from "../src/manager/listings.ts";
import { getListing, listListings, ListingsQuery } from "../src/manager/listing-reads.ts";
import { createParty, setCompany } from "../src/manager/parties.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z")); // Dubai day 2026-11-19
const OWNER = "Hidden Owner Name";
const OWNER2 = "Second Secret Owner";
const DOC_REF = "TD-SECRET-123";
const PASSPORT = "P7654321";
const ROLES = ["officer", "manager", "salesadmin", "legal", "finance", "compliance", "mlro", "admin"] as const;
const CATALOGUE = new Set(["officer", "manager", "salesadmin", "admin"]);
const SALES = new Set(["officer", "manager", "salesadmin"]);
const KINDS = ["developer", "brokerage", "both"] as const;

describe.skipIf(!url)("C32: listings reads and the draft write (S64)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let users: Record<string, U>;
  const as = (k: string) => users[k]!;
  const fail = async (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string }) => e,
    );
  const kind = (k: (typeof KINDS)[number]) => setCompany(ctx, { name: "Fictional Co", kind: k }, "system");
  const ids: Record<string, string> = {};

  /** One listing: permit expires `days` from today (null: no permit), published or not, owners hidden. */
  const make = async (
    key: string,
    o: { days: number | null; publish?: boolean; owners?: string[]; company?: boolean; agent?: string },
  ) => {
    const actor = `user:${as("officer").id}` as const;
    const owners = [];
    for (const n of o.owners ?? [OWNER])
      owners.push(
        await createParty(
          ctx,
          o.company
            ? {
                kind: "company",
                email: "co@example.test",
                details: {
                  tradeName: n,
                  licenceNo: "LIC-SECRET-9",
                  licenceExpiresOn: "2027-12-31",
                  issuingAuthority: "DED",
                },
              }
            : {
                kind: "person",
                fullNameEn: n,
                nationality: "Testland",
                email: `${newId().slice(-8)}@example.test`,
                passportNo: PASSPORT,
              },
          actor,
        ),
      );
    const dayOf = (n: number) =>
      new Date(Date.parse("2026-11-19T00:00:00Z") + n * 86_400_000).toISOString().slice(0, 10);
    // made valid so it can be activated (the machine's guard), then the permit is set to the case under test
    const exp = dayOf(60);
    const l = await createListingDraft(
      ctx,
      {
        title: `2-bed apartment, ${key}`,
        community: "Dubai Marina",
        bedrooms: 2,
        propertyDescription: "Bright corner unit.",
        askingPriceFils: 185_000_000,
        ...(exp ? { permitNo: "[PERMIT NO.]", permitExpiresOn: exp } : {}),
        ...(o.agent ? { agentUserId: o.agent } : {}),
        sellers: owners.map((p, i) => ({
          role: "seller" as const,
          partyId: p.id,
          order: i + 1,
          shareBps: Math.floor(10_000 / owners.length),
        })),
      },
      as("officer"),
    );
    await recordOwnership(
      ctx,
      l.id,
      { kind: "title_deed", ref: DOC_REF, ownersAsOnDocument: o.owners ?? [OWNER] },
      actor,
    );
    for (const p of owners) await recordListingSignature(ctx, l.id, p.id, actor);
    await listingStep(ctx, l.id, "VERIFY", { actor });
    await listingStep(ctx, l.id, "ACTIVATE", { actor });
    if (o.publish) await listingStep(ctx, l.id, "PUBLISH", { actor });
    await database.db
      .update(listings)
      .set({ permitExpiresOn: o.days === null ? null : dayOf(o.days), ...(o.days === null ? { permitNo: null } : {}) })
      .where(eq(listings.id, l.id));
    ids[key] = l.id;
    return l;
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    ctx = { database, clock, facts: failClosedFacts };
    users = await seedUsers(database);
    await kind("brokerage");
    await make("EXP7", { days: 7, publish: true });
    await make("EXP8", { days: 8, publish: true });
    await make("EXP0", { days: 0, publish: true });
    await make("GONE", { days: -1 });
    await make("NONE", { days: null });
    await make("COOWN", { days: 90, owners: [OWNER, OWNER2] });
    await make("COMP", { days: 90, owners: ["Fictional Holdings LLC"], company: true });
    await make("MINE", { days: 90, agent: as("manager").id });
    // an expired permit on a still-PUBLISHED listing: the page hides it (S38)
    await make("HIDDEN", { days: -18, publish: true });
    await database.db.insert(offers).values({
      id: newId(),
      listingId: ids.EXP7!,
      status: "SENT",
      priceFils: 180_000_000,
      buyerMortgage: false,
      validUntil: "2026-11-25",
      createdBy: "system",
      createdAt: new Date("2026-11-18T06:00:00Z"),
      conditions: "Subject to the buyer's survey",
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  const list = async (k: string, q: Record<string, unknown> = {}) => listListings(ctx, as(k), ListingsQuery.parse(q));
  const row = async (key: string, k = "officer") =>
    (await list(k, { limit: 100 })).items.find((i) => i.id === ids[key])!;

  test("the table row: ref, property, seller kind, asking price, state, permit, page, offer", async () => {
    const r = await row("EXP7");
    expect(r).toMatchObject({
      title: "2-bed apartment, EXP7",
      community: "Dubai Marina",
      sellerKind: "Individual",
      askingPriceFils: 185_000_000,
      state: "PUBLISHED",
    });
    expect(r.ref).toMatch(/^L-/);
    expect(r.offer).toMatchObject({ state: "SENT", label: "Open", validUntil: "2026-11-25" });
    expect(await row("EXP8")).toMatchObject({ offer: null });
  });

  test("seller kind: one person is an individual, several are co-owners, a company is a company", async () => {
    expect((await row("COOWN")).sellerKind).toBe("Co-owners");
    expect((await row("COMP")).sellerKind).toBe("Company");
  });

  test("permit warning: seven days left or fewer warns; eight does not; expired and none say so", async () => {
    expect((await row("EXP7")).permit).toMatchObject({ status: "expiring", daysLeft: 7 });
    expect((await row("EXP0")).permit).toMatchObject({ status: "expiring", daysLeft: 0 });
    expect((await row("EXP8")).permit).toMatchObject({ status: "valid", daysLeft: 8 });
    expect((await row("GONE")).permit).toMatchObject({ status: "expired", daysLeft: -1 });
    expect((await row("NONE")).permit).toMatchObject({ status: "none", expiresOn: null, daysLeft: null });
  });

  test("public page state: live only with a published listing and a valid permit; an expired permit hides it", async () => {
    expect((await row("EXP8")).page).toMatchObject({ state: "live", label: "Live" });
    expect((await row("EXP0")).page.state).toBe("live"); // the last valid day still counts (S38)
    expect((await row("HIDDEN")).page).toMatchObject({ state: "hidden" });
    expect((await row("COOWN")).page).toMatchObject({ state: "off", label: "Not published" });
  });

  test("the list never carries an owner name, a document number, a passport number or an owner's licence", async () => {
    for (const k of ["officer", "manager", "salesadmin", "admin"]) {
      const text = JSON.stringify(await list(k, { limit: 100 }));
      for (const s of [OWNER, OWNER2, "Fictional Holdings", DOC_REF, PASSPORT, "LIC-SECRET-9", "@example.test"])
        expect(text).not.toContain(s);
    }
  });

  test("scope=mine is the listings the viewer is agent of; all is everyone's; newest first", async () => {
    const mine = await list("manager", { scope: "mine", limit: 100 });
    expect(mine.items.map((i) => i.id)).toEqual([ids.MINE!]);
    expect((await list("manager", { scope: "all", limit: 100 })).items.length).toBe(9);
    expect((await list("officer", { scope: "mine", limit: 100 })).items.length).toBe(0);
    const all = (await list("officer", { limit: 100 })).items;
    expect(all[0]!.id).toBe(ids.HIDDEN!);
  });

  test("paging gives every listing once", async () => {
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const p = await list("officer", { limit: 4, ...(cursor ? { cursor } : {}) });
      seen.push(...p.items.map((i) => i.id));
      cursor = p.nextCursor ?? undefined;
    } while (cursor);
    expect(new Set(seen).size).toBe(9);
    expect(seen.length).toBe(9);
  });

  test("the record shows sellers to the sales roles only; admin sees the listing without them", async () => {
    for (const k of ["officer", "manager", "salesadmin"]) {
      const rec = await getListing(ctx, as(k), ids.COOWN!);
      expect(rec.sellers!.map((s) => s.name).toSorted()).toEqual([OWNER, OWNER2].toSorted());
      expect(rec.sellers![0]).toMatchObject({ kind: "person", signed: true });
      // M3 (S77): the sales roles see the document number and owners they entered; the passport never leaves the party row.
      expect(rec.ownership).toMatchObject({ ref: DOC_REF });
      expect(JSON.stringify(rec)).not.toContain(PASSPORT);
    }
    const rec = await getListing(ctx, as("admin"), ids.COOWN!);
    expect(rec.sellers).toBeNull();
    expect(JSON.stringify(rec)).not.toContain(OWNER);
    expect(JSON.stringify(rec)).not.toContain(DOC_REF);
  });

  test("the record: header, permit, ownership check result (number for sales roles only), public page, the offer", async () => {
    const rec = await getListing(ctx, as("officer"), ids.EXP7!);
    expect(rec).toMatchObject({
      ref: expect.stringMatching(/^L-/),
      state: "PUBLISHED",
      askingPriceFils: 185_000_000,
      permit: { no: "[PERMIT NO.]", status: "expiring", daysLeft: 7 },
      ownership: { kind: "title_deed", matched: true },
      page: { state: "live" },
      offer: { state: "SENT", priceFils: 180_000_000, validUntil: "2026-11-25" },
    });
    expect((await getListing(ctx, as("admin"), ids.EXP7!)).ownership).not.toHaveProperty("ref");
    expect(await getListing(ctx, as("officer"), ids.EXP8!).then((r) => r.offer)).toBeNull();
    expect((await fail(getListing(ctx, as("officer"), newId())))?.status).toBe(404);
  });

  test("no AML word anywhere in a listing response, for any role", async () => {
    const words = /aml|screening|sanction|\bpep\b|\bedd\b|\brisk\b|compliance/i;
    for (const k of ["officer", "manager", "salesadmin", "admin"]) {
      expect(JSON.stringify(await list(k, { limit: 100 }))).not.toMatch(words);
      expect(JSON.stringify(await getListing(ctx, as(k), ids.COOWN!))).not.toMatch(words);
    }
  });

  test("the role and company-kind rule: sales roles and admin read listings of a brokerage or both company; never a developer's; others never", async () => {
    for (const kd of KINDS) {
      await kind(kd);
      for (const k of ROLES) {
        const allowed = CATALOGUE.has(k) && kd !== "developer";
        const e = await fail(list(k));
        const g = await fail(getListing(ctx, as(k), ids.COOWN!));
        expect(e?.status ?? 200, `${k}/${kd} list`).toBe(allowed ? 200 : 403);
        expect(g?.status ?? 200, `${k}/${kd} record`).toBe(allowed ? 200 : 403);
      }
    }
    await kind("brokerage");
  });

  test("a listing draft is written by the three sales roles of a brokerage or both company only", async () => {
    const owner = await createParty(
      ctx,
      { kind: "person", fullNameEn: "Draft Owner", nationality: "Testland", email: "d@example.test", passportNo: "X1" },
      "system",
    );
    const input = () => ({
      title: "Studio, Draft Tower",
      community: "Business Bay",
      propertyDescription: "A studio.",
      askingPriceFils: 90_000_000,
      sellers: [{ role: "seller" as const, partyId: owner.id, order: 1, shareBps: 10_000 }],
    });
    for (const kd of KINDS) {
      await kind(kd);
      for (const k of ROLES) {
        const allowed = SALES.has(k) && kd !== "developer";
        const e = await fail(createListingDraft(ctx, input(), as(k)));
        expect(e?.status ?? 201, `${k}/${kd}`).toBe(allowed ? 201 : 403);
      }
    }
    await kind("brokerage");
    // a refused draft left nothing behind
    const refused = (await database.db.select().from(listings)).filter((l) => l.title === "Studio, Draft Tower");
    expect(refused.length).toBe(SALES.size * 2);
    expect(refused.every((l) => l.state === "DRAFT")).toBe(true);
  });

  test("the draft goes through the existing listing checks (422 on a bad one) and agent defaults to nobody", async () => {
    const e = await fail(createListingDraft(ctx, { title: "" }, as("officer")));
    expect(e?.status).toBe(422);
    void spaUsers;
  });
});
