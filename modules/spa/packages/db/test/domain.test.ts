import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
/** The constraint or trigger message a refused statement gives. */
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("P3 tables (spa_test)", () => {
  let db: SpaDatabase;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("units, listings, deals, spa_approvals and deal_events exist", async () => {
    const r = await q("select table_name from information_schema.tables where table_schema = 'public' order by 1");
    expect(r.rows.map((x: { table_name: string }) => x.table_name)).toEqual(
      expect.arrayContaining(["deal_events", "deals", "listings", "spa_approvals", "units"]),
    );
  });

  test("deal_events refuses update, delete and truncate", async () => {
    await q(
      "insert into deal_events (id, entity_kind, entity_id, type, actor, at) values (gen_random_uuid(), 'deal', gen_random_uuid(), 'X', 'system', now())",
    );
    expect(await refusal(q("update deal_events set type = 'Y'"))).toContain("append-only");
    expect(await refusal(q("delete from deal_events"))).toContain("append-only");
    expect(await refusal(q("truncate deal_events"))).toContain("append-only");
  });

  test("a deal points to a unit (primary) or a listing (resale), exactly one; refs D-0001 style", async () => {
    const unit = (await q("insert into units (id, code) values (gen_random_uuid(), 'U-1') returning id")).rows[0].id;
    const listing = (await q("insert into listings (id, ref) values (gen_random_uuid(), 'L-1') returning id")).rows[0]
      .id;
    const deal = (type: string, u: string | null, l: string | null, plan = false) =>
      q(
        "insert into deals (id, deal_type, unit_id, listing_id, price_fils, plan_taken_over, created_by, rules_version) values (gen_random_uuid(), $1, $2, $3, 100, $4, 'system', 'test-rules') returning ref",
        [type, u, l, plan],
      );
    expect(await refusal(deal("primary_offplan", unit, listing))).toContain("deals_one_property");
    expect(await refusal(deal("primary_offplan", null, listing))).toContain("deals_one_property");
    expect(await refusal(deal("resale_ready", unit, null))).toContain("deals_one_property");
    expect(await refusal(deal("resale_ready", null, listing, true))).toContain("deals_plan_offplan_resale");
    // Refs come from a sequence: refused inserts use numbers too, so refs increase but may skip.
    const a = (await deal("primary_offplan", unit, null)).rows[0].ref as string;
    const b = (await deal("resale_offplan", null, listing, true)).rows[0].ref as string;
    expect(a).toMatch(/^D-\d{4}$/);
    expect(b).toMatch(/^D-\d{4}$/);
    expect(Number(b.slice(2))).toBeGreaterThan(Number(a.slice(2)));
  });

  test("C3: invalid states, gates, statuses and prices are refused", async () => {
    expect(await refusal(q("insert into units (id, code, state) values (gen_random_uuid(), 'U-x', 'LOST')"))).toContain(
      "units_state",
    );
    expect(
      await refusal(q("insert into listings (id, ref, state) values (gen_random_uuid(), 'L-x', 'LOST')")),
    ).toContain("listings_state");
    const unit = (await q("insert into units (id, code) values (gen_random_uuid(), 'U-y') returning id")).rows[0].id;
    expect(
      await refusal(
        q(
          "insert into deals (id, deal_type, unit_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'primary_offplan', $1, 0, 's', 'v')",
          [unit],
        ),
      ),
    ).toContain("deals_price_positive");
    expect(
      await refusal(
        q(
          "insert into deals (id, deal_type, unit_id, price_fils, state, created_by, rules_version) values (gen_random_uuid(), 'primary_offplan', $1, 5, 'LOST', 's', 'v')",
          [unit],
        ),
      ),
    ).toContain("deals_state");
    const approval = (gate: string, status = "pending") =>
      q(
        "insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at) values (gen_random_uuid(), $1, 'deal', gen_random_uuid(), gen_random_uuid()::text, 't', '{}', 'legal', $2, 'system', now()) returning id",
        [gate, status],
      );
    expect(await refusal(approval("final_contract"))).toContain("spa_approvals_gate");
    expect(await refusal(approval("agreement_approval", "maybe"))).toContain("spa_approvals_status");
  });

  test("C3: a decided approval is final; only its consumption may be recorded, once", async () => {
    const id = (
      await q(
        "insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at) values (gen_random_uuid(), 'agreement_approval', 'deal', gen_random_uuid(), 'final-1', 't', '{}', 'legal', 'approved', 'system', now()) returning id",
      )
    ).rows[0].id;
    expect(await refusal(q("update spa_approvals set status = 'rejected' where id = $1", [id]))).toContain("final");
    expect(
      await refusal(q("update spa_approvals set consumed_by_event_id = gen_random_uuid() where id = $1", [id])),
    ).toBe("accepted");
    expect(
      await refusal(q("update spa_approvals set consumed_by_event_id = gen_random_uuid() where id = $1", [id])),
    ).toContain("final");
    expect(await refusal(q("delete from spa_approvals where id = $1", [id]))).toContain("final");
  });
});
