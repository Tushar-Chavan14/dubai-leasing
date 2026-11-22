import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C27 registrations (spa_test)", () => {
  let db: SpaDatabase;
  let seq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`L-${++seq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  const approval = async (dealId: string, o: { gate?: string; status?: string; kind?: string; id?: string } = {}) => {
    const id = o.id ?? crypto.randomUUID();
    await q(
      `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, status, proposed_by, created_at)
       values ($1, $2, $3, $4, $5, 't', '{}', 'sales_admin', $6, 'system', now())`,
      [id, o.gate ?? "transfer_submission", o.kind ?? "deal", dealId, `${id}:k`, o.status ?? "approved"],
    );
    return id;
  };
  const row = async (
    dealId: string,
    approvalId: string,
    o: {
      kind?: string;
      attempt?: number;
      status?: string;
      requestId?: string;
      no?: string | null;
      issuedOn?: string | null;
    } = {},
  ) => {
    const attempt = o.attempt ?? 1;
    const status = o.status ?? "rejected";
    const id = crypto.randomUUID();
    const r = await refusal(
      q(
        `insert into registrations (id, deal_id, kind, attempt, request_id, status, registry_no, issued_on, reasons, approval_id, payload_hash, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, '[]', $9, 'h', now())`,
        [
          id,
          dealId,
          o.kind ?? "trustee_transfer",
          attempt,
          o.requestId ?? `${dealId}:${o.kind ?? "trustee_transfer"}:${attempt}`,
          status,
          o.no === undefined ? null : o.no,
          o.issuedOn === undefined ? null : o.issuedOn,
          approvalId,
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

  test("kind and status are checked; an issued row needs a number and a date", async () => {
    const d = await newDeal();
    const a = await approval(d);
    expect((await row(d, a, { kind: "nope" })).r).toContain("registrations_kind");
    expect((await row(d, a, { status: "nope" })).r).toContain("registrations_status");
    expect((await row(d, a, { status: "issued" })).r).toContain("registrations_issued_needs_number");
    expect((await row(d, a, { status: "issued", no: "SIM-TRF-2026-0000001" })).r).toContain(
      "registrations_issued_needs_number",
    );
    expect((await row(d, a, { status: "rejected", attempt: 1 })).r).toBe("accepted");
  });

  test("an attempt number is unique per deal and kind; a request id is unique", async () => {
    const d = await newDeal();
    const a = await approval(d);
    // Only an answered attempt counts (an "unavailable" one is tried again under the same ids, C21).
    expect((await row(d, a, { attempt: 1, status: "rejected" })).r).toBe("accepted");
    expect((await row(d, a, { attempt: 1, status: "rejected", requestId: "other-1" })).r).toContain(
      "registrations_deal_kind_attempt_uq",
    );
    expect((await row(d, a, { attempt: 2, status: "rejected", requestId: `${d}:trustee_transfer:1` })).r).toContain(
      "registrations_request_id_uq",
    );
    // Another kind has its own attempt 1.
    const b = await approval(d, { gate: "oqood_submission" });
    expect((await row(d, b, { kind: "oqood_register", attempt: 1, status: "unavailable" })).r).toBe("accepted");
  });

  test("one issued row per deal and kind", async () => {
    const d = await newDeal();
    const a = await approval(d);
    const ok = { status: "issued", no: "SIM-TRF-2026-0000101", issuedOn: "2026-11-19" };
    expect((await row(d, a, { ...ok, attempt: 1 })).r).toBe("accepted");
    expect((await row(d, a, { ...ok, no: "SIM-TRF-2026-0000102", attempt: 2 })).r).toContain(
      "registrations_one_issued_uq",
    );
    // A failed attempt may still be recorded beside it, and a different kind may be issued.
    expect((await row(d, a, { attempt: 3, status: "rejected" })).r).toBe("accepted");
    const b = await approval(d, { gate: "transfer_submission" });
    expect((await row(d, b, { ...ok, kind: "oqood_transfer", no: "SIM-TRF-2026-0000103", attempt: 1 })).r).toBe(
      "accepted",
    );
  });

  test("the approval must be an approved gate of the right kind for the same deal (an issued row too)", async () => {
    const d = await newDeal();
    const other = await newDeal();
    const ok = { status: "issued", no: "SIM-OQD-2026-0000201", issuedOn: "2026-11-19", kind: "oqood_register" };
    const pending = await approval(d, { gate: "oqood_submission", status: "pending" });
    const rejected = await approval(d, { gate: "oqood_submission", status: "rejected" });
    const cancelled = await approval(d, { gate: "oqood_submission", status: "cancelled" });
    const wrongGate = await approval(d, { gate: "transfer_submission" });
    const otherDeal = await approval(other, { gate: "oqood_submission" });
    for (const [label, id] of Object.entries({ pending, rejected, cancelled, wrongGate, otherDeal })) {
      const r = await row(d, id, { ...ok, attempt: 1 });
      expect(r.r, label).toContain("registrations: needs an approved");
    }
    // Even a rejected attempt needs its approval.
    expect((await row(d, pending, { kind: "oqood_register", attempt: 2 })).r).toContain("needs an approved");
    expect((await row(d, crypto.randomUUID(), { ...ok, attempt: 3 })).r).toContain("needs an approved");
    const good = await approval(d, { gate: "oqood_submission" });
    expect((await row(d, good, { ...ok, attempt: 1 })).r).toBe("accepted");
    // The other kind of the same gate: trustee and oqood transfer both use transfer_submission.
    const t = await approval(d, { gate: "transfer_submission" });
    expect((await row(d, t, { kind: "trustee_transfer", attempt: 1, status: "rejected" })).r).toBe("accepted");
    expect((await row(d, t, { kind: "oqood_transfer", attempt: 1, status: "rejected" })).r).toBe("accepted");
    // An oqood registration under a transfer gate is refused.
    expect((await row(d, t, { kind: "oqood_register", attempt: 9, status: "rejected" })).r).toContain(
      "needs an approved",
    );
  });

  test("rows are immutable, never deleted and never truncated", async () => {
    const d = await newDeal();
    const a = await approval(d);
    const { id } = await row(d, a, { status: "unavailable" });
    expect(await refusal(q("update registrations set status = 'rejected' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("update registrations set reasons = '[1]' where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("delete from registrations where id = $1", [id]))).toContain("immutable");
    expect(await refusal(q("truncate registrations cascade"))).toContain("immutable");
    expect((await q("select status from registrations where id = $1", [id])).rows[0].status).toBe("unavailable");
  });
});
