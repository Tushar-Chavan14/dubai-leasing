import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C15 tables (spa_test)", () => {
  let db: SpaDatabase;
  let dealId: string;
  let userId: string;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const doc = async (kind = "noc") =>
    (
      await q(
        "insert into documents (id, deal_id, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at) values (gen_random_uuid(), $1, $2, 'f.pdf', 'application/pdf', 10, 'abc', 'ab/abc.pdf', 'system', now()) returning id",
        [dealId, kind],
      )
    ).rows[0].id as string;
  const noc = (documentId: string, extra = "", status = "review", paid = "null", by = "null") =>
    q(
      `insert into noc_records (id, deal_id, document_id, source, unit_no, seller_names, issued_on, expires_on, service_charges_cleared, paid_fils, paid_confirmed_by, status, entered_by, entered_at${extra ? ", " + extra.split("=")[0] : ""}) values (gen_random_uuid(), $1, $2, 'manual', 'A-1', '{"S One"}', '2026-11-01', '2027-03-01', true, ${paid}, ${by}, '${status}', 'system', now()${extra ? ", " + extra.split("=")[1] : ""})`,
      [dealId, documentId],
    );
  const letter = (kind: string, side: string, documentId: string, amount = "null", conf = "null, null") =>
    q(
      `insert into bank_letters (id, deal_id, side, kind, document_id, issued_on, amount_fils, confirmed_by, confirmed_at, entered_by, entered_at) values (gen_random_uuid(), $1, $2, $3, $4, '2026-11-01', ${amount}, ${conf}, 'system', now())`,
      [dealId, side, kind, documentId],
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
    userId = (
      await q(
        "insert into spa_users (id, email, name, role) values (gen_random_uuid(), 'a@example.test', 'A', 'sales_admin') returning id",
      )
    ).rows[0].id;
  });
  afterAll(async () => {
    await db?.close();
  });

  test("documents: a kind outside the list is refused; update and delete are refused (append-only)", async () => {
    expect(await refusal(doc("selfie"))).toContain("documents_kind");
    const id = await doc("noc");
    expect(await refusal(q("update documents set file_name = 'x' where id = $1", [id]))).toContain("append-only");
    expect(await refusal(q("delete from documents where id = $1", [id]))).toContain("append-only");
  });

  test("noc_records: one current record per deal; a paid amount needs a confirming user", async () => {
    expect(await refusal(noc(await doc(), "", "review", "5000"))).toContain("noc_records_paid_confirmed");
    expect(await refusal(noc(await doc(), "", "review", "5000", `'${userId}'`))).toBe("accepted");
    expect(await refusal(noc(await doc(), "", "matched"))).toContain("noc_records_one_current_uq");
  });

  test("noc_records: only status -> superseded may change", async () => {
    expect(await refusal(q("update noc_records set expires_on = '2030-01-01'"))).toContain("noc_records");
    expect(await refusal(q("update noc_records set paid_fils = 1"))).toContain("noc_records");
    expect(await refusal(q("update noc_records set status = 'matched'"))).toContain("noc_records");
    expect(await refusal(q("delete from noc_records"))).toContain("noc_records");
    expect(await refusal(q("update noc_records set status = 'superseded'"))).toBe("accepted");
    // A new current record may now be entered.
    expect(await refusal(noc(await doc(), "", "matched"))).toBe("accepted");
  });

  test("bank_letters: an amount without confirmed_by and confirmed_at is refused by the CHECK", async () => {
    const d = await doc("liability_letter");
    expect(await refusal(letter("liability_letter", "seller", d, "9000"))).toContain("bank_letters_amount_confirmed");
    expect(await refusal(letter("liability_letter", "seller", d, "9000", `'${userId}', null`))).toContain(
      "bank_letters_amount_confirmed",
    );
    expect(await refusal(letter("liability_letter", "seller", d, "0", `'${userId}', now()`))).toContain(
      "bank_letters_amount_positive",
    );
    expect(await refusal(letter("liability_letter", "seller", d, "9000", `'${userId}', now()`))).toBe("accepted");
  });

  test("bank_letters: a kind must belong to its side; one current letter per kind; confirmed rows are fixed", async () => {
    const d = await doc("pre_approval");
    expect(await refusal(letter("pre_approval", "seller", d))).toContain("bank_letters_kind");
    expect(await refusal(letter("liability_letter", "buyer", d))).toContain("bank_letters_kind");
    expect(await refusal(letter("liability_letter", "seller", d))).toContain("bank_letters_one_current_uq");
    expect(await refusal(q("update bank_letters set amount_fils = 1"))).toContain("bank_letters");
    expect(await refusal(q("delete from bank_letters"))).toContain("bank_letters");
    expect(await refusal(q("update bank_letters set status = 'superseded'"))).toBe("accepted");
  });

  test("deals: the target transfer date, unit and project can change", async () => {
    expect(
      await refusal(q("update deals set target_transfer_on = '2027-01-15', unit_no = 'A-1', project_code = 'P1'")),
    ).toBe("accepted");
  });
});
