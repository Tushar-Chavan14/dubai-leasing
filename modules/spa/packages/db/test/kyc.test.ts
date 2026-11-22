import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C17 tables (spa_test)", () => {
  let db: SpaDatabase;
  let dealId: string;
  let partyId: string;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const doc = (kind: string) =>
    q(
      "insert into documents (id, deal_id, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at) values (gen_random_uuid(), $1, $2, 'f.png', 'image/png', 10, 'abc', 'ab/abc.png', 'system', now())",
      [dealId, kind],
    );
  const helperRun = (status = "ok", visibility = "staff") =>
    q(
      "insert into helper_runs (id, helper, deal_id, entity_kind, entity_id, status, result, reasons, rules_version, visibility, created_at) values (gen_random_uuid(), 'spa_kyc', $1, 'party', $2, $3, '{}', '[]', 'r', $4, now()) returning id",
      [dealId, partyId, status, visibility],
    );
  const kycRun = (status = "passed", role = "buyer_person") =>
    q(
      "insert into kyc_runs (id, deal_id, party_id, role, config_scope, config_version, status, flags, identity, answers, docs_hash, created_at) values (gen_random_uuid(), $1, $2, $3, 'any', 0, $4, '[]', '{}', '{}', 'h', now()) returning id",
      [dealId, partyId, role, status],
    );
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
    const listing = (await q("insert into listings (id, ref) values (gen_random_uuid(), 'L-1') returning id")).rows[0]
      .id;
    dealId = (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 100, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
    partyId = (
      await q(
        "insert into parties (id, kind, full_name_en, email, created_at) values (gen_random_uuid(), 'person', 'Buyer One', 'b@example.test', now()) returning id",
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("documents take the SPA read kinds and still refuse anything else", async () => {
    for (const k of ["passport", "emirates_id_front", "emirates_id_back", "visa", "proof_of_address", "trade_licence"])
      expect(await refusal(doc(k))).toBe("accepted");
    expect(await refusal(doc("selfie"))).toContain("documents_kind");
    expect(await refusal(doc("noc"))).toBe("accepted");
  });

  test("helper_runs: status and visibility are checked; rows are append-only", async () => {
    expect(await refusal(helperRun("ok", "staff"))).toBe("accepted");
    expect(await refusal(helperRun("needs_human", "compliance"))).toBe("accepted");
    expect(await refusal(helperRun("done"))).toContain("helper_runs_status");
    expect(await refusal(helperRun("ok", "public"))).toContain("helper_runs_visibility");
    const id = (await helperRun()).rows[0].id as string;
    expect(await refusal(q("update helper_runs set status = 'needs_human' where id = $1", [id]))).toContain(
      "append-only",
    );
    expect(await refusal(q("delete from helper_runs where id = $1", [id]))).toContain("append-only");
  });

  test("kyc_runs: status and role are checked; rows are immutable", async () => {
    for (const s of ["passed", "review", "blocked", "needs_human"]) expect(await refusal(kycRun(s))).toBe("accepted");
    expect(await refusal(kycRun("approved"))).toContain("kyc_runs_status");
    expect(await refusal(kycRun("passed", "broker"))).toContain("kyc_runs_role");
    const id = (await kycRun()).rows[0].id as string;
    expect(await refusal(q("update kyc_runs set status = 'blocked' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("delete from kyc_runs where id = $1", [id]))).toContain("immutable");
  });

  test("document_requests: one row per deal and party", async () => {
    const ins = () =>
      q(
        "insert into document_requests (id, deal_id, party_id, kyc_role, config_scope, config_version, created_at) values (gen_random_uuid(), $1, $2, 'buyer_person', 'any', 0, now())",
        [dealId, partyId],
      );
    expect(await refusal(ins())).toBe("accepted");
    expect(await refusal(ins())).toContain("document_requests_deal_party_uq");
  });
});
