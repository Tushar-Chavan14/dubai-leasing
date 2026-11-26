import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { message?: string }) => e.message ?? "refused",
  );

describe.skipIf(!url)("C38 portal_handoffs (spa_test)", () => {
  let db: SpaDatabase;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("a jti is stored once: a second insert of the same jti conflicts", async () => {
    await q("insert into portal_handoffs (jti, used_at) values ('jti-one-0001', now())");
    expect(await refusal(q("insert into portal_handoffs (jti, used_at) values ('jti-one-0001', now())"))).toContain(
      "portal_handoffs_pkey",
    );
  });
  test("append-only: no update, no delete, no truncate", async () => {
    expect(await refusal(q("update portal_handoffs set used_at = now()"))).toContain("append-only");
    expect(await refusal(q("delete from portal_handoffs"))).toContain("append-only");
    expect(await refusal(q("truncate portal_handoffs"))).toContain("append-only");
    expect((await q("select count(*)::int as n from portal_handoffs")).rows[0].n).toBe(1);
  });
});
