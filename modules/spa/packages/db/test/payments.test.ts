import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );
const IBAN = "AE070331234567890123456";

describe.skipIf(!url)("C22 payments, escrow accounts, tasks, default flag (spa_test)", () => {
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
  const doc = async (dealId: string): Promise<{ documentId: string; readId: string }> => {
    const documentId = crypto.randomUUID();
    await q(
      `insert into documents (id, deal_id, kind, file_name, mime, size_bytes, sha256, storage_key, uploaded_by, uploaded_at)
       values ($1, $2, 'payment_receipt', 'r.png', 'image/png', 10, $3, $3, 'u', now())`,
      [documentId, dealId, documentId],
    );
    const runId = crypto.randomUUID();
    await q(
      `insert into helper_runs (id, helper, deal_id, entity_kind, entity_id, status, result, reasons, prompt_version, rules_version, visibility, created_at)
       values ($1, 'spa_document_reader', $2, 'document', $3, 'ok', '{}', '[]', 'p', 'r', 'staff', now())`,
      [runId, dealId, documentId],
    );
    const readId = crypto.randomUUID();
    await q(
      `insert into document_reads (id, document_id, profile, fields, prompt_version, run_id, read_at)
       values ($1, $2, 'payment_receipt', '{}', 'p', $3, now())`,
      [readId, documentId, runId],
    );
    return { documentId, readId };
  };
  const payment = async (
    dealId: string,
    o: {
      status?: string;
      amount?: number | null;
      read?: number | null;
      by?: string | null;
      at?: boolean;
      escrow?: boolean;
      method?: string;
      docs?: { documentId: string; readId: string };
    } = {},
  ) => {
    const d = o.docs ?? (await doc(dealId));
    const id = crypto.randomUUID();
    const by = o.by === undefined ? null : o.by;
    const r = await refusal(
      q(
        `insert into payments (id, deal_id, seq, document_id, read_id, status, method, amount_read_fils, amount_fils, into_escrow,
                               payer_is_buyer, confirmed_by, confirmed_at, registered_by, created_at)
         values ($1, $2, 1, $3, $4, $5, $6, $7, $8, $9, true, $10, $11, 'u', now())`,
        [
          id,
          dealId,
          d.documentId,
          d.readId,
          o.status ?? "read",
          o.method ?? "transfer",
          o.read === undefined ? 500 : o.read,
          o.amount === undefined ? null : o.amount,
          o.escrow ?? true,
          by,
          by && o.at !== false ? new Date() : null,
        ],
      ),
    );
    return { id, r };
  };
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  // ---- escrow accounts --------------------------------------------------------------------------------------------

  const escrow = (project: string, iban = IBAN, superseded = false) =>
    refusal(
      q(
        `insert into project_escrow_accounts (id, project_code, account_holder, iban, bank_name, entered_by, valid_from, superseded_at)
         values (gen_random_uuid(), $1, 'Escrow Holder', $2, 'Fictional Bank', 'u', now(), $3)`,
        [project, iban, superseded ? new Date() : null],
      ),
    );
  test("an escrow IBAN must be AE plus 21 digits; one current account per project", async () => {
    expect(await escrow("P1", "GB29NWBK60161331926819")).toContain("project_escrow_accounts_iban");
    expect(await escrow("P1", "AE07033123456789012345")).toContain("project_escrow_accounts_iban");
    expect(await escrow("P1", "ae070331234567890123456")).toContain("project_escrow_accounts_iban");
    expect(await escrow("P1")).toBe("accepted");
    expect(await escrow("P1", "AE070331234567890123457")).toContain("project_escrow_accounts_current_uq");
    expect(await escrow("P2")).toBe("accepted");
    // A superseded row of the same project doesn't count as current.
    expect(await escrow("P1", IBAN, true)).toBe("accepted");
  });
  test("escrow accounts are append-only: only superseded_at is set, once; never deleted or truncated", async () => {
    await escrow("P3");
    expect(
      await refusal(q("update project_escrow_accounts set iban = 'AE070331234567890123457' where project_code = 'P3'")),
    ).toContain("append-only");
    expect(
      await refusal(q("update project_escrow_accounts set project_code = 'P3b' where project_code = 'P3'")),
    ).toContain("append-only");
    expect(await refusal(q("update project_escrow_accounts set superseded_at = now() where project_code = 'P3'"))).toBe(
      "accepted",
    );
    expect(
      await refusal(q("update project_escrow_accounts set superseded_at = null where project_code = 'P3'")),
    ).toContain("append-only");
    expect(await refusal(q("delete from project_escrow_accounts where project_code = 'P3'"))).toContain("append-only");
    expect(await refusal(q("truncate project_escrow_accounts"))).toContain("append-only");
  });

  // ---- payments ---------------------------------------------------------------------------------------------------

  test("status and method are checked, amounts are above zero", async () => {
    const d = await newDeal();
    expect((await payment(d, { status: "nope" })).r).toContain("payments_status");
    expect((await payment(d, { method: "barter" })).r).toContain("payments_method");
    expect((await payment(d, { read: 0 })).r).toContain("payments_amount_read_positive");
    expect((await payment(d, { read: null })).r).toBe("accepted");
    expect((await payment(d, { status: "not_counted", escrow: false })).r).toBe("accepted");
  });
  test("a read amount never counts: counted needs amount, confirmer and escrow; an amount needs a confirmer", async () => {
    const d = await newDeal();
    const confirm = (id: string, set: string) =>
      refusal(q(`update payments set status = 'counted'${set} where id = $1`, [id]));
    const { id } = await payment(d, { status: "read", read: 500 });
    expect(await confirm(id, "")).toContain("payments_counted_needs_confirmation");
    expect(await confirm(id, ", amount_fils = 500")).toMatch(
      /payments_(counted_needs_confirmation|amount_needs_confirmer)/,
    );
    expect(await confirm(id, ", confirmed_by = 'user:f', confirmed_at = now()")).toContain(
      "payments_counted_needs_confirmation",
    );
    // Money to an account that isn't the escrow account is never counted, whoever confirms it.
    const off = await payment(d, { status: "read", escrow: false });
    expect(await confirm(off.id, ", amount_fils = 500, confirmed_by = 'user:f', confirmed_at = now()")).toContain(
      "payments_counted_needs_confirmation",
    );
    expect((await payment(d, { status: "read", amount: 500 })).r).toContain("payments_amount_needs_confirmer");
    expect((await payment(d, { status: "read", amount: 0, by: "user:f" })).r).toContain("payments_amount_positive");
    expect((await payment(d, { status: "read", by: "user:f", at: false })).r).toContain("payments_confirmation_pair");
  });
  test("a row is inserted unconfirmed: a counted row can't be written directly", async () => {
    const d = await newDeal();
    const x = await payment(d, { status: "counted", amount: 500, by: "user:f" });
    expect(x.r).toContain("inserted unconfirmed");
  });
  test("a payment changes only through counted: status, amount and confirmation, nothing else", async () => {
    const d = await newDeal();
    const { id, r } = await payment(d, { status: "read" });
    expect(r).toBe("accepted");
    expect(await refusal(q("update payments set amount_read_fils = 9 where id = $1", [id]))).toContain("payments");
    expect(await refusal(q("update payments set into_escrow = false where id = $1", [id]))).toContain("payments");
    expect(await refusal(q("update payments set status = 'not_counted' where id = $1", [id]))).toContain("payments");
    expect(await refusal(q("update payments set status = 'counted' where id = $1", [id]))).toContain(
      "payments_counted_needs_confirmation",
    );
    expect(
      await refusal(
        q(
          "update payments set status = 'counted', amount_fils = 500, confirmed_by = 'user:f', confirmed_at = now() where id = $1",
          [id],
        ),
      ),
    ).toBe("accepted");
    // Counted is final.
    expect(await refusal(q("update payments set amount_fils = 400 where id = $1", [id]))).toContain("payments");
    expect(await refusal(q("delete from payments where id = $1", [id]))).toContain("payments");
    expect(await refusal(q("truncate payments"))).toContain("payments");
  });
  test("a payment to a non-escrow account can't be counted even by hand", async () => {
    const d = await newDeal();
    const { id } = await payment(d, { status: "not_counted", escrow: false });
    expect(
      await refusal(
        q(
          "update payments set status = 'counted', amount_fils = 500, confirmed_by = 'user:f', confirmed_at = now() where id = $1",
          [id],
        ),
      ),
    ).toContain("payments");
  });
  test("one payment per receipt document", async () => {
    const d = await newDeal();
    const docs = await doc(d);
    expect((await payment(d, { docs })).r).toBe("accepted");
    expect((await payment(d, { docs })).r).toContain("payments_document_uq");
  });
  test("a payment is for a plan row of its own deal", async () => {
    const d = await newDeal();
    const docs = await doc(d);
    const r = await refusal(
      q(
        `insert into payments (id, deal_id, seq, document_id, read_id, status, method, into_escrow, payer_is_buyer, registered_by, created_at)
         values (gen_random_uuid(), $1, 9, $2, $3, 'read', 'transfer', true, true, 'u', now())`,
        [d, docs.documentId, docs.readId],
      ),
    );
    expect(r).toContain("payments_plan_row_fk");
  });

  // ---- tasks ------------------------------------------------------------------------------------------------------

  const task = (
    dealId: string | null,
    key: string,
    o: { status?: string; kind?: string; role?: string; done?: boolean } = {},
  ) =>
    refusal(
      q(
        `insert into spa_tasks (id, deal_id, kind, role, title, detail, status, dedupe_key, created_at, done_at, done_by)
         values (gen_random_uuid(), $1, $2, $3, 't', '{}', $4, $5, now(), $6, $7)`,
        [
          dealId,
          o.kind ?? "default_flagged",
          o.role ?? "sales_manager",
          o.status ?? "open",
          key,
          o.done ? new Date() : null,
          o.done ? "user:x" : null,
        ],
      ),
    );
  test("a task has a known kind, role and status; one open task per dedupe key", async () => {
    const d = await newDeal();
    expect(await task(d, "k1", { kind: "nope" })).toContain("spa_tasks_kind");
    expect(await task(d, "k1", { role: "nope" })).toContain("spa_tasks_role");
    expect(await task(d, "k1", { status: "nope", done: true })).toContain("spa_tasks_status");
    expect(await task(d, "k1", { status: "done" })).toContain("spa_tasks_done_needs_who");
    expect(await task(d, "k1")).toBe("accepted");
    expect(await task(d, "k1")).toContain("spa_tasks_open_dedupe_uq");
    // A finished task frees the key.
    expect(await task(d, "k1", { status: "done", done: true })).toBe("accepted");
  });
  test("a task changes only open to done or cancelled; never deleted", async () => {
    const d = await newDeal();
    await task(d, "k2");
    expect(await refusal(q("update spa_tasks set title = 'x' where dedupe_key = 'k2'"))).toContain("spa_tasks");
    expect(await refusal(q("update spa_tasks set role = 'admin' where dedupe_key = 'k2'"))).toContain("spa_tasks");
    expect(
      await refusal(
        q("update spa_tasks set status = 'done', done_at = now(), done_by = 'user:x' where dedupe_key = 'k2'"),
      ),
    ).toBe("accepted");
    expect(
      await refusal(q("update spa_tasks set status = 'open', done_at = null, done_by = null where dedupe_key = 'k2'")),
    ).toContain("spa_tasks");
    expect(await refusal(q("delete from spa_tasks where dedupe_key = 'k2'"))).toContain("spa_tasks");
    expect(await refusal(q("truncate spa_tasks cascade"))).toContain("spa_tasks");
  });

  // ---- deals ------------------------------------------------------------------------------------------------------

  test("in_default needs a date and a known reason", async () => {
    const d = await newDeal();
    expect((await q("select in_default from deals where id = $1", [d])).rows[0].in_default).toBe(false);
    expect(await refusal(q("update deals set in_default = true where id = $1", [d]))).toContain(
      "deals_default_needs_date",
    );
    expect(
      await refusal(
        q(
          "update deals set in_default = true, in_default_since = '2026-12-01', in_default_reason = 'x' where id = $1",
          [d],
        ),
      ),
    ).toContain("deals_default_reason");
    expect(
      await refusal(
        q(
          "update deals set in_default = true, in_default_since = '2026-12-01', in_default_reason = 'overdue' where id = $1",
          [d],
        ),
      ),
    ).toBe("accepted");
  });

  test("documents and reads accept the payment receipt kind and profile", async () => {
    const d = await newDeal();
    const docs = await doc(d);
    expect(docs.readId).toBeTruthy();
  });
});
