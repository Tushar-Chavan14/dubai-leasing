import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Emirate } from "@leasing/core";
import { type Database, leaseEvents } from "@leasing/db";
import { eq } from "drizzle-orm";
import {
  activeRulesVersion,
  baseRulebooks,
  getRulebook,
  hasRulebookFor,
  registerRulebook,
  resetRulebookRegistry,
  rulebookFromRow,
  rulebookValues,
} from "@leasing/rulebook";
import { calendarDate as d } from "@leasing/core";
import { DEMO_EMIRATE_RULEBOOKS, isDemoEmirateVersion, seedEmirateRulebooks } from "../src/demo/emirate-rulebooks.ts";
import { baseFor, createDraft, publishRulebook, syncRulebooks, updateDraft } from "../src/manager/rulebooks.ts";
import { freshDatabase, noDb, testContext } from "./harness.ts";

const START = "2026-10-19T04:00:00Z";
const ALL: Emirate[] = ["dubai", "abu_dhabi", "sharjah", "ajman", "ras_al_khaimah", "fujairah", "umm_al_quwain"];

describe("demo emirate rulebooks", () => {
  test("every entry parses and cites general data", () => {
    expect(DEMO_EMIRATE_RULEBOOKS).toHaveLength(6);
    for (const r of DEMO_EMIRATE_RULEBOOKS) {
      const rb = rulebookFromRow({
        ...r,
        referenceRules: [],
      } as never);
      expect(rb.version).toBe(r.version);
      for (const s of rb.sources) expect(s.startsWith("From the general data available:")).toBe(true);
    }
  });
});

describe.skipIf(noDb)("demo emirate rulebooks (Postgres)", () => {
  let database: Database;
  beforeAll(async () => {
    database = await freshDatabase();
    await seedEmirateRulebooks(database);
    await syncRulebooks(database);
  });
  afterAll(async () => {
    // Back to the code versions only, so other files are unaffected.
    await syncRulebooks(await freshDatabase());
  });

  test("registered and active for all seven emirates", () => {
    for (const e of ALL) expect(hasRulebookFor(d("2026-10-19"), e)).toBe(true);
    expect(activeRulesVersion(d("2026-10-19"), "sharjah")).toBe("sharjah-2025-01");
  });

  test("baseFor falls back to the earliest published version", () => {
    expect(baseFor("sharjah").version).toBe("sharjah-2025-01");
    expect(baseFor("dubai").version).toBe("dubai-2025-01");
  });

  test("a non-demo published version without a code base never becomes a base", async () => {
    expect(isDemoEmirateVersion("abu_dhabi-2026-06")).toBe(true);
    const demo = getRulebook("fujairah-2025-01");
    resetRulebookRegistry();
    for (const b of baseRulebooks) registerRulebook(b);
    registerRulebook({ ...demo, version: "fujairah-2030-01" });
    expect(() => baseFor("fujairah")).toThrow("no base rulebook for fujairah");
    registerRulebook(demo);
    expect(baseFor("fujairah").version).toBe("fujairah-2025-01");
    await syncRulebooks(database);
  });

  test("seeding twice is a no-op", async () => {
    await seedEmirateRulebooks(database);
    await syncRulebooks(database);
    expect(baseFor("abu_dhabi").version).toBe("abu_dhabi-2026-06");
  });

  test("a draft from sharjah-2025-01 can be edited and published", async () => {
    const { ctx } = testContext(database, START);
    const draft = await createDraft(ctx, "sharjah-2025-01", "user:admin-test");
    expect(draft.version).toBe("sharjah-2026-10-01");
    const values = { ...rulebookValues(getRulebook("sharjah-2025-01")), renewalNoticeDays: 95 };
    await updateDraft(ctx, draft.version, { values }, "user:admin-test");
    await publishRulebook(ctx, draft.version, {}, "user:admin-test");
    expect(getRulebook(draft.version).renewalNoticeDays).toBe(95);
    expect(activeRulesVersion(d("2026-10-19"), "sharjah")).toBe(draft.version);
  });

  test("a copy from another emirate needs a confirmed legal review even when no value is looser", async () => {
    const { ctx } = testContext(database, START);
    const draft = await createDraft(ctx, "dubai-2025-01", "user:admin-test", "ajman");
    expect(draft.emirate).toBe("ajman");
    await expect(publishRulebook(ctx, draft.version, {}, "user:admin-test")).rejects.toMatchObject({
      code: "legal_review_required",
    });
    const { loosened } = await publishRulebook(ctx, draft.version, { confirmLegalReview: true }, "user:admin-test");
    expect(loosened[0]?.field).toBe("Values copied from Dubai (dubai-2025-01)");
  });
});

describe.skipIf(noDb)("a first rulebook for an emirate with none (Postgres)", () => {
  let database: Database;
  beforeAll(async () => {
    database = await freshDatabase();
    await syncRulebooks(database);
  });
  afterAll(async () => {
    await syncRulebooks(await freshDatabase());
  });

  test("copied from Dubai, it is Ajman's own draft and publishing needs a confirmed legal review", async () => {
    const { ctx } = testContext(database, START);
    expect(hasRulebookFor(d("2026-10-19"), "ajman")).toBe(false);
    const draft = await createDraft(ctx, "dubai-2025-01", "user:admin-test", "ajman");
    expect(draft).toMatchObject({ version: "ajman-2026-10-01", emirate: "ajman", basedOn: "dubai-2025-01" });
    expect(activeRulesVersion(d("2026-10-19"), "dubai")).toBe("dubai-2025-01");
    await expect(publishRulebook(ctx, draft.version, {}, "user:admin-test")).rejects.toMatchObject({
      code: "legal_review_required",
    });
    expect(hasRulebookFor(d("2026-10-19"), "ajman")).toBe(false);
    await publishRulebook(ctx, draft.version, { confirmLegalReview: true }, "user:admin-test");
    expect(activeRulesVersion(d("2026-10-19"), "ajman")).toBe(draft.version);
    // Dubai's active version is untouched.
    expect(activeRulesVersion(d("2026-10-19"), "dubai")).toBe("dubai-2025-01");
  });

  test("edits and creation are audited with the emirate and the review reason", async () => {
    const { ctx } = testContext(database, START);
    const draft = await createDraft(ctx, "dubai-2025-01", "user:admin-test", "fujairah");
    const values = { ...rulebookValues(getRulebook("dubai-2025-01")), renewalNoticeDays: 95 };
    await updateDraft(ctx, draft.version, { values }, "user:admin-test");
    const evs = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, draft.id));
    expect(evs.find((e) => e.type === "RULEBOOK_DRAFT_CREATED")?.payload).toMatchObject({ emirate: "fujairah" });
    const upd = evs.find((e) => e.type === "RULEBOOK_DRAFT_UPDATED")?.payload as { loosened: { field: string }[] };
    expect(upd.loosened[0]?.field).toContain("First rulebook for Fujairah");
  });

  test("without an emirate the draft keeps its source's emirate", async () => {
    const { ctx } = testContext(database, START);
    const draft = await createDraft(ctx, "dubai-2025-01", "user:admin-test");
    expect(draft.emirate).toBe("dubai");
  });
});
