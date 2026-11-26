import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/client.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();

describe.skipIf(!url)("approvals and policy guards (C29, S57)", () => {
  let db: SpaDatabase;
  let dealId: string;
  const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => "accepted",
      (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
    );
  const pending = async (key: string) =>
    (
      await q(
        `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, reasons, approver_role, proposed_by, created_at)
         values (gen_random_uuid(), 'kyc_review', 'deal', $1, $2, 'Check', '{"a":1}', '{r1}', 'sales_manager', 'system:kyc', now()) returning id`,
        [dealId, key],
      )
    ).rows[0].id as string;

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const listing = (await q("insert into listings (id, ref) values (gen_random_uuid(), 'L-9') returning id")).rows[0]
      .id;
    dealId = (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 100, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("a pending approval's gate, record, proposal, role, proposer, title and key can't be edited by hand", async () => {
    const id = await pending("k1");
    const edits: string[] = [
      "gate = 'price_out_of_range'",
      "entity_kind = 'listing'",
      "entity_id = gen_random_uuid()",
      "proposal = '{\"a\":2}'",
      "approver_role = 'finance'",
      "proposed_by = 'user:someone'",
      "title = 'Another'",
      "dedupe_key = 'k-other'",
      "created_at = now() + interval '1 day'",
    ];
    for (const set of edits)
      expect(await refusal(q(`update spa_approvals set ${set} where id = $1`, [id]))).toContain("pending approval");
    const [row] = (await q("select gate, title, proposal from spa_approvals where id = $1", [id])).rows;
    expect(row).toEqual({ gate: "kyc_review", title: "Check", proposal: { a: 1 } });
  });
  test("what the code does stays allowed: the decision columns, the reasons a template re-check refreshes, cancelling", async () => {
    const id = await pending("k2");
    expect(await refusal(q("update spa_approvals set reasons = '{r2}' where id = $1", [id]))).toBe("accepted");
    expect(
      await refusal(q("update spa_approvals set consumed_by_event_id = gen_random_uuid() where id = $1", [id])),
    ).toBe("accepted");
    expect(await refusal(q("update spa_approvals set status = 'cancelled' where id = $1", [id]))).toBe("accepted");
    const id2 = await pending("k3");
    expect(
      await refusal(
        q(
          "update spa_approvals set status = 'edited', outcome = null, decided_at = now(), decision_note = 'n', edited_proposal = '{}' where id = $1",
          [id2],
        ),
      ),
    ).toBe("accepted");
  });
  test("a decided approval is still final (migration 0005) and nothing deletes one", async () => {
    const id = await pending("k4");
    await q("update spa_approvals set status = 'rejected', decided_at = now() where id = $1", [id]);
    expect(await refusal(q("update spa_approvals set title = 'x' where id = $1", [id]))).toContain("final");
    expect(await refusal(q("delete from spa_approvals where id = $1", [id]))).toContain("final");
  });
  test("spa_approvals and spa_policy can't be truncated; policy versions can't be edited or deleted", async () => {
    expect(await refusal(q("truncate spa_approvals cascade"))).toContain("TRUNCATE refused");
    expect(await refusal(q("truncate spa_policy"))).toContain("TRUNCATE refused");
    await q("insert into spa_policy (version, values, created_by, created_at) values (91, '{}', 'u', now())");
    expect(await refusal(q("update spa_policy set created_by = 'x' where version = 91"))).toContain("immutable");
    expect(await refusal(q("delete from spa_policy where version = 91"))).toContain("immutable");
    expect((await q("select count(*)::int as n from spa_approvals")).rows[0].n).toBeGreaterThan(0);
  });
});
