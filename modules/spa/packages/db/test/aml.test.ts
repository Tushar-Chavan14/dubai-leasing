import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";
import type { SpaDatabase } from "../src/client.ts";

const url = spaTestDatabaseUrl();

describe.skipIf(!url)("AML screening tables (C18)", () => {
  let db: SpaDatabase;
  let dealId: string;
  let partyId: string;
  const q = (sql: string, params: unknown[] = []) => db.pool.query(sql, params);
  const refusal = (p: Promise<unknown>) =>
    p.then(
      () => "accepted",
      (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
    );
  const screening = (trigger = "offer", party: string | null = partyId, key = partyId) =>
    q(
      "insert into screenings (id, deal_id, party_id, subject_key, trigger, list_version, sanctions_score, pep_score, exact, matches, screened_at) values (gen_random_uuid(), $1, $2, $3, $4, 'v1', 0.2, 0.1, false, '{}', now()) returning id",
      [dealId, party, key, trigger],
    );
  const amlCase = (status = "open") =>
    q(
      "insert into aml_cases (id, deal_id, status, summary, instruction_like, opened_at) values (gen_random_uuid(), $1, $2, 's', false, now()) returning id",
      [dealId, status],
    );
  const hit = (caseId: string, rule = "sanctions", severity = "flag") =>
    q(
      "insert into aml_hits (id, case_id, party_id, subject_key, rule, severity, detail, list_version, created_at) values (gen_random_uuid(), $1, $2, $3, $4, $5, 'd', 'v1', now()) returning id",
      [caseId, partyId, partyId, rule, severity],
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

  test("screenings: trigger is checked; a payer has no party row; rows are append-only", async () => {
    for (const t of ["offer", "before_agreement", "before_transfer", "party_change", "periodic", "manual"])
      expect(await refusal(screening(t))).toBe("accepted");
    expect(await refusal(screening("whenever"))).toContain("screenings_trigger");
    expect(await refusal(screening("manual", null, "payer:some name"))).toBe("accepted");
    const id = (await screening()).rows[0].id as string;
    expect(await refusal(q("update screenings set exact = true where id = $1", [id]))).toContain("append-only");
    expect(await refusal(q("delete from screenings where id = $1", [id]))).toContain("append-only");
    expect(await refusal(q("truncate screenings"))).toContain("append-only");
  });

  test("aml_cases: status is checked and can't be deleted", async () => {
    for (const s of ["open", "info_requested", "cleared", "stopped", "reported"])
      expect(await refusal(amlCase(s))).toBe("accepted");
    expect(await refusal(amlCase("dismissed"))).toContain("aml_cases_status");
    const id = (await amlCase()).rows[0].id as string;
    expect(await refusal(q("delete from aml_cases where id = $1", [id]))).toContain("never deleted");
  });

  test("aml_cases: only the status, approval and closing time change, and a closed case stays closed", async () => {
    const id = (await amlCase()).rows[0].id as string;
    expect(await refusal(q("update aml_cases set summary = 'other' where id = $1", [id]))).toContain("only its status");
    expect(await refusal(q("update aml_cases set instruction_like = true where id = $1", [id]))).toContain(
      "only its status",
    );
    expect(await refusal(q("update aml_cases set status = 'info_requested' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update aml_cases set status = 'open' where id = $1", [id]))).toBe("accepted");
    expect(await refusal(q("update aml_cases set status = 'cleared', closed_at = now() where id = $1", [id]))).toBe(
      "accepted",
    );
    expect(await refusal(q("update aml_cases set status = 'open' where id = $1", [id]))).toContain("closed");
  });

  test("aml_hits: the nine rule codes and two severities only; rows are append-only", async () => {
    const c = (await amlCase()).rows[0].id as string;
    for (const r of [
      "sanctions",
      "pep",
      "third_party_payer",
      "cash",
      "high_risk_country",
      "missing_source_of_funds",
      "complex_ownership",
      "not_screened",
      "unconfirmed",
    ])
      expect(await refusal(hit(c, r))).toBe("accepted");
    expect(await refusal(hit(c, "bad_manners"))).toContain("aml_hits_rule");
    expect(await refusal(hit(c, "pep", "critical"))).toContain("aml_hits_severity");
    const id = (await hit(c)).rows[0].id as string;
    expect(await refusal(q("update aml_hits set severity = 'warning' where id = $1", [id]))).toContain("append-only");
    expect(await refusal(q("delete from aml_hits where id = $1", [id]))).toContain("append-only");
  });
});
