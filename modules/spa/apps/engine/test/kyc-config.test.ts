import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { starterKycConfig } from "@spa/core";
import { type SpaDatabase, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { effectiveKycConfig, publishKycDraft, saveKycDraft } from "../src/manager/kyc-config.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ctx = (): SpaContext => ({
  database,
  clock: new FixedClock(new Date("2026-11-19T06:00:00Z")),
  facts: failClosedFacts,
});
const admin = { id: newId(), role: "admin" as const };
const manager = { id: newId(), role: "sales_manager" as const };
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const withHelp = (help: string) => {
  const c = starterKycConfig("buyer_person");
  return { ...c, form: c.form.map((f, i) => (i === 0 ? { ...f, help } : f)) };
};

describe.skipIf(!url)("KYC configs per role (C9)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const u of [admin, manager])
      await database.db.insert(spaUsers).values({ ...u, email: `${u.role}@spa-demo.test`, name: u.role });
  });
  afterAll(async () => {
    await database?.close();
  });

  test("nothing published: the starter config, version 0", async () => {
    const e = await effectiveKycConfig(database.db, "buyer_person", "resale_ready");
    expect([e.version, e.scope]).toEqual([0, "starter"]);
  });

  test("admin saves a draft and publishes versions; others can't; bad configs are refused", async () => {
    expect(await fails(saveKycDraft(ctx(), { role: "buyer_person", config: withHelp("v1") }, manager))).toEqual({
      status: 403,
      code: "forbidden",
    });
    expect(await fails(publishKycDraft(ctx(), { role: "buyer_person" }, admin))).toEqual({
      status: 409,
      code: "no_draft",
    });
    await saveKycDraft(ctx(), { role: "buyer_person", config: withHelp("v1") }, admin);
    expect((await publishKycDraft(ctx(), { role: "buyer_person" }, admin)).version).toBe(1);
    await saveKycDraft(ctx(), { role: "buyer_person", config: withHelp("draft a") }, admin);
    await saveKycDraft(ctx(), { role: "buyer_person", config: withHelp("v2") }, admin);
    expect((await publishKycDraft(ctx(), { role: "buyer_person" }, admin)).version).toBe(2);
    const e = await effectiveKycConfig(database.db, "buyer_person", null);
    expect([e.version, e.config.form[0]!.help]).toEqual([2, "v2"]);
    const bad = {
      ...starterKycConfig("buyer_person"),
      rules: {
        ...starterKycConfig("buyer_person").rules,
        company: [{ id: "x", label: "Only citizens", type: "min_age", years: 21 }],
      },
    };
    expect(await fails(saveKycDraft(ctx(), { role: "buyer_person", config: bad }, admin))).toEqual({
      status: 422,
      code: "invalid_kyc_config",
    });
  });

  test("a deal-type override wins; published versions can't change", async () => {
    await saveKycDraft(ctx(), { role: "seller_person", config: withHelp("any") }, admin);
    await publishKycDraft(ctx(), { role: "seller_person" }, admin);
    await saveKycDraft(
      ctx(),
      { role: "seller_person", dealType: "resale_offplan", config: withHelp("offplan") },
      admin,
    );
    await publishKycDraft(ctx(), { role: "seller_person", dealType: "resale_offplan" }, admin);
    expect((await effectiveKycConfig(database.db, "seller_person", "resale_offplan")).config.form[0]!.help).toBe(
      "offplan",
    );
    expect((await effectiveKycConfig(database.db, "seller_person", "resale_ready")).config.form[0]!.help).toBe("any");
    const r = await database.pool.query("update spa_kyc_configs set values = '{}' where status = 'published'").then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(r).toContain("immutable");
  });

  test("publishing a draft can't swap its saved values (trigger)", async () => {
    await saveKycDraft(ctx(), { role: "buyer_person", config: withHelp("saved") }, admin);
    const r = await database.pool
      .query(
        "update spa_kyc_configs set values = '{}', status = 'published', version = 1, published_at = now() where status = 'draft'",
      )
      .then(
        () => "ok",
        (e: Error) => e.message,
      );
    expect(r).toContain("can't change the saved draft");
  });
});
