import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C36 copilot proposals and drafts (spa_test)", () => {
  let db: SpaDatabase;
  let userId = "";
  let threadId = "";
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const proposal = async (kind = "request_documents"): Promise<string> =>
    (
      await q(
        `insert into copilot_proposals (id, thread_id, user_id, kind, deal_id, payload, expires_at, created_at)
         values (gen_random_uuid(), $1, $2, $3, null, '{"a":1}', now() + interval '1 hour', now()) returning id`,
        [threadId, userId, kind],
      )
    ).rows[0].id;
  const draft = async (kind = "email"): Promise<string> =>
    (
      await q(
        `insert into copilot_drafts (id, thread_id, user_id, kind, deal_id, body, created_at)
         values (gen_random_uuid(), $1, $2, $3, null, 'hello', now()) returning id`,
        [threadId, userId, kind],
      )
    ).rows[0].id;

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    userId = (
      await q(
        `insert into spa_users (id, email, name, role, created_at) values (gen_random_uuid(), 'c36@example.test', 'C', 'sales_officer', now()) returning id`,
      )
    ).rows[0].id;
    threadId = (
      await q(
        "insert into assistant_threads (id, kind, subject_id, principal_hash, created_at) values (gen_random_uuid(), 'staff', 'staff', 'h', now()) returning id",
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("a staff thread is allowed, and a copilot task kind is allowed", async () => {
    expect(threadId).toBeTruthy();
    const r = await refusal(
      q(
        `insert into spa_tasks (id, kind, role, title, dedupe_key, created_at) values (gen_random_uuid(), 'copilot_task', 'sales_officer', 'Call the buyer', 'copilot:t1', now())`,
      ),
    );
    expect(r).toBe("accepted");
  });

  test("the four proposal kinds are the only ones", async () => {
    for (const k of ["request_documents", "create_task", "resend_signing_link", "prepare_agreement"])
      expect(await proposal(k)).toBeTruthy();
    const r = await refusal(proposal("approve_gate"));
    expect(r).toContain("copilot_proposals_kind");
  });

  test("a proposal moves once from proposed, and its payload is fixed", async () => {
    const id = await proposal();
    expect(await refusal(q("update copilot_proposals set payload = '{\"a\":2}' where id = $1", [id]))).toContain(
      "payload",
    );
    expect(await refusal(q("update copilot_proposals set status = 'confirmed' where id = $1", [id]))).toContain(
      "confirmed_at",
    );
    expect(
      await refusal(q("update copilot_proposals set status = 'confirmed', confirmed_at = now() where id = $1", [id])),
    ).toBe("accepted");
    expect(await refusal(q("update copilot_proposals set status = 'cancelled' where id = $1", [id]))).toContain(
      "never changes again",
    );
    expect(await refusal(q("delete from copilot_proposals where id = $1", [id]))).toContain("never deleted");
    const other = await proposal("create_task");
    expect(await refusal(q("update copilot_proposals set status = 'cancelled' where id = $1", [other]))).toBe(
      "accepted",
    );
    const exp = await proposal("prepare_agreement");
    expect(await refusal(q("update copilot_proposals set status = 'expired' where id = $1", [exp]))).toBe("accepted");
    const odd = await proposal("prepare_agreement");
    expect(await refusal(q("update copilot_proposals set status = 'weird' where id = $1", [odd]))).toContain(
      "confirmed, cancelled or expired",
    );
  });

  test("a cancelled or expired proposal has no result", async () => {
    for (const status of ["cancelled", "expired"]) {
      const id = await proposal();
      expect(
        await refusal(q(`update copilot_proposals set status = '${status}', result = '{"x":1}' where id = $1`, [id])),
      ).toContain("no result");
      expect(await refusal(q(`update copilot_proposals set status = '${status}' where id = $1`, [id]))).toBe(
        "accepted",
      );
    }
  });

  test("a confirmed proposal takes its result once, after the effect ran; nothing else about it changes", async () => {
    const id = await proposal();
    expect(
      await refusal(q("update copilot_proposals set status = 'confirmed', confirmed_at = now() where id = $1", [id])),
    ).toBe("accepted");
    expect(await refusal(q("update copilot_proposals set confirmed_at = now() where id = $1", [id]))).toContain(
      "never changes again",
    );
    expect(await refusal(q("update copilot_proposals set status = 'cancelled' where id = $1", [id]))).toContain(
      "never changes again",
    );
    expect(await refusal(q(`update copilot_proposals set result = '{"queued":true}' where id = $1`, [id]))).toBe(
      "accepted",
    );
    expect(await refusal(q(`update copilot_proposals set result = '{"queued":false}' where id = $1`, [id]))).toContain(
      "never changes again",
    );
  });

  test("a draft is immutable: no update, delete or truncate; only three kinds", async () => {
    for (const k of ["email", "summary", "approval_note"]) expect(await draft(k)).toBeTruthy();
    expect(await refusal(draft("send_it"))).toContain("copilot_drafts_kind");
    const id = await draft();
    expect(await refusal(q("update copilot_drafts set body = 'x' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("delete from copilot_drafts where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("truncate copilot_drafts"))).toContain("immutable");
  });
});
