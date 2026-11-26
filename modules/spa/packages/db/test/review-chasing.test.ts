import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C25 agreement reviews, chase templates, chases and pauses (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  let templateVersionId = "";
  let tplId = "";
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`C25-${++seq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  const agreementOf = async (dealId: string): Promise<string> =>
    (
      await q(
        `insert into agreements (id, deal_id, kind, version, template_version_id, status, doc_hash, storage_key, values_hash, field_sources, rules_version, policy_version, prepared_by, prepared_at)
         values (gen_random_uuid(), $1, 'mou', 1, $2, 'prepared', 'd', 'k', 'v', '{}', 'r', 0, 'system:prepare', now()) returning id`,
        [dealId, templateVersionId],
      )
    ).rows[0].id;
  const partyOf = async (): Promise<string> =>
    (
      await q(
        `insert into parties (id, kind, full_name_en, email, created_at) values (gen_random_uuid(), 'person', 'P', 'p@example.test', now()) returning id`,
      )
    ).rows[0].id;
  const review = (agreementId: string, version = "spa-agreement-review.v1", dropped = 0) =>
    refusal(
      q(
        `insert into agreement_reviews (id, agreement_id, flags, dropped, model_tag, prompt_version, instruction_found, run_id, created_at)
         values (gen_random_uuid(), $1, '[]', $3, 'm', $2, false, null, now())`,
        [agreementId, version, dropped],
      ),
    );
  const template = (kind: string, version: number, status = "draft") =>
    refusal(
      q(
        `insert into chase_templates (id, kind, version, subject, body, status, created_by, created_at)
         values (gen_random_uuid(), $1, $2, 's', '{items}', $3, 'user:a', now())`,
        [kind, version, status],
      ),
    );
  const mailRow = async (dealId: string): Promise<string> =>
    (
      await q(
        `insert into outbound_messages (id, entity_kind, entity_id, purpose, milestone, to_email, intended_to, template, template_version, subject, status, created_at)
         values (gen_random_uuid(), 'deal', $1, 'reminder', $2, 'x@example.test', 'x@example.test', 'chase', 1, 's', 'sent', now()) returning id`,
        [dealId, `m-${++seq}`],
      )
    ).rows[0].id;
  const chase = (o: {
    dealId: string;
    partyId: string;
    mailId: string;
    item?: string;
    reason?: string;
    step?: number;
  }) =>
    refusal(
      q(
        `insert into chases (id, deal_id, party_id, item_key, reason_code, step, template_id, template_version, subject, body_sha256, outbound_message_id, created_at)
         values (gen_random_uuid(), $1, $2, $3, $4, $5, $6, 1, 's', 'abc', $7, now())`,
        [
          o.dealId,
          o.partyId,
          o.item ?? "missing:passport",
          o.reason ?? "document_missing",
          o.step ?? 0,
          tplId,
          o.mailId,
        ],
      ),
    );

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
    tplId = (
      await q(
        `insert into chase_templates (id, kind, version, subject, body, status, created_by, approved_by, approved_at, created_at)
         values (gen_random_uuid(), 'chase', 1, 's', '{items}', 'approved', 'user:a', 'user:a', now(), now()) returning id`,
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("an agreement review is unique per agreement and prompt version, and immutable", async () => {
    const a = await agreementOf(await newDeal());
    expect(await review(a)).toBe("accepted");
    expect(await review(a)).toContain("agreement_reviews_once_uq");
    expect(await review(a, "spa-agreement-review.v2")).toBe("accepted");
    expect(await review(a, "spa-agreement-review.v3", -1)).toContain("agreement_reviews_dropped");
    expect(await refusal(q("update agreement_reviews set dropped = 3 where agreement_id = $1", [a]))).toContain(
      "immutable",
    );
    expect(await refusal(q("delete from agreement_reviews where agreement_id = $1", [a]))).toContain("immutable");
    expect(await refusal(q("truncate agreement_reviews"))).toContain("immutable");
  });

  test("a chase template: unique per kind and version, a known kind and status", async () => {
    expect(await template("chase", 2)).toBe("accepted");
    expect(await template("chase", 2)).toContain("chase_templates_kind_version_uq");
    expect(await template("other", 1)).toContain("chase_templates_kind");
    expect(await template("chase", 3, "published")).toMatch(/chase_templates_(status|approved_who)/);
    expect(await template("chase", 4, "approved")).toContain("chase_templates_approved_who");
  });

  test("a draft is approved once with who and when; an approved version never changes except to retired", async () => {
    await template("chase", 10);
    const id = (await q("select id from chase_templates where kind = 'chase' and version = 10")).rows[0].id;
    expect(await refusal(q("update chase_templates set body = 'new {items}' where id = $1", [id]))).toContain(
      "only be approved",
    );
    expect(await refusal(q("update chase_templates set status = 'retired' where id = $1", [id]))).toContain(
      "only be approved",
    );
    expect(
      await refusal(
        q("update chase_templates set status = 'approved', approved_by = 'user:b', approved_at = now() where id = $1", [
          id,
        ]),
      ),
    ).toBe("accepted");
    expect(await refusal(q("update chase_templates set body = 'x {items}' where id = $1", [id]))).toContain(
      "immutable",
    );
    expect(await refusal(q("update chase_templates set subject = 'x' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("update chase_templates set approved_by = 'user:c' where id = $1", [id]))).toContain(
      "immutable",
    );
    expect(await refusal(q("update chase_templates set status = 'draft' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("update chase_templates set status = 'retired' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update chase_templates set status = 'approved' where id = $1", [id]))).toContain(
      "immutable",
    );
    expect(await refusal(q("delete from chase_templates where id = $1", [id]))).toContain("never deleted");
    expect(await refusal(q("truncate chase_templates cascade"))).toContain("never deleted");
  });

  test("a chase: unique per party, item and step; reason from the fixed list; insert-only", async () => {
    const dealId = await newDeal();
    const partyId = await partyOf();
    const mailId = await mailRow(dealId);
    expect(await chase({ dealId, partyId, mailId })).toBe("accepted");
    expect(await chase({ dealId, partyId, mailId })).toContain("chases_once_uq");
    expect(await chase({ dealId, partyId, mailId, step: 1 })).toBe("accepted");
    expect(await chase({ dealId, partyId, mailId, step: 2, reason: "aml_review" })).toContain("chases_reason");
    expect(await chase({ dealId, partyId, mailId, step: -1 })).toContain("chases_step");
    expect(
      await chase({ dealId, partyId, mailId, item: "additional_documents:x", reason: "additional_documents" }),
    ).toBe("accepted");
    expect(await refusal(q("update chases set step = 9 where deal_id = $1", [dealId]))).toContain("insert-only");
    expect(await refusal(q("delete from chases where deal_id = $1", [dealId]))).toContain("insert-only");
    expect(await refusal(q("truncate chases"))).toContain("insert-only");
  });

  test("a pause: one open pause per deal; only resumed_at changes, once; never deleted", async () => {
    const dealId = await newDeal();
    const pause = () =>
      refusal(
        q(
          `insert into chase_pauses (id, deal_id, paused_by, paused_at) values (gen_random_uuid(), $1, 'user:o', now())`,
          [dealId],
        ),
      );
    expect(await pause()).toBe("accepted");
    expect(await pause()).toContain("chase_pauses_one_open_uq");
    expect(await refusal(q("update chase_pauses set paused_by = 'user:x' where deal_id = $1", [dealId]))).toContain(
      "only be resumed",
    );
    expect(await refusal(q("update chase_pauses set resumed_at = now() where deal_id = $1", [dealId]))).toBe(
      "accepted",
    );
    expect(await refusal(q("update chase_pauses set resumed_at = now() where deal_id = $1", [dealId]))).toContain(
      "only be resumed",
    );
    expect(await pause()).toBe("accepted");
    expect(await refusal(q("delete from chase_pauses where deal_id = $1", [dealId]))).toContain("never deleted");
    expect(await refusal(q("truncate chase_pauses"))).toContain("never deleted");
  });

  test("tasks may be kind chase_overdue; helper settings may name the agreement review but not the chaser", async () => {
    const dealId = await newDeal();
    const task = (kind: string) =>
      refusal(
        q(
          `insert into spa_tasks (id, deal_id, kind, role, title, detail, status, dedupe_key, created_at)
           values (gen_random_uuid(), $1, $2, 'sales_officer', 't', '{}', 'open', $3, now())`,
          [dealId, kind, `${kind}:${++seq}`],
        ),
      );
    expect(await task("chase_overdue")).toBe("accepted");
    expect(await task("chase_forever")).toContain("spa_tasks_kind");
    const setting = (helper: string) =>
      refusal(
        q(
          `insert into spa_helper_settings (helper, scope, version, mode, set_by, set_at) values ($1, '*', 1, 'review', 'user:u', now())`,
          [helper],
        ),
      );
    expect(await setting("spa_agreement_review")).toBe("accepted");
    expect(await setting("chaser")).toContain("spa_helper_settings_helper");
  });
});
