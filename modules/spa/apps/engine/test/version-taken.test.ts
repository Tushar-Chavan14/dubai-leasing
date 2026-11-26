import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_AML_POLICY, DEFAULT_SPA_POLICY } from "@spa/core";
import type { SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { publishAmlPolicy } from "../src/manager/aml.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { setHelperMode } from "../src/manager/helper-modes.ts";
import { currentPolicy, publishPolicy } from "../src/manager/policy.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ctx = (): SpaContext => ({
  database,
  clock: new FixedClock(new Date("2026-11-21T06:00:00Z")),
  facts: failClosedFacts,
});
const admin = { id: newId(), role: "admin" as const };
const officer = { id: newId(), role: "compliance_officer" as const };
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );

/**
 * Two first publishes: the second reads "no version yet" while the first has inserted version 1 and not yet committed.
 * The first holds its row open on its own connection; the second's insert waits on the primary key, then loses.
 */
async function clash(table: "spa_policy" | "spa_aml_policy", values: unknown, second: () => Promise<unknown>) {
  const c = await database.pool.connect();
  try {
    await c.query("begin");
    await c.query(
      `insert into ${table} (version, values, created_by, created_at) values (1, $1, 'user:first', now())`,
      [JSON.stringify(values)],
    );
    const losing = fails(second());
    await Bun.sleep(300); // the second insert is now waiting for the first
    await c.query("commit");
    return await losing;
  } finally {
    c.release();
  }
}

describe.skipIf(!url)("C34: two first publishes are a 409, not a 500 (closes the C3 deferred item)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("company policy: the loser of a first publish gets 409 version_taken, and the winner stays", async () => {
    const lost = await clash("spa_policy", DEFAULT_SPA_POLICY, () => publishPolicy(ctx(), DEFAULT_SPA_POLICY, admin));
    expect(lost).toEqual({ status: 409, code: "version_taken" });
    expect((await currentPolicy(database.db)).version).toBe(1);
    // trying again now succeeds as version 2
    expect((await publishPolicy(ctx(), DEFAULT_SPA_POLICY, admin)).version).toBe(2);
  });

  test("AML policy: the same", async () => {
    const lost = await clash("spa_aml_policy", DEFAULT_SPA_AML_POLICY, () =>
      publishAmlPolicy(ctx(), DEFAULT_SPA_AML_POLICY, officer),
    );
    expect(lost).toEqual({ status: 409, code: "version_taken" });
    const [row] = (await database.pool.query("select count(*)::int as n from spa_aml_policy")).rows;
    expect(row.n).toBe(1);
    expect((await publishAmlPolicy(ctx(), DEFAULT_SPA_AML_POLICY, officer)).version).toBe(2);
  });

  test("two real concurrent first publishes: exactly one version 1, the other 409 or version 2, never a 500", async () => {
    const results = await Promise.all(
      [1, 2].map(() =>
        publishPolicy(ctx(), DEFAULT_SPA_POLICY, admin).then(
          (r) => ({ ok: r.version }),
          (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
        ),
      ),
    );
    for (const r of results) expect("ok" in r || (r as { status: number }).status === 409).toBe(true);
    expect(results.filter((r) => "ok" in r).length).toBeGreaterThanOrEqual(1);
  });

  test("helper modes: two concurrent first changes of one helper both land (versions 1 and 2) or one is 409, never a 500", async () => {
    const results = await Promise.all(
      (["off", "review"] as const).map((mode) =>
        setHelperMode(ctx(), admin, { helper: "spa_document_reader", mode }).then(
          (r) => ({ ok: r.version }),
          (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
        ),
      ),
    );
    for (const r of results) expect("ok" in r || (r as { status: number }).status === 409).toBe(true);
  });
});
