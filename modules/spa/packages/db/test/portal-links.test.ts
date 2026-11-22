import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C35 portal links (spa_test)", () => {
  let db: SpaDatabase;
  let dealId: string;
  let partyId: string;
  let n = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const link = async (purpose = "documents", hash = `h${++n}`): Promise<string> => {
    const id = crypto.randomUUID();
    await q(
      "insert into portal_links (id, deal_id, party_id, purpose, token_hash, created_by, created_at) values ($1, $2, $3, $4, $5, 'system', now())",
      [id, dealId, partyId, purpose, hash],
    );
    return id;
  };

  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const listing = (await q("insert into listings (id, ref) values (gen_random_uuid(), 'L-35') returning id")).rows[0]
      .id;
    dealId = (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 100, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
    partyId = (
      await q(
        "insert into parties (id, kind, full_name_en, email, created_at) values (gen_random_uuid(), 'person', 'P', 'p@example.test', now()) returning id",
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("purpose is documents or view, the token hash is unique, one live link per deal, party and purpose", async () => {
    const first = await link("documents");
    expect(await refusal(link("other"))).toContain("portal_links_purpose");
    await q("update portal_links set superseded_at = now() where id = $1", [first]);
    const second = await link("documents", "same");
    expect(await refusal(link("view", "same"))).toContain("portal_links_token_hash_unique");
    await q("update portal_links set superseded_at = now() where id = $1", [second]);
    await link("documents");
    // A second live documents link is refused until the first is used or superseded.
    expect(await refusal(link("documents"))).toContain("portal_links_one_live_uq");
    expect(await refusal(link("view"))).toBe("accepted");
  });

  test("only used_at and superseded_at change, each once; no delete, no truncate", async () => {
    await q("update portal_links set superseded_at = now() where superseded_at is null and purpose = 'documents'");
    const id = await link("documents");
    expect(await refusal(q("update portal_links set purpose = 'view' where id = $1", [id]))).toContain("only used_at");
    expect(await refusal(q("update portal_links set token_hash = 'x' where id = $1", [id]))).toContain("only used_at");
    expect(await refusal(q("update portal_links set expires_at = now() where id = $1", [id]))).toContain(
      "only used_at",
    );
    expect(await refusal(q("update portal_links set used_at = now() where id = $1", [id]))).toBe("accepted");
    expect(
      await refusal(q("update portal_links set used_at = now() + interval '1 day' where id = $1", [id])),
    ).toContain("set once");
    expect(await refusal(q("update portal_links set superseded_at = now() where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update portal_links set superseded_at = null where id = $1", [id]))).toContain("set once");
    expect(await refusal(q("delete from portal_links where id = $1", [id]))).toContain("never deleted");
    expect(await refusal(q("truncate portal_links"))).toContain("refused");
  });
});
