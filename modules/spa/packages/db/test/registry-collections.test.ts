import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C21 registry rejections, collection reminders, retries (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`L-${++seq}`])
    ).rows[0].id;
    const id = (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_offplan', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
    await q(
      "insert into payment_plan_rows (deal_id, seq, label, due_on, amount_fils, entered_by) values ($1, 1, 'First', '2026-12-01', 500, 'u')",
      [id],
    );
    return id;
  };
  const approval = async (dealId: string): Promise<string> => {
    const id = crypto.randomUUID();
    await q(
      `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at)
       values ($1, 'transfer_submission', 'deal', $2, $3, 't', '{}', 'sales_admin', 'approved', 'system', now())`,
      [id, dealId, `${id}:k`],
    );
    return id;
  };
  const registration = async (
    dealId: string,
    approvalId: string,
    o: { attempt?: number; status?: string; requestId?: string } = {},
  ) => {
    const id = crypto.randomUUID();
    const attempt = o.attempt ?? 1;
    const r = await refusal(
      q(
        `insert into registrations (id, deal_id, kind, attempt, request_id, status, reasons, approval_id, payload_hash, created_at)
         values ($1, $2, 'trustee_transfer', $3, $4, $5, '[]', $6, 'h', now())`,
        [
          id,
          dealId,
          attempt,
          o.requestId ?? `${dealId}:trustee_transfer:${attempt}`,
          o.status ?? "rejected",
          approvalId,
        ],
      ),
    );
    return { id, r };
  };
  const rejection = (registrationId: string, o: { source?: string; action?: string; conf?: number | null } = {}) =>
    refusal(
      q(
        `insert into registry_rejections (id, registration_id, codes, mapped_field, mapped_confidence, source, action, created_at)
         values (gen_random_uuid(), $1, '{BUYER_NAME_MISMATCH}', 'buyer_name', $2, $3, $4, now())`,
        [registrationId, o.conf === undefined ? 1 : o.conf, o.source ?? "code", o.action ?? "fixed"],
      ),
    );
  const outbound = async (dealId: string, status = "sent"): Promise<string> => {
    const id = crypto.randomUUID();
    await q(
      `insert into outbound_messages (id, entity_kind, entity_id, purpose, milestone, to_email, intended_to, template, template_version, subject, status, created_at)
       values ($1, 'deal', $2, 'reminder', $3, 'a@example.test', 'a@example.test', 'instalment_reminder', 1, 's', $4, now())`,
      [id, dealId, `m-${id}`, status],
    );
    return id;
  };
  const reminder = (dealId: string, outboundId: string, o: { seq?: number; milestone?: string } = {}) =>
    refusal(
      q(
        `insert into collection_reminders (id, deal_id, plan_seq, milestone, outbound_message_id, sent_at)
         values (gen_random_uuid(), $1, $2, $3, $4, now())`,
        [dealId, o.seq ?? 1, o.milestone ?? "T-14", outboundId],
      ),
    );
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("an 'unavailable' answer can be tried again with the same attempt and request id; an answered one is unique", async () => {
    const d = await newDeal();
    const a = await approval(d);
    expect((await registration(d, a, { status: "unavailable" })).r).toBe("accepted");
    expect((await registration(d, a, { status: "unavailable" })).r).toBe("accepted");
    expect((await registration(d, a, { status: "rejected" })).r).toBe("accepted");
    // Once an answer is stored, the same attempt or request id cannot answer again.
    expect((await registration(d, a, { status: "rejected" })).r).toContain("registrations_deal_kind_attempt_uq");
    expect(
      (await registration(d, a, { status: "rejected", attempt: 2, requestId: `${d}:trustee_transfer:1` })).r,
    ).toContain("registrations_request_id_uq");
  });

  test("a rejection record is kept once per registration, checked, and append-only", async () => {
    const d = await newDeal();
    const a = await approval(d);
    const { id } = await registration(d, a);
    expect(await rejection(id, { source: "nope" })).toContain("registry_rejections_source");
    expect(await rejection(id, { action: "nope" })).toContain("registry_rejections_action");
    expect(await rejection(id, { conf: 1.5 })).toContain("registry_rejections_confidence");
    expect(await rejection(id)).toBe("accepted");
    expect(await rejection(id)).toContain("registry_rejections_registration_uq");
    expect(
      await refusal(q("update registry_rejections set action = 'task' where registration_id = $1", [id])),
    ).toContain("append-only");
    expect(await refusal(q("delete from registry_rejections where registration_id = $1", [id]))).toContain(
      "append-only",
    );
    expect(await refusal(q("truncate registry_rejections"))).toContain("append-only");
  });

  test("a reminder is kept once per plan row and milestone, checked, and insert-only", async () => {
    const d = await newDeal();
    const o = await outbound(d);
    expect(await reminder(d, await outbound(d, "sending"))).toContain("needs a sent mail of the same deal");
    expect(await reminder(d, await outbound(await newDeal()))).toContain("needs a sent mail of the same deal");
    expect(await reminder(d, o, { milestone: "X-9" })).toContain("collection_reminders_milestone");
    expect(await reminder(d, o, { seq: 7 })).toContain("collection_reminders_plan_row_fk");
    expect(await reminder(d, o)).toBe("accepted");
    expect(await reminder(d, o)).toContain("collection_reminders_once_uq");
    expect(await reminder(d, o, { milestone: "T+1" })).toBe("accepted");
    expect(await refusal(q("update collection_reminders set milestone = 'T-3' where deal_id = $1", [d]))).toContain(
      "insert-only",
    );
    expect(await refusal(q("delete from collection_reminders where deal_id = $1", [d]))).toContain("insert-only");
    expect(await refusal(q("truncate collection_reminders"))).toContain("insert-only");
  });

  test("the new task kinds are accepted", async () => {
    const d = await newDeal();
    for (const kind of ["registry_rejected", "registry_unavailable", "instalment_overdue"]) {
      const r = await refusal(
        q(
          `insert into spa_tasks (id, deal_id, kind, role, title, detail, status, dedupe_key, created_at)
           values (gen_random_uuid(), $1, $2, 'sales_admin', 't', '{}', 'open', $3, now())`,
          [d, kind, `${d}:${kind}`],
        ),
      );
      expect(r, kind).toBe("accepted");
    }
  });
});
