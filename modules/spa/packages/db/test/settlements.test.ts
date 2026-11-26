import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { SpaDatabase } from "../src/index.ts";
import { freshSpaDatabase, spaTestDatabaseUrl } from "../src/testing.ts";

const url = spaTestDatabaseUrl();
const refusal = (p: Promise<unknown>): Promise<string> =>
  p.then(
    () => "accepted",
    (e: { constraint?: string; message?: string }) => `${e.constraint ?? ""} ${e.message ?? ""}`,
  );

describe.skipIf(!url)("C16 settlement tables (spa_test)", () => {
  let db: SpaDatabase;
  let listingSeq = 0;
  const q = (sql: string, args: unknown[] = []) => db.pool.query(sql, args);
  /** Inserts a statement and its lines in one transaction; the deferred balance check runs at COMMIT. */
  const statement = async (o: {
    dealId: string;
    version: number;
    status?: string;
    price?: number;
    lines: [code: string, amount: number][];
  }): Promise<{ id: string; result: string }> => {
    const client = await db.pool.connect();
    const id = crypto.randomUUID();
    try {
      await client.query("begin");
      await client.query(
        `insert into settlements (id, deal_id, version, status, rules_version, policy_version, input, input_hash, price_fils, buyer_pays_fils, seller_receives_fils, created_by, created_at)
         values ($1, $2, $3, $4, 'r', 0, '{}', 'h', $5, $5, $5, 'system:settlement', now())`,
        [id, o.dealId, o.version, o.status ?? "proposed", o.price ?? 1000],
      );
      let seq = 1;
      for (const [code, amount] of o.lines)
        await client.query(
          `insert into settlement_lines (settlement_id, seq, code, payer, payee, label, amount_fils, source) values ($1, $2, $3, 'buyer', 'seller', 'x', $4, 'deal: price')`,
          [id, seq++, code, amount],
        );
      await client.query("commit");
      return { id, result: "accepted" };
    } catch (e) {
      await client.query("rollback").catch(() => {});
      return { id, result: (e as { message?: string }).message ?? "refused" };
    } finally {
      client.release();
    }
  };
  /** A deal of price 1000 fils on its own listing, so each test starts with no statement. */
  const newDeal = async (): Promise<string> => {
    const listing = (
      await q("insert into listings (id, ref) values (gen_random_uuid(), $1) returning id", [`L-${++listingSeq}`])
    ).rows[0].id;
    return (
      await q(
        "insert into deals (id, deal_type, listing_id, price_fils, created_by, rules_version) values (gen_random_uuid(), 'resale_ready', $1, 1000, 'system', 'r') returning id",
        [listing],
      )
    ).rows[0].id;
  };
  beforeAll(async () => {
    db = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await db?.close();
  });

  test("a hand-inserted unbalanced proposed statement is refused at commit; a balanced one is accepted", async () => {
    const dealId = await newDeal();
    expect((await statement({ dealId, version: 1, lines: [["price:balance_to_seller", 999]] })).result).toContain(
      "price lines add up to 999, not 1000",
    );
    expect((await statement({ dealId, version: 1, lines: [] })).result).toContain("add up to 0, not 1000");
    // Fee and commission lines don't count towards the price.
    expect(
      (
        await statement({
          dealId,
          version: 1,
          lines: [
            ["price:balance_to_seller", 1000],
            ["fee:dld_fee", 40],
          ],
        })
      ).result,
    ).toBe("accepted");
  });

  test("the statement price must equal the deal's price", async () => {
    expect(
      (
        await statement({
          dealId: await newDeal(),
          version: 1,
          price: 900,
          lines: [["price:balance_to_seller", 900]],
        })
      ).result,
    ).toContain("differs from the deal price");
  });

  test("one proposed or approved statement per deal; a version number is used once", async () => {
    const dealId = await newDeal();
    expect((await statement({ dealId, version: 1, lines: [["price:balance_to_seller", 1000]] })).result).toBe(
      "accepted",
    );
    expect((await statement({ dealId, version: 2, lines: [["price:balance_to_seller", 1000]] })).result).toContain(
      "settlements_one_live_uq",
    );
    expect((await statement({ dealId, version: 1, status: "superseded", lines: [] })).result).toContain(
      "settlements_deal_version_uq",
    );
  });

  test("content is fixed; only status moves along its allowed path; the approval is linked once; no deletes", async () => {
    const s = await statement({ dealId: await newDeal(), version: 1, lines: [["price:balance_to_seller", 1000]] });
    const upd = (set: string) => refusal(q(`update settlements set ${set} where id = $1`, [s.id]));
    expect(await upd("price_fils = 999")).toContain("fixed");
    expect(await upd("input_hash = 'other'")).toContain("fixed");
    expect(await upd("rules_version = 'x'")).toContain("fixed");
    expect(await refusal(q("delete from settlements where id = $1", [s.id]))).toContain("never deleted");
    expect(await refusal(q("truncate settlements"))).toMatch(/append-only|foreign key/);
    expect(await upd("status = 'bogus'")).toContain("cannot become");
    // Approved only through its own approved settlement_approval of this deal (review 12).
    expect(await upd("status = 'approved', decided_at = now()")).toContain("settlement_approval");
    // The approval is linked once (null to a value), then fixed.
    const approval = (
      await q(
        `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, proposed_by, status, created_at)
         select gen_random_uuid(), 'settlement_approval', 'deal', deal_id, 'k:' || id, 't', '{}', 'finance', 'system:settlement', 'approved', now() from settlements where id = $1 returning id`,
        [s.id],
      )
    ).rows[0].id;
    expect(await upd(`approval_id = '${approval}'`)).toBe("accepted");
    expect(await upd("status = 'approved', decided_at = now()")).toBe("accepted");
    expect(await upd("status = 'proposed'")).toContain("cannot become");
    expect(await upd("approval_id = null")).toContain("linked once");
    expect(await upd("status = 'stale'")).toBe("accepted");
    // stale is final
    expect(await upd("status = 'approved'")).toContain("cannot become");
    expect(await upd("status = 'superseded'")).toContain("cannot become");
  });

  test("lines are insert-only, positive, and added only to a proposed statement", async () => {
    const s = await statement({ dealId: await newDeal(), version: 1, lines: [["price:balance_to_seller", 1000]] });
    expect(s.result).toBe("accepted");
    expect(await refusal(q("update settlement_lines set amount_fils = 1 where settlement_id = $1", [s.id]))).toContain(
      "never changed",
    );
    expect(await refusal(q("delete from settlement_lines where settlement_id = $1", [s.id]))).toContain(
      "never changed",
    );
    expect(await refusal(q("truncate settlement_lines"))).toContain("append-only");
    expect(
      await refusal(
        q(
          "insert into settlement_lines (settlement_id, seq, code, payer, payee, label, amount_fils, source) values ($1, 9, 'fee:x', 'buyer', 'dld', 'x', 0, 's')",
          [s.id],
        ),
      ),
    ).toContain("settlement_lines_amount_positive");
    const approval = (
      await q(
        `insert into spa_approvals (id, gate, entity_kind, entity_id, dedupe_key, title, proposal, approver_role, proposed_by, status, created_at)
         select gen_random_uuid(), 'settlement_approval', 'deal', deal_id, 'k:' || id, 't', '{}', 'finance', 'system:settlement', 'approved', now() from settlements where id = $1 returning id`,
        [s.id],
      )
    ).rows[0].id;
    await q("update settlements set approval_id = $2 where id = $1", [s.id, approval]);
    await q("update settlements set status = 'approved' where id = $1", [s.id]);
    expect(
      await refusal(
        q(
          "insert into settlement_lines (settlement_id, seq, code, payer, payee, label, amount_fils, source) values ($1, 9, 'fee:x', 'buyer', 'dld', 'x', 5, 's')",
          [s.id],
        ),
      ),
    ).toContain("only to a proposed statement");
  });
});
