/* oxlint-disable no-explicit-any -- rows read loosely in tests */
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY } from "@spa/core";
import {
  dealEvents,
  deals,
  documents,
  parties,
  retentionReviewItems,
  retentionReviews,
  screenings,
  type SpaDatabase,
  spaApprovals,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq, sql } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { publishPolicy } from "../src/manager/policy.ts";
import { approveRetentionReview, listRetentionReviews, runRetentionReview } from "../src/manager/retention.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
const NOV = new Date("2026-11-19T06:00:00Z");

describe.skipIf(!url)("retention review (C23, S29, S62): a list and an approval, no deletion", () => {
  let database: SpaDatabase;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  const clock = new FixedClock(NOV);
  const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts });
  const d: Record<string, string> = {};
  const refs: Record<string, string> = {};
  const files = () => {
    const out: string[] = [];
    const walk = (p: string) =>
      readdirSync(p, { withFileTypes: true }).forEach((e) =>
        e.isDirectory() ? walk(join(p, e.name)) : out.push(e.name),
      );
    walk(dir);
    return out.length;
  };
  const counts = async () => {
    const n = async (t: string) =>
      Number(((await database.db.execute(sql.raw(`select count(*)::int as n from ${t}`))) as any).rows[0].n);
    return {
      deals: await n("deals"),
      documents: await n("documents"),
      parties: await n("parties"),
      approvals: await n("spa_approvals"),
      screenings: await n("screenings"),
      files: files(),
    };
  };
  const end = async (key: string, state: "COMPLETED" | "CANCELLED" | "SIGNING", at: string | null, unitNo: string) => {
    const made = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo });
    d[key] = made.dealId;
    const [row] = await database.db
      .update(deals)
      .set({ state })
      .where(eq(deals.id, made.dealId))
      .returning({ ref: deals.ref });
    refs[key] = row!.ref;
    if (at)
      await database.db.insert(dealEvents).values({
        id: newId(),
        entityKind: "deal",
        entityId: made.dealId,
        type: "MILESTONE_REACHED",
        toState: state,
        actor: "system",
        payload: {},
        at: new Date(at),
      });
  };

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    dir = mkdtempSync(join(tmpdir(), "retention-"));
    store = new LocalDiskStore(dir);
    const put = await store.put(new TextEncoder().encode("doc"), "txt");
    await end("A", "COMPLETED", "2021-11-15T08:00:00Z", "U-A");
    await end("B", "CANCELLED", "2021-11-19T08:00:00Z", "U-B"); // exactly 5 years: listed
    await end("C", "COMPLETED", "2021-11-20T08:00:00Z", "U-C"); // a day short
    await end("D", "SIGNING", null, "U-D"); // live
    await end("E", "COMPLETED", null, "U-E"); // ended, no terminal event: unknown end, never listed
    await end("F", "COMPLETED", "2021-11-19T20:30:00Z", "U-F"); // 00:30 on the 20th in Dubai: not yet
    await end("G", "COMPLETED", "2021-11-18T20:30:00Z", "U-G"); // 00:30 on the 19th in Dubai: listed
    // a deal that was live with a very old event, to be sure the age of a deal's first event never counts
    await database.db.insert(dealEvents).values({
      id: newId(),
      entityKind: "deal",
      entityId: d.D!,
      type: "MILESTONE_REACHED",
      toState: "SIGNING",
      actor: "system",
      payload: {},
      at: new Date("2019-01-01T00:00:00Z"),
    });
    await database.db.insert(documents).values({
      id: newId(),
      dealId: d.A!,
      kind: "passport",
      fileName: "p.txt",
      mime: "text/plain",
      sizeBytes: 3,
      sha256: put.sha256,
      storageKey: put.path,
      uploadedBy: "user:x",
      uploadedAt: NOV,
    });
    await database.db.insert(screenings).values({
      id: newId(),
      dealId: d.A!,
      subjectKey: "k",
      trigger: "offer",
      listVersion: "v",
      exact: false,
      matches: {},
      screenedAt: NOV,
    } as any);
    await database.db.insert(spaApprovals).values({
      id: newId(),
      gate: "kyc_review",
      entityKind: "deal",
      entityId: d.A!,
      dedupeKey: `${d.A}:k`,
      title: "t",
      proposal: {},
      approverRole: "sales_manager",
      proposedBy: "system",
      createdAt: NOV,
    });
  });
  afterAll(async () => {
    await database?.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("lists exactly the deals that ended at least the policy's years ago, never a live deal", async () => {
    const r = await runRetentionReview(ctx());
    expect(r.created).toBe(true);
    expect(r.count).toBe(3);
    const [review] = await database.db.select().from(retentionReviews);
    expect(review).toMatchObject({ period: "2026-11", status: "listed", retentionYears: 5, cutoffOn: "2021-11-19" });
    const items = await database.db.select().from(retentionReviewItems);
    expect(items.map((i) => i.dealId).toSorted()).toEqual([d.A!, d.B!, d.G!].toSorted());
    expect(items.every((i) => i.status === "listed")).toBe(true);
    const byDeal = Object.fromEntries(items.map((i) => [i.dealId, i.endedOn]));
    expect(byDeal[d.A!]).toBe("2021-11-15");
    expect(byDeal[d.B!]).toBe("2021-11-19");
    expect(byDeal[d.G!]).toBe("2021-11-19");
    for (const k of ["C", "D", "E", "F"]) expect(items.some((i) => i.dealId === d[k])).toBe(false);
    const ev = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "RETENTION_REVIEW_LISTED"));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.actor).toBe("system");
    expect((ev[0]!.payload as any).count).toBe(3);
  });

  test("running the job twice in the month makes one review", async () => {
    const again = await runRetentionReview(ctx());
    expect(again.created).toBe(false);
    expect(await database.db.select().from(retentionReviews)).toHaveLength(1);
    expect(await database.db.select().from(retentionReviewItems)).toHaveLength(3);
    expect(
      await database.db.select().from(dealEvents).where(eq(dealEvents.type, "RETENTION_REVIEW_LISTED")),
    ).toHaveLength(1);
  });

  test("a sales officer, manager, sales admin, legal, finance and admin can't read the list or approve it (403); nothing changes", async () => {
    const [review] = await database.db.select().from(retentionReviews);
    for (const who of ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const) {
      expect(((await approveRetentionReview(ctx(), review!.id, users[who]!).catch((e) => e)) as any).status).toBe(403);
      expect(((await approveRetentionReview(ctx(), newId(), users[who]!).catch((e) => e)) as any).status).toBe(403);
      expect(((await listRetentionReviews(ctx(), users[who]!).catch((e) => e)) as any).status).toBe(403);
    }
    const [after] = await database.db.select().from(retentionReviews);
    expect(after!.status).toBe("listed");
  });

  test("a compliance officer approves the list: status, who, when, and an event; nothing is deleted before or after", async () => {
    const before = await counts();
    const [review] = await database.db.select().from(retentionReviews);
    const r = await approveRetentionReview(ctx(), review!.id, users.compliance!);
    expect(r).toMatchObject({ id: review!.id, status: "approved", count: 3 });
    const [after] = await database.db.select().from(retentionReviews);
    expect(after).toMatchObject({ status: "approved", approvedBy: users.compliance!.id });
    expect(after!.approvedAt!.toISOString()).toBe(NOV.toISOString());
    expect((await database.db.select().from(retentionReviewItems)).every((i) => i.status === "approved")).toBe(true);
    const ev = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "RETENTION_REVIEW_APPROVED"));
    expect(ev).toHaveLength(1);
    expect(ev[0]!.actor).toBe(`user:${users.compliance!.id}`);
    expect(await counts()).toEqual(before);
    // the event says nothing was deleted
    expect(JSON.stringify(ev[0]!.payload)).toContain('"deleted":0');
  });

  test("an approved list can't be approved again (409); an unknown list is 404; the MLRO may approve a new one", async () => {
    const [review] = await database.db.select().from(retentionReviews);
    expect(((await approveRetentionReview(ctx(), review!.id, users.mlro!).catch((e) => e)) as any).status).toBe(409);
    expect(((await approveRetentionReview(ctx(), newId(), users.mlro!).catch((e) => e)) as any).status).toBe(404);
  });

  test("the job and the approval delete nothing: row and file counts are the same before and after", async () => {
    const before = await counts();
    clock.set(new Date("2026-11-30T01:00:00Z"));
    await runRetentionReview(ctx()); // same month: no second review
    expect(await counts()).toEqual(before);
    expect(await database.db.select().from(retentionReviews)).toHaveLength(1);
  });

  test("the years come from the published policy, and a deal already listed isn't listed again", async () => {
    await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, retentionYears: 4 }, users.admin!);
    clock.set(new Date("2026-12-02T06:00:00Z"));
    const r = await runRetentionReview(ctx());
    expect(r).toMatchObject({ created: true, count: 2 }); // C (2021-11-20) and F (2021-11-20 Dubai); A, B, G were listed in November
    const reviews = await database.db.select().from(retentionReviews).orderBy(retentionReviews.period);
    expect(reviews.map((x) => x.period)).toEqual(["2026-11", "2026-12"]);
    expect(reviews[1]).toMatchObject({ retentionYears: 4, cutoffOn: "2022-12-02" });
    const items = await database.db
      .select()
      .from(retentionReviewItems)
      .where(eq(retentionReviewItems.reviewId, reviews[1]!.id));
    expect(items.map((i) => i.dealId).toSorted()).toEqual([d.C!, d.F!].toSorted());
  });

  test("the compliance list shows each review with its deal refs and day, no names", async () => {
    const list = await listRetentionReviews(ctx(), users.mlro!);
    expect(list.map((x) => x.period)).toEqual(["2026-12", "2026-11"]);
    const dec = list[0]!;
    expect(dec.status).toBe("listed");
    expect(dec.items.map((i) => i.ref).toSorted()).toEqual([refs.C!, refs.F!].toSorted());
    expect(JSON.stringify(list)).not.toMatch(/Buyer One|Seller One/);
    expect(list[1]!.approvedBy).toBe(users.compliance!.id);
    void parties;
  });
});
