import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );
const HASH = "a".repeat(64);

describe.skipIf(!url)("C34 template uploads (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const id = () => crypto.randomUUID();
  const template = async (): Promise<string> => {
    const tid = id();
    await q(
      "insert into spa_templates (id, name, document_kind, created_by, created_at) values ($1, $2, 'spa', 'user:x', now())",
      [tid, `T-${++seq}`],
    );
    return tid;
  };
  const upload = async (templateId: string, hash = HASH, declared = true): Promise<string> => {
    const uid = id();
    await q(
      "insert into template_uploads (id, template_id, doc_hash, storage_key, file_name, declared_no_real_data, uploaded_by, uploaded_at) values ($1, $2, $3, 'k', 'f.pdf', $4, 'user:x', now())",
      [uid, templateId, hash, declared],
    );
    return uid;
  };

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("one row per template and file, a sha256 hash, and the box must be ticked", async () => {
    const t = await template();
    await upload(t);
    expect(await refusal(upload(t))).toContain("template_uploads_template_hash_uq");
    expect(await refusal(upload(await template()))).toBe("accepted");
    expect(await refusal(upload(t, "xyz"))).toContain("template_uploads_doc_hash");
    expect(await refusal(upload(t, "b".repeat(64), false))).toContain("template_uploads_declared");
    expect(
      await refusal(
        q(
          "insert into template_uploads (id, template_id, doc_hash, storage_key, file_name, status, declared_no_real_data, uploaded_by, uploaded_at) values ($1, $2, $3, 'k', 'f', 'weird', true, 'u', now())",
          [id(), t, "c".repeat(64)],
        ),
      ),
    ).toContain("template_uploads_status");
  });

  test("only status, reason, version and finish time change; the status moves forward only", async () => {
    const u = await upload(await template());
    expect(await refusal(q("update template_uploads set file_name = 'other.pdf' where id = $1", [u]))).toContain(
      "only the status",
    );
    expect(await refusal(q("update template_uploads set doc_hash = $2 where id = $1", [u, "d".repeat(64)]))).toContain(
      "only the status",
    );
    expect(await refusal(q("update template_uploads set status = 'reading' where id = $1", [u]))).toBe("accepted");
    expect(await refusal(q("update template_uploads set status = 'queued' where id = $1", [u]))).toContain("forward");
    expect(
      await refusal(
        q("update template_uploads set status = 'needs_human', reason = 'r', finished_at = now() where id = $1", [u]),
      ),
    ).toBe("accepted");
    expect(await refusal(q("update template_uploads set status = 'done' where id = $1", [u]))).toContain("forward");
    expect(await refusal(q("update template_uploads set reason = 'again' where id = $1", [u]))).toContain("finished");
  });

  test("an upload can go straight from queued to failed, and is never deleted or truncated", async () => {
    const u = await upload(await template());
    expect(await refusal(q("update template_uploads set status = 'failed', reason = 'x' where id = $1", [u]))).toBe(
      "accepted",
    );
    expect(await refusal(q("delete from template_uploads where id = $1", [u]))).toContain("never deleted");
    expect(await refusal(q("truncate template_uploads"))).toContain("TRUNCATE");
    expect((await q("select count(*)::int as n from template_uploads")).rows[0].n).toBeGreaterThan(0);
  });
});
