import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C19 agreements and payment plan rows (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`L-${++seq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  let templateVersionId = "";
  const agreement = async (dealId: string, o: { version?: number; kind?: string; status?: string } = {}) => {
    const id = crypto.randomUUID();
    const r = await refusal(
      q(
        `insert into agreements (id, deal_id, kind, version, template_version_id, status, doc_hash, storage_key, values_hash, field_sources, rules_version, policy_version, prepared_by, prepared_at)
         values ($1, $2, $3, $4, $5, $6, 'd', 'k', 'v', '{}', 'r', 0, 'system:prepare', now())`,
        [id, dealId, o.kind ?? "mou", o.version ?? 1, templateVersionId, o.status ?? "prepared"],
      ),
    );
    return { id, r };
  };
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const t = (
      await q(
        "insert into spa_templates (id, name, document_kind, created_by, created_at) values (gen_random_uuid(), 'T', 'mou', 'u', now()) returning id",
      )
    ).rows[0].id;
    templateVersionId = (
      await q(
        `insert into spa_template_versions (id, template_id, version, doc_id, doc_hash, sections, blanks, look, party_blocks, signature_roles, checks, rules_version, created_by, created_at)
         values (gen_random_uuid(), $1, 1, 'd', 'h', '{}', '[]', '{}', '[]', '{}', '[]', 'r', 'u', now()) returning id`,
        [t],
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("kind and status are checked; version is unique per deal and kind", async () => {
    const dealId = await newDeal();
    expect((await agreement(dealId, { kind: "nope" })).r).toContain("agreements_kind");
    expect((await agreement(dealId, { status: "done" })).r).toContain("agreements_status");
    expect((await agreement(dealId, { version: 1 })).r).toBe("accepted");
    // A second live version of the same kind is refused: one live agreement per deal and kind.
    expect((await agreement(dealId, { version: 2 })).r).toContain("agreements_one_live_uq");
    expect((await agreement(dealId, { version: 1, status: "superseded" })).r).toContain("agreements_version_uq");
    expect((await agreement(dealId, { version: 2, status: "superseded" })).r).toBe("accepted");
  });

  test("content never changes; the status only moves forward; the approval is linked once; never deleted", async () => {
    const dealId = await newDeal();
    const { id } = await agreement(dealId);
    expect(await refusal(q("update agreements set doc_hash = 'x' where id = $1", [id]))).toContain("fixed");
    expect(await refusal(q("update agreements set field_sources = '{\"a\":1}' where id = $1", [id]))).toContain(
      "fixed",
    );
    expect(await refusal(q("update agreements set status = 'in_review' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update agreements set status = 'prepared' where id = $1", [id]))).toContain(
      "cannot become",
    );
    // Approved only through its own approved agreement_approval of this deal (review 12).
    expect(await refusal(q("update agreements set status = 'approved' where id = $1", [id]))).toContain(
      "agreement_approval",
    );
    const approved = (
      await q(
        `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, reasons, approver_role, proposed_by, status, created_at)
         values (gen_random_uuid(), 'agreement_approval', 'deal', $1, gen_random_uuid()::text, 't', '{}', '{}', 'legal', 'system:prepare', 'approved', now()) returning id`,
        [dealId],
      )
    ).rows[0].id;
    expect(await refusal(q("update agreements set approval_id = $2 where id = $1", [id, approved]))).toBe("accepted");
    expect(await refusal(q("update agreements set status = 'approved' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update agreements set status = 'in_review' where id = $1", [id]))).toContain(
      "cannot become",
    );
    expect(await refusal(q("update agreements set status = 'superseded' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update agreements set status = 'approved' where id = $1", [id]))).toContain(
      "cannot become",
    );
    expect(await refusal(q("delete from agreements where id = $1", [id]))).toContain("never deleted");
    expect(await refusal(q("truncate agreements cascade"))).toContain("append-only");
  });

  test("the approval is linked once", async () => {
    const dealId = await newDeal();
    const { id } = await agreement(dealId);
    const approval = async () =>
      (
        await q(
          `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, reasons, approver_role, proposed_by, created_at)
           values (gen_random_uuid(), 'agreement_approval', 'deal', $1, gen_random_uuid()::text, 't', '{}', '{}', 'legal', 'system:prepare', now()) returning id`,
          [dealId],
        )
      ).rows[0].id;
    const a1 = await approval();
    const a2 = await approval();
    expect(await refusal(q("update agreements set approval_id = $2 where id = $1", [id, a1]))).toBe("accepted");
    expect(await refusal(q("update agreements set approval_id = $2 where id = $1", [id, a2]))).toContain("linked once");
  });

  test("payment plan rows: amount > 0, a due date or a milestone, one row per seq", async () => {
    const dealId = await newDeal();
    const row = (seqNo: number, amount: number, due: string | null, milestone: string | null) =>
      refusal(
        q(
          "insert into payment_plan_rows (deal_id, seq, label, due_on, milestone, amount_fils, entered_by) values ($1, $2, 'x', $3, $4, $5, 'user:u')",
          [dealId, seqNo, due, milestone, amount],
        ),
      );
    expect(await row(1, 0, "2027-01-01", null)).toContain("payment_plan_rows_amount_positive");
    expect(await row(1, 10, null, null)).toContain("payment_plan_rows_when");
    expect(await row(1, 10, "2027-01-01", null)).toBe("accepted");
    expect(await row(2, 10, null, "On handover")).toBe("accepted");
    expect(await row(1, 10, "2027-02-01", null)).toContain("payment_plan_rows_deal_id_seq_pk");
  });

  test("the plan rows are fixed while a live agreement exists, and free again once it is superseded", async () => {
    const dealId = await newDeal();
    const add = (n: number) =>
      refusal(
        q(
          "insert into payment_plan_rows (deal_id, seq, label, due_on, amount_fils, entered_by) values ($1, $2, 'x', '2027-01-01', 10, 'user:u')",
          [dealId, n],
        ),
      );
    expect(await add(1)).toBe("accepted");
    const { id } = await agreement(dealId);
    expect(await add(2)).toContain("fixed while an agreement is live");
    expect(await refusal(q("update payment_plan_rows set amount_fils = 11 where deal_id = $1", [dealId]))).toContain(
      "fixed while an agreement is live",
    );
    expect(await refusal(q("delete from payment_plan_rows where deal_id = $1", [dealId]))).toContain(
      "fixed while an agreement is live",
    );
    await q("update agreements set status = 'superseded' where id = $1", [id]);
    expect(await add(2)).toBe("accepted");
  });
});
