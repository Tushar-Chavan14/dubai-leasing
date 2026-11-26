import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C24 helper settings and review holds (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const setting = (helper: string, o: { scope?: string; version?: number; mode?: string } = {}) =>
    refusal(
      q(
        `insert into spa_helper_settings (helper, scope, version, mode, set_by, set_at)
         values ($1, $2, $3, $4, 'user:u', now())`,
        [helper, o.scope ?? "*", o.version ?? 1, o.mode ?? "review"],
      ),
    );
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`H-${++seq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_offplan', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  const run = async (dealId: string): Promise<string> =>
    (
      await q(
        `insert into helper_runs (id, helper, deal_id, entity_kind, entity_id, status, result, reasons, rules_version, created_at)
         values (gen_random_uuid(), 'spa_kyc', $1, 'deal', $1, 'ok', '{}', '[]', 'r', now()) returning id`,
        [dealId],
      )
    ).rows[0].id;
  const approval = async (dealId: string): Promise<string> => {
    const id = crypto.randomUUID();
    await q(
      `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at)
       values ($1, 'helper_review', 'deal', $2, $3, 't', '{}', 'sales_officer', 'pending', 'system:spa_kyc', now())`,
      [id, dealId, `${id}:k`],
    );
    return id;
  };
  let officer = "";
  const decide = async (approvalId: string, status: "approved" | "rejected") => {
    officer ||= (
      await q(
        "insert into spa_users (id, email, name, role) values (gen_random_uuid(), 'o@x.test', 'o', 'sales_officer') returning id",
      )
    ).rows[0].id;
    await q("update spa_approvals set status = $2, decided_by = $3, decided_at = now() where id = $1", [
      approvalId,
      status,
      officer,
    ]);
  };
  const hold = (dealId: string, runId: string, approvalId: string, status = "pending") =>
    refusal(
      q(
        `insert into helper_review_holds (run_id, deal_id, approval_id, status, created_at)
         values ($1, $2, $3, $4, now())`,
        [runId, dealId, approvalId, status],
      ),
    );
  const task = (dealId: string, kind: string) =>
    refusal(
      q(
        `insert into spa_tasks (id, deal_id, kind, role, title, detail, status, dedupe_key, created_at)
         values (gen_random_uuid(), $1, $2, 'sales_officer', 't', '{}', 'open', $3, now())`,
        [dealId, kind, `${kind}:${++seq}`],
      ),
    );
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("only the six switchable helpers can be set, and only to auto, review or off", async () => {
    for (const h of ["spa_kyc", "spa_company_check", "spa_ownership_check", "spa_prepare", "registry"])
      expect(await setting(h)).toBe("accepted");
    expect(await setting("spa_document_reader", { scope: "noc", mode: "off" })).toBe("accepted");
    for (const h of ["aml_screening", "settlement", "chaser", "collections", "spa_aml", "agreement_approval"])
      expect(await setting(h)).toContain("spa_helper_settings_helper");
    expect(await setting("spa_kyc", { version: 2, mode: "maybe" })).toContain("spa_helper_settings_mode");
    expect(await setting("spa_kyc", { version: 0 })).toContain("spa_helper_settings_version");
    expect(await setting("spa_kyc", { version: 3, scope: "" })).toContain("spa_helper_settings_scope");
  });

  test("settings are append-only: a version is never edited or deleted, and the table is never emptied", async () => {
    expect(await setting("spa_kyc", { version: 10, mode: "auto" })).toBe("accepted");
    expect(await setting("spa_kyc", { version: 10, mode: "off" })).toContain(
      "spa_helper_settings_helper_scope_version_pk",
    );
    expect(await refusal(q("update spa_helper_settings set mode = 'off' where helper = 'spa_kyc'"))).toContain(
      "append-only",
    );
    expect(await refusal(q("delete from spa_helper_settings"))).toContain("append-only");
    expect(await refusal(q("truncate spa_helper_settings"))).toContain("append-only");
  });

  test("a review hold is one per run, starts pending and leaves pending once", async () => {
    const d = await newDeal();
    const r = await run(d);
    const a = await approval(d);
    await decide(a, "approved");
    expect(await hold(d, r, a, "released")).toContain("helper_review_holds_decided");
    expect(await hold(d, r, a, "nonsense")).toContain("violates check constraint");
    expect(await hold(d, r, a)).toBe("accepted");
    expect(await hold(d, r, await approval(d))).toContain("helper_review_holds_pkey");
    // Decide once: pending -> released stamps decided_at (and needs the approval approved, S59 amendment).
    expect(await refusal(q("update helper_review_holds set status = 'released' where run_id = $1", [r]))).toContain(
      "helper_review_holds_decided",
    );
    expect(
      await refusal(q("update helper_review_holds set status = 'released', decided_at = now() where run_id = $1", [r])),
    ).toBe("accepted");
    // Final: not back to pending, not to rejected, no other column.
    expect(await refusal(q("update helper_review_holds set status = 'rejected' where run_id = $1", [r]))).toContain(
      "final",
    );
    expect(
      await refusal(q("update helper_review_holds set status = 'pending', decided_at = null where run_id = $1", [r])),
    ).toContain("final");
    expect(await refusal(q("delete from helper_review_holds where run_id = $1", [r]))).toContain("never deleted");
    expect(await refusal(q("truncate helper_review_holds"))).toContain("never");
  });

  test("a hold is released only by its own approved helper_review, and rejected only by a rejected one (S59 amendment)", async () => {
    const release = (r: string) =>
      refusal(q("update helper_review_holds set status = 'released', decided_at = now() where run_id = $1", [r]));
    const reject = (r: string) =>
      refusal(q("update helper_review_holds set status = 'rejected', decided_at = now() where run_id = $1", [r]));
    const d = await newDeal();
    // 1. the approval is still pending: neither decision is allowed
    const r1 = await run(d);
    const a1 = await approval(d);
    await hold(d, r1, a1);
    expect(await release(r1)).toContain("approved helper_review");
    expect(await reject(r1)).toContain("rejected helper_review");
    // 2. a rejected approval cannot release, and an approved one cannot reject
    await decide(a1, "rejected");
    expect(await release(r1)).toContain("approved helper_review");
    expect(await reject(r1)).toBe("accepted");
    const r2 = await run(d);
    const a2 = await approval(d);
    await hold(d, r2, a2);
    await decide(a2, "approved");
    expect(await reject(r2)).toContain("rejected helper_review");
    expect(await release(r2)).toBe("accepted");
    // 3. an approval of another deal, or of another gate, does not count
    const other = await newDeal();
    const r3 = await run(d);
    const a3 = await approval(other);
    await hold(d, r3, a3);
    await decide(a3, "approved");
    expect(await release(r3)).toContain("same deal");
    const r4 = await run(d);
    const a4 = crypto.randomUUID();
    await q(
      `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at)
       values ($1, 'noc_review', 'deal', $2, $3, 't', '{}', 'sales_officer', 'pending', 'system:x', now())`,
      [a4, d, `${a4}:k`],
    );
    await hold(d, r4, a4);
    await decide(a4, "approved");
    expect(await release(r4)).toContain("approved helper_review");
  });

  test("a pending hold can only change its status and decided_at, and only to released or rejected", async () => {
    const d = await newDeal();
    const r = await run(d);
    const aa = await approval(d);
    await hold(d, r, aa);
    await decide(aa, "rejected");
    expect(
      await refusal(q("update helper_review_holds set deal_id = $2 where run_id = $1", [r, await newDeal()])),
    ).toContain("can't be changed");
    expect(
      await refusal(q("update helper_review_holds set approval_id = $2 where run_id = $1", [r, await approval(d)])),
    ).toContain("can't be changed");
    expect(
      await refusal(q("update helper_review_holds set status = 'rejected', decided_at = now() where run_id = $1", [r])),
    ).toBe("accepted");
  });

  test("tasks can say a helper is off or its result was rejected", async () => {
    const d = await newDeal();
    expect(await task(d, "helper_off")).toBe("accepted");
    expect(await task(d, "helper_rejected")).toBe("accepted");
    expect(await task(d, "made_up")).toContain("spa_tasks_kind");
  });
});
