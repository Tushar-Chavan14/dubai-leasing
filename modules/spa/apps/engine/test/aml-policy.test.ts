import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_AML_POLICY } from "@spa/core";
import { dealEvents, parties, riskAssessments, type SpaDatabase, spaApprovals, spaUsers, units } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { decideApproval } from "../src/manager/approvals.ts";
import { currentAmlPolicy, publishAmlPolicy, recordRiskAssessment } from "../src/manager/aml.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ctx = (): SpaContext => ({
  database,
  clock: new FixedClock(new Date("2026-11-19T06:00:00Z")),
  facts: failClosedFacts,
});
const compliance = { id: newId(), role: "compliance_officer" as const };
const officer = { id: newId(), role: "sales_officer" as const };
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
async function deal() {
  const ids = [newId(), newId()];
  for (const id of ids)
    await database.db.insert(parties).values({
      id,
      kind: "person",
      fullNameEn: "P",
      email: `${id.slice(-6)}@example.test`,
      passportNo: "X1",
      createdAt: new Date(),
    });
  const u = newId();
  await database.db.insert(units).values({ id: u, code: `U-${u.slice(-4)}` });
  const d = await createDeal(
    ctx(),
    {
      dealType: "primary_offplan",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      unitId: u,
      priceFils: 1_000_000_000,
      parties: [
        { role: "buyer", partyId: ids[0]!, order: 1 },
        { role: "seller", partyId: ids[1]!, order: 1 },
      ],
    },
    `user:${officer.id}`,
  );
  return { ...d, buyer: ids[0]! };
}

describe.skipIf(!url)("AML policy and risk (C10)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    for (const u of [compliance, officer])
      await database.db.insert(spaUsers).values({ ...u, email: `${u.role}@spa-demo.test`, name: u.role });
  });
  afterAll(async () => {
    await database?.close();
  });

  test("compliance publishes immutable versions; sales can't", async () => {
    expect((await currentAmlPolicy(database.db)).version).toBe(0);
    expect(
      (await publishAmlPolicy(ctx(), { ...DEFAULT_SPA_AML_POLICY, highRiskCountries: ["XX"] }, compliance)).version,
    ).toBe(1);
    expect(await fails(publishAmlPolicy(ctx(), DEFAULT_SPA_AML_POLICY, officer))).toEqual({
      status: 403,
      code: "forbidden",
    });
    const r = await database.pool.query("update spa_aml_policy set created_by = 'x'").then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(r).toContain("immutable");
  });

  test("a high-risk party opens edd_signoff (neutral title) even without a flag; the result records its versions", async () => {
    const d = await deal();
    const r = await recordRiskAssessment(
      ctx(),
      { dealId: d.id, partyId: d.buyer, hits: [], partyType: "company", paymentMethod: "cash" },
      `user:${officer.id}`,
    );
    expect([r.level, r.flagged, !!r.eddApprovalId]).toEqual(["high", false, true]);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, r.eddApprovalId!));
    expect([a?.gate, a?.approverRole, a?.title]).toEqual(["edd_signoff", "compliance_officer", "Compliance review"]);
    const [row] = await database.db.select().from(riskAssessments).where(eq(riskAssessments.dealId, d.id));
    expect([row?.policyVersion, row?.rulesVersion, row?.level]).toEqual([0, "dubai-sales-2026-01", "high"]);
  });

  test("a low-risk party opens nothing", async () => {
    const d = await deal();
    const r = await recordRiskAssessment(
      ctx(),
      { dealId: d.id, partyId: d.buyer, hits: [], partyType: "person", paymentMethod: "transfer" },
      `user:${officer.id}`,
    );
    expect([r.level, r.eddApprovalId]).toEqual(["medium", undefined]);
  });

  test("a party that isn't on the deal can't be assessed", async () => {
    const d = await deal();
    expect(
      await fails(
        recordRiskAssessment(
          ctx(),
          { dealId: d.id, partyId: newId(), hits: [], partyType: "person", paymentMethod: "transfer" },
          `user:${officer.id}`,
        ),
      ),
    ).toEqual({ status: 422, code: "party_not_on_deal" });
    expect(await database.db.select().from(riskAssessments)).toHaveLength(0);
  });

  test("the timeline names a compliance gate only as compliance_review (S42)", async () => {
    const d = await deal();
    const r = await recordRiskAssessment(
      ctx(),
      { dealId: d.id, partyId: d.buyer, hits: [], partyType: "company", paymentMethod: "cash" },
      `user:${officer.id}`,
    );
    await decideApproval(ctx(), r.eddApprovalId!, compliance, { decision: "approve" });
    const events = (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, d.id))).filter((e) =>
      e.type.startsWith("APPROVAL_"),
    );
    expect(events.map((e) => e.type).toSorted()).toEqual(["APPROVAL_DECIDED", "APPROVAL_PROPOSED"]);
    for (const e of events) expect(e.payload.gate).toBe("compliance_review");
  });
});
