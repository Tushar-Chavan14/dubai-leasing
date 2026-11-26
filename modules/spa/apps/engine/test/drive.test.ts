import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import type { DealFacts } from "@spa/core";
import { dealEvents, deals, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { driveDeal } from "../src/manager/drive.ts";
import { failClosedFacts, type FactsLoader } from "../src/manager/facts.ts";
import { dealInDraft } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
afterAll(async () => {
  await database?.close();
});
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let override: Partial<DealFacts> = {};
const facts: FactsLoader = {
  deal: async (tx, row, today) => ({ ...(await failClosedFacts.deal(tx, row, today)), ...override }),
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};
const ctx = (): SpaContext => ({ database, clock, facts });
const ALL_CHECKS: Partial<DealFacts> = {
  documentsRequested: true,
  kycOk: true,
  hasCompanyParty: false,
  companyChecksOk: true,
  ownershipOk: true,
  openAmlFlag: false,
};
const dealIn = async (state: string, type: "primary_offplan" | "resale_ready" = "resale_ready") => {
  const { dealId } = await dealInDraft(ctx(), database, { type });
  await database.db
    .update(deals)
    .set({ state: state as never })
    .where(eq(deals.id, dealId));
  return dealId;
};
const stateOf = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const moves = (id: string) =>
  database.db
    .select()
    .from(dealEvents)
    .where(and(eq(dealEvents.entityId, id)))
    .then((r) => r.filter((e) => e.actor === "system:driver").map((e) => [e.type, e.actor, e.toState]));

describe.skipIf(!url)("driveDeal (C24, S59)", () => {
  beforeEach(async () => {
    override = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
  });

  test("OFFER_AGREED with the documents requested starts the checks, as system:driver", async () => {
    const id = await dealIn("OFFER_AGREED");
    override = { documentsRequested: false };
    await driveDeal(ctx(), id);
    expect(await stateOf(id)).toBe("OFFER_AGREED");
    override = { documentsRequested: true, kycOk: false };
    await driveDeal(ctx(), id);
    expect(await stateOf(id)).toBe("PARTY_CHECK");
    expect(await moves(id)).toEqual([["CHECKS_STARTED", "system:driver", "PARTY_CHECK"]]);
  });

  test("it takes both steps in one call when the facts allow, and stops where they don't", async () => {
    const id = await dealIn("OFFER_AGREED");
    override = ALL_CHECKS;
    expect(await driveDeal(ctx(), id)).toEqual({ moved: ["CHECKS_STARTED", "CHECKS_PASSED"] });
    expect(await stateOf(id)).toBe("AGREEMENT_DRAFT");
    const other = await dealIn("OFFER_AGREED");
    override = { ...ALL_CHECKS, kycOk: false };
    expect(await driveDeal(ctx(), other)).toEqual({ moved: ["CHECKS_STARTED"] });
    expect(await stateOf(other)).toBe("PARTY_CHECK");
  });

  test("each fact that CHECKS_PASSED needs holds the deal in PARTY_CHECK: KYC, company checks, ownership, an open flag", async () => {
    for (const miss of [
      { kycOk: false },
      { hasCompanyParty: true, companyChecksOk: false },
      { ownershipOk: false },
      { openAmlFlag: true },
    ] as Partial<DealFacts>[]) {
      const id = await dealIn("PARTY_CHECK");
      override = { ...ALL_CHECKS, ...miss };
      expect(await driveDeal(ctx(), id)).toEqual({ moved: [] });
      expect(await stateOf(id)).toBe("PARTY_CHECK");
    }
    // Ownership is a resale's fact only: a primary deal doesn't need it.
    const primary = await dealIn("PARTY_CHECK", "primary_offplan");
    override = { ...ALL_CHECKS, ownershipOk: false };
    await driveDeal(ctx(), primary);
    expect(await stateOf(primary)).toBe("AGREEMENT_DRAFT");
  });

  test("it is idempotent: a second call moves nothing and writes no second event", async () => {
    const id = await dealIn("OFFER_AGREED");
    override = ALL_CHECKS;
    await driveDeal(ctx(), id);
    expect(await driveDeal(ctx(), id)).toEqual({ moved: [] });
    expect((await moves(id)).map((m) => m[0])).toEqual(["CHECKS_STARTED", "CHECKS_PASSED"]);
  });

  test("it never moves a deal past PARTY_CHECK, out of a hold, or through a gate, whatever the facts say", async () => {
    override = { ...ALL_CHECKS, agreementPrepared: true, allSigned: true, nocOk: true, statementBalanced: true };
    for (const s of [
      "AML_HOLD",
      "AGREEMENT_DRAFT",
      "LEGAL_REVIEW",
      "SIGNING",
      "NOC",
      "SETTLEMENT",
      "CANCELLED",
      "COMPLETED",
    ]) {
      const id = await dealIn(s);
      expect(await driveDeal(ctx(), id)).toEqual({ moved: [] });
      expect(await stateOf(id)).toBe(s as never);
    }
  });

  test("an unknown deal is a plain 404 and a throwing facts loader moves nothing", async () => {
    expect(
      await driveDeal(ctx(), newId()).then(
        () => null,
        (e: { status?: number }) => e.status,
      ),
    ).toBe(404);
    const id = await dealIn("OFFER_AGREED");
    const broken: SpaContext = {
      ...ctx(),
      facts: { ...facts, deal: async () => Promise.reject(new Error("down")) },
    };
    await expect(driveDeal(broken, id)).rejects.toThrow("down");
    expect(await stateOf(id)).toBe("OFFER_AGREED");
  });
});
