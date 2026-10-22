import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { type Database, leaseEvents, leases, rulebooks } from "@leasing/db";
import { dubai2025_01, getRulebook, rulebookValues } from "@leasing/rulebook";
import { beforeAll, describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { issueToken } from "../src/api/auth.ts";
import { importLeasesCsv } from "../src/manager/import.ts";
import { syncRulebooks } from "../src/manager/rulebooks.ts";
import { addStaff, freshDatabase, leaseCsv, noDb, testContext } from "./harness.ts";

const SECRET = "test-secret";
const ROLES = ["leasing_officer", "leasing_manager", "finance", "admin"] as const;
type Role = (typeof ROLES)[number];

describe.skipIf(noDb)("rulebook versions (Postgres)", () => {
  let database: Database;
  let t: ReturnType<typeof testContext>;
  let app: ReturnType<typeof createApi>;
  const tokens = {} as Record<Role, string>;

  beforeAll(async () => {
    database = await freshDatabase();
    t = testContext(database, "2026-10-19T04:00:00Z");
    app = createApi(t.ctx, {
      sessionSecret: SECRET,
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    for (const role of ROLES) tokens[role] = issueToken(SECRET, (await addStaff(database, role)).id, Date.now());
  });

  const call = (role: Role, path: string, method = "GET", body?: unknown) =>
    app.request(`/api${path}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens[role]}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  const json = async <T = Record<string, unknown>>(r: Response | Promise<Response>) => (await (await r).json()) as T;
  const base = () => rulebookValues(dubai2025_01);
  // Leases are pinned to the version in force on their start date (D23). Default: a lease that
  // starts after every version in these tests takes effect.
  const importLease = async (code: string, startOn = "2026-11-15", endOn = "2027-11-14") => {
    const [row] = await importLeasesCsv(
      t.ctx,
      leaseCsv([{ unit_code: code, start_on: startOn, end_on: endOn }]),
      "import",
    );
    expect(row?.status).toBe("imported");
    const [l] = await database.db.select().from(leases).where(eq(leases.id, row!.leaseId!));
    return l!;
  };

  test("the code version is stored as a published, immutable base row", async () => {
    const rows = await database.db.select().from(rulebooks);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: "dubai-2025-01",
      status: "published",
      createdBy: "system",
      effectiveFrom: "2025-01-01",
    });
    expect(rows[0]!.values).toEqual(base());
    await expect(
      database.pool.query("UPDATE rulebooks SET values = '{}'::jsonb WHERE version = 'dubai-2025-01'"),
    ).rejects.toThrow("immutable");
    await expect(database.pool.query("DELETE FROM rulebooks WHERE version = 'dubai-2025-01'")).rejects.toThrow(
      "immutable",
    );
    // Running the sync again is a no-op.
    await syncRulebooks(database);
    expect(await database.db.select().from(rulebooks)).toHaveLength(1);
  });

  test("startup refuses a base row that differs from code", async () => {
    await database.pool.query("ALTER TABLE rulebooks DISABLE TRIGGER rulebooks_published_no_update_delete");
    try {
      await database.pool.query(
        "UPDATE rulebooks SET values = jsonb_set(values, '{renewalNoticeDays}', '60') WHERE version = 'dubai-2025-01'",
      );
      await expect(syncRulebooks(database)).rejects.toThrow("differs from packages/rulebook");
      await database.pool.query(
        "UPDATE rulebooks SET values = jsonb_set(values, '{renewalNoticeDays}', '90') WHERE version = 'dubai-2025-01'",
      );
    } finally {
      await database.pool.query("ALTER TABLE rulebooks ENABLE TRIGGER rulebooks_published_no_update_delete");
    }
    await syncRulebooks(database);
  });

  test("only admins write; everyone reads published versions", async () => {
    for (const role of ["leasing_officer", "leasing_manager", "finance"] as const) {
      expect((await call(role, "/rulebooks", "POST", { basedOn: "dubai-2025-01" })).status).toBe(403);
      expect((await call(role, "/rulebooks/dubai-2025-01", "PATCH", { values: base() })).status).toBe(403);
      expect((await call(role, "/rulebooks/dubai-2025-01", "DELETE")).status).toBe(403);
      expect((await call(role, "/rulebooks/dubai-2025-01/publish", "POST", {})).status).toBe(403);
      const list = await json<{ active: string; versions: { version: string; isActive: boolean }[] }>(
        call(role, "/rulebooks"),
      );
      expect(list.active).toBe("dubai-2025-01");
      expect(list.versions).toMatchObject([{ version: "dubai-2025-01", isActive: true }]);
      expect((await call(role, "/rulebooks/dubai-2025-01")).status).toBe(200);
    }
    expect((await call("admin", "/rulebooks", "POST", { basedOn: "dubai-1999-01" })).status).toBe(404);
  });

  test("draft → edit → publish: new leases get the new version, existing leases keep theirs", async () => {
    const before = await importLease("RB-1");
    expect(before.rulesVersion).toBe("dubai-2025-01");

    const created = await call("admin", "/rulebooks", "POST", { basedOn: "dubai-2025-01" });
    expect(created.status).toBe(201);
    expect(await created.json()).toEqual({ version: "dubai-2026-10-01", status: "draft" });

    // Drafts are hidden from everyone but admins.
    expect((await call("leasing_manager", "/rulebooks/dubai-2026-10-01")).status).toBe(404);
    const managerList = await json<{ versions: { version: string }[] }>(call("leasing_manager", "/rulebooks"));
    expect(managerList.versions.map((v) => v.version)).toEqual(["dubai-2025-01"]);

    // Validation: unordered bands, a past effective date.
    const unordered = { ...base(), rentCapBands: base().rentCapBands.toReversed() };
    expect((await call("admin", "/rulebooks/dubai-2026-10-01", "PATCH", { values: unordered })).status).toBe(400);
    const past = await call("admin", "/rulebooks/dubai-2026-10-01", "PATCH", { effectiveFrom: "2026-10-18" });
    expect(past.status).toBe(422);
    expect(await past.json()).toMatchObject({ code: "effective_from_past" });

    const edited = await call("admin", "/rulebooks/dubai-2026-10-01", "PATCH", {
      values: { ...base(), renewalNoticeDays: 95 },
      referenceRules: [{ id: "pets", title: "Pets", text: "Small pets need the landlord's written consent." }],
    });
    expect(edited.status).toBe(200);

    const draft = await json<{
      status: string;
      loosened: unknown[];
      changesVsActive: { field: string; from?: unknown; to?: unknown }[];
    }>(call("admin", "/rulebooks/dubai-2026-10-01"));
    expect(draft.status).toBe("draft");
    expect(draft.loosened).toEqual([]);
    expect(draft.changesVsActive).toEqual([
      { field: "renewalNoticeDays", from: 90, to: 95 },
      { field: "effectiveFrom", from: "2025-01-01", to: "2026-10-19" },
      // Absent on the active side (undefined is dropped in JSON).
      { field: "referenceRules.pets.title", to: "Pets" },
      { field: "referenceRules.pets.text", to: "Small pets need the landlord's written consent." },
    ]);

    const published = await call("admin", "/rulebooks/dubai-2026-10-01/publish", "POST", {});
    expect(published.status).toBe(200);
    expect(getRulebook("dubai-2026-10-01").renewalNoticeDays).toBe(95);

    const after = await importLease("RB-2");
    expect(after.rulesVersion).toBe("dubai-2026-10-01");
    const [kept] = await database.db.select().from(leases).where(eq(leases.id, before.id));
    expect(kept!.rulesVersion).toBe("dubai-2025-01");

    // The copilot's rule routes follow the active version and include the reference notes.
    expect(await json(call("finance", "/rules"))).toMatchObject({
      current: "dubai-2026-10-01",
      versions: ["dubai-2025-01", "dubai-2026-10-01"],
    });
    const rules = await json<{
      rules: { reference: { rules: unknown[] }; renewal_notice: { renewalNoticeDays: number } };
    }>(call("finance", "/rules/dubai-2026-10-01"));
    expect(rules.rules.reference.rules).toEqual([
      { id: "pets", title: "Pets", text: "Small pets need the landlord's written consent." },
    ]);
    expect(rules.rules.renewal_notice.renewalNoticeDays).toBe(95);

    // Published versions can't be edited, deleted or published again.
    expect((await call("admin", "/rulebooks/dubai-2026-10-01", "PATCH", { values: base() })).status).toBe(409);
    expect((await call("admin", "/rulebooks/dubai-2026-10-01", "DELETE")).status).toBe(409);
    expect((await call("admin", "/rulebooks/dubai-2026-10-01/publish", "POST", {})).status).toBe(409);
    await expect(
      database.pool.query("UPDATE rulebooks SET effective_from = '2030-01-01' WHERE version = 'dubai-2026-10-01'"),
    ).rejects.toThrow("immutable");
  });

  test("weaker tenant protection needs a confirmed legal review; a future version waits for its date", async () => {
    const { version } = await json<{ version: string }>(
      call("admin", "/rulebooks", "POST", { basedOn: "dubai-2026-10-01" }),
    );
    expect(version).toBe("dubai-2026-10-02");
    const draft = await json<{ values: ReturnType<typeof base>; referenceRules: unknown[] }>(
      call("admin", `/rulebooks/${version}`),
    );
    expect(draft.values.renewalNoticeDays).toBe(95);
    expect(draft.referenceRules).toHaveLength(1);
    expect(
      (
        await call("admin", `/rulebooks/${version}`, "PATCH", {
          values: { ...draft.values, renewalNoticeDays: 60, aboveLastBandMaxIncrease: 25 },
          effectiveFrom: "2026-11-01",
        })
      ).status,
    ).toBe(200);

    const refused = await call("admin", `/rulebooks/${version}/publish`, "POST", {});
    expect(refused.status).toBe(422);
    const body = await json<{ code: string; reasons: string[] }>(refused);
    expect(body.code).toBe("legal_review_required");
    expect(body.reasons.join(" ")).toContain("renewalNoticeDays: 90 → 60");
    expect(body.reasons.join(" ")).toContain("aboveLastBandMaxIncrease");
    expect((await call("admin", `/rulebooks/${version}/publish`, "POST", { confirmLegalReview: false })).status).toBe(
      422,
    );

    const ok = await call("admin", `/rulebooks/${version}/publish`, "POST", { confirmLegalReview: true });
    expect(ok.status).toBe(200);

    // Effective 2026-11-01. Today (2026-10-19) it isn't active yet, but each lease takes the
    // version in force on its own start date.
    expect(await json(call("admin", "/rulebooks"))).toMatchObject({ active: "dubai-2026-10-01" });
    expect((await importLease("RB-3", "2026-10-25", "2027-10-24")).rulesVersion).toBe("dubai-2026-10-01");
    expect((await importLease("RB-4", "2026-11-01", "2027-10-31")).rulesVersion).toBe("dubai-2026-10-02");
    // A running lease imported now keeps the rules it started under.
    expect((await importLease("RB-5", "2026-06-01", "2027-05-31")).rulesVersion).toBe("dubai-2025-01");
    t.clock.advanceDays(13); // 2026-11-01 in Dubai
    expect(await json(call("admin", "/rulebooks"))).toMatchObject({ active: "dubai-2026-10-02" });

    const published = (await database.db.select().from(leaseEvents).where(eq(leaseEvents.type, "RULEBOOK_PUBLISHED")))
      .map((e) => e.payload as { version: string; legalReviewConfirmed: boolean; loosened: { field: string }[] })
      .find((p) => p.version === version)!;
    expect(published.legalReviewConfirmed).toBe(true);
    expect(published).toMatchObject({ supersedes: "dubai-2026-10-01", laterVersions: [] });
    expect(published.loosened.map((l) => l.field)).toEqual([
      "renewalNoticeDays",
      "rentCapBands",
      "aboveLastBandMaxIncrease",
    ]);
  });

  test("a draft can be deleted; every write is in the audit log", async () => {
    const { version } = await json<{ version: string }>(
      call("admin", "/rulebooks", "POST", { basedOn: "dubai-2025-01" }),
    );
    expect(version).toBe("dubai-2026-11-01");
    t.clock.advanceDays(1);
    const publishPast = await call("admin", `/rulebooks/${version}/publish`, "POST", {});
    // Its effective-from (yesterday, the creation day) is now in the past.
    expect(publishPast.status).toBe(422);
    expect(await publishPast.json()).toMatchObject({ code: "effective_from_past" });
    expect((await call("admin", `/rulebooks/${version}`, "DELETE")).status).toBe(200);
    expect((await call("admin", `/rulebooks/${version}`)).status).toBe(404);

    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityKind, "rulebook"));
    expect(events.map((e) => e.type).toSorted()).toEqual(
      [
        "RULEBOOK_DRAFT_CREATED",
        "RULEBOOK_DRAFT_CREATED",
        "RULEBOOK_DRAFT_CREATED",
        "RULEBOOK_DRAFT_DELETED",
        "RULEBOOK_DRAFT_UPDATED",
        "RULEBOOK_DRAFT_UPDATED",
        "RULEBOOK_PUBLISHED",
        "RULEBOOK_PUBLISHED",
      ].toSorted(),
    );
    expect(events.every((e) => e.actor.startsWith("user:") && e.rulesVersion?.startsWith("dubai-2026-"))).toBe(true);
    const update = events.find((e) => e.type === "RULEBOOK_DRAFT_UPDATED")!;
    expect((update.payload as { changes: { field: string }[] }).changes.map((c) => c.field)).toContain(
      "renewalNoticeDays",
    );

    // The read view lists a version's own history.
    const view = await json<{ events: { type: string }[] }>(call("leasing_officer", "/rulebooks/dubai-2026-10-01"));
    expect(view.events.map((e) => e.type)).toEqual([
      "RULEBOOK_DRAFT_CREATED",
      "RULEBOOK_DRAFT_UPDATED",
      "RULEBOOK_PUBLISHED",
    ]);
  });

  test("a restart reloads every published version", async () => {
    await syncRulebooks(database);
    expect(getRulebook("dubai-2026-10-02").renewalNoticeDays).toBe(60);
    expect(t.ctx.rulesVersion).toBe("dubai-2026-10-02");
  });
});
