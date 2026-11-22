import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C26 assistant threads, messages, proposals, enquiries and rate limits (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  let versionId = "";
  let listingId = "";
  const thread = async (kind = "listing"): Promise<string> =>
    (
      await q(
        "insert into assistant_threads (id, kind, subject_id, principal_hash, created_at) values (gen_random_uuid(), $1, 's', 'h', now()) returning id",
        [kind],
      )
    ).rows[0].id;
  const message = (threadId: string, o: { role?: string; content?: string } = {}) =>
    refusal(
      q(
        `insert into assistant_messages (id, thread_id, role, content, at) values (gen_random_uuid(), $1, $2, $3, now())`,
        [threadId, o.role ?? "user", o.content ?? "hi"],
      ),
    );
  const proposal = async (threadId: string, kind = "remap_blank"): Promise<string> =>
    (
      await q(
        `insert into assistant_proposals (id, thread_id, kind, template_version_id, payload, created_at)
         values (gen_random_uuid(), $1, $2, $3, '{"blankId":"b1","key":"price"}', now()) returning id`,
        [threadId, kind, versionId],
      )
    ).rows[0].id;

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const t = (
      await q(
        "insert into spa_templates (id, name, document_kind, created_by, created_at) values (gen_random_uuid(), 'T', 'mou', 'u', now()) returning id",
      )
    ).rows[0].id;
    versionId = (
      await q(
        `insert into spa_template_versions (id, template_id, version, doc_id, doc_hash, sections, blanks, look, party_blocks, signature_roles, checks, rules_version, created_by, created_at)
         values (gen_random_uuid(), $1, 1, 'd', 'h', '{}', '[]', '{}', '[]', '{}', '[]', 'r', 'u', now()) returning id`,
        [t],
      )
    ).rows[0].id;
    listingId = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`C26-${++seq}`])
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("threads have a known kind", async () => {
    expect(await thread("party")).toBeTruthy();
    expect(await thread("template")).toBeTruthy();
    expect(await thread("staff")).toBeTruthy();
    expect(await refusal(thread("admin_chat"))).toContain("assistant_threads_kind");
  });

  test("messages: a known role, and append-only", async () => {
    const t = await thread();
    expect(await message(t)).toBe("accepted");
    expect(await message(t, { role: "assistant" })).toBe("accepted");
    expect(await message(t, { role: "tool" })).toBe("accepted");
    expect(await message(t, { role: "system" })).toContain("assistant_messages_role");
    expect(await refusal(q("update assistant_messages set content = 'x' where thread_id = $1", [t]))).toContain(
      "append-only",
    );
    expect(await refusal(q("delete from assistant_messages where thread_id = $1", [t]))).toContain("append-only");
    expect(await refusal(q("truncate assistant_messages"))).toContain("append-only");
  });

  test("threads and rate-limit counters are never emptied (a truncate would reset every limit)", async () => {
    await thread();
    await q("insert into assistant_rate_limits (key_hash, bucket, n) values ('k', 'b', 1) on conflict do nothing");
    expect(await refusal(q("truncate assistant_threads cascade"))).toContain("never emptied");
    expect(await refusal(q("truncate assistant_rate_limits"))).toContain("never emptied");
    expect((await q("select count(*)::int as n from assistant_rate_limits")).rows[0].n).toBeGreaterThan(0);
  });

  test("a proposal starts as proposed; only its status and apply columns change, once", async () => {
    const t = await thread("template");
    const id = await proposal(t);
    expect(await refusal(q("update assistant_proposals set payload = '{}' where id = $1", [id]))).toContain(
      "assistant_proposals",
    );
    expect(
      await refusal(q("update assistant_proposals set kind = 'rename_placeholder' where id = $1", [id])),
    ).toContain("assistant_proposals");
    // applying needs who and when
    expect(await refusal(q("update assistant_proposals set status = 'applied' where id = $1", [id]))).toContain(
      "assistant_proposals",
    );
    expect(
      await refusal(
        q(
          "update assistant_proposals set status = 'applied', applied_by = 'user:a', applied_at = now() where id = $1",
          [id],
        ),
      ),
    ).toBe("accepted");
    // a decided proposal never moves again
    expect(await refusal(q("update assistant_proposals set status = 'dismissed' where id = $1", [id]))).toContain(
      "assistant_proposals",
    );
    expect(await refusal(q("delete from assistant_proposals where id = $1", [id]))).toContain("assistant_proposals");
    const other = await proposal(t, "rename_placeholder");
    expect(await refusal(q("update assistant_proposals set status = 'dismissed' where id = $1", [other]))).toBe(
      "accepted",
    );
    expect(await refusal(q("update assistant_proposals set status = 'weird' where id = $1", [other]))).toContain(
      "assistant_proposals",
    );
    expect(await refusal(proposal(t, "approve_template"))).toContain("assistant_proposals_kind");
  });

  test("an enquiry needs consent, and is never edited or deleted", async () => {
    const ins = (consent: string | null) =>
      refusal(
        q(
          `insert into listing_enquiries (id, listing_id, name, email, message, consent_at, created_at)
           values (gen_random_uuid(), $1, 'N', 'n@example.test', 'm', ${consent ? `'${consent}'` : "null"}, now())`,
          [listingId],
        ),
      );
    expect(await ins("2026-11-02T00:00:00Z")).toBe("accepted");
    expect(await ins(null)).toContain("consent_at");
    expect(await refusal(q("update listing_enquiries set message = 'x'"))).toContain("listing_enquiries");
    expect(await refusal(q("delete from listing_enquiries"))).toContain("listing_enquiries");
  });

  test("a rate limit bucket is unique per key", async () => {
    const ins = () =>
      refusal(q("insert into assistant_rate_limits (key_hash, bucket, n) values ('k', 'chat:2026-11-02T10', 1)"));
    expect(await ins()).toBe("accepted");
    expect(await ins()).toContain("assistant_rate_limits");
    expect(await refusal(q("insert into assistant_rate_limits (key_hash, bucket, n) values ('k', 'b', -1)"))).toContain(
      "assistant_rate_limits_n",
    );
  });
});
