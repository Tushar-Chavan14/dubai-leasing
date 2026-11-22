import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { beneficialOwners, dealEvents, dealParties, deals, signatories, type SpaDatabase, units } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { addBeneficialOwner, addSignatory, companyKind, createParty, setCompany } from "../src/manager/parties.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const ctx = (): SpaContext => ({
  database,
  clock: new FixedClock(new Date("2026-11-18T06:00:00Z")),
  facts: failClosedFacts,
});
const actor = "user:00000000-0000-7000-8000-0000000000aa" as const;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const person = (name: string) =>
  createParty(
    ctx(),
    {
      kind: "person",
      fullNameEn: name,
      nationality: "Testland",
      email: `${name.replace(/\s/g, "")}@example.test`,
      passportNo: "N1234567",
    },
    actor,
  );
const company = () =>
  createParty(
    ctx(),
    {
      kind: "company",
      email: "co@example.test",
      details: {
        tradeName: "Fictional Holdings",
        licenceNo: "[LICENCE NO.]",
        licenceExpiresOn: "2027-06-30",
        issuingAuthority: "DED",
      },
    },
    actor,
  );

describe.skipIf(!url)("companies and parties (C4)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("a company buyer with a signatory and two beneficial owners round-trips", async () => {
    const co = await company();
    const [a, b] = [await person("Owner One"), await person("Owner Two")];
    await addSignatory(
      ctx(),
      {
        companyPartyId: co.id,
        personPartyId: a.id,
        title: "Director",
        authority: "board_resolution",
        documentId: newId(),
      },
      actor,
    );
    await addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: a.id, shareBps: 2500 }, actor);
    await addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: b.id, shareBps: 4000 }, actor);
    expect(await database.db.select().from(signatories).where(eq(signatories.companyPartyId, co.id))).toHaveLength(1);
    expect((await database.db.select().from(beneficialOwners)).map((o) => o.shareBps).toSorted()).toEqual([2500, 4000]);
  });
  test("owners over 100% and a company as a signatory are refused", async () => {
    const co = await company();
    const p = await person("Owner One");
    await addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: p.id, shareBps: 9000 }, actor);
    const q = await person("Owner Two");
    expect(
      await fails(addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: q.id, shareBps: 2000 }, actor)),
    ).toEqual({ status: 422, code: "owners_over_100" });
    const other = await company();
    expect(
      await fails(
        addSignatory(
          ctx(),
          { companyPartyId: co.id, personPartyId: other.id, title: "x", authority: "poa", documentId: newId() },
          actor,
        ),
      ),
    ).toEqual({ status: 422, code: "signatory_not_person" });
  });
  test("party events never carry ID numbers in clear", async () => {
    const p = await person("Sample Buyer");
    const [e] = await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, p.id));
    expect(e?.type).toBe("PARTY_CREATED");
    expect(JSON.stringify(e?.payload)).not.toContain("N1234567");
    // review #4: the append-only log carries no name, nationality, birth date or email (the party row holds them).
    expect(e?.payload).toEqual({ kind: "person" });
  });
  test("company kind: both until set", async () => {
    expect(await companyKind(database.db)).toBe("both");
    await setCompany(ctx(), { name: "Fictional Developments", kind: "developer" }, actor);
    expect(await companyKind(database.db)).toBe("developer");
  });
  test("deals store their parties; an unknown party is refused", async () => {
    const unitId = newId();
    await database.db.insert(units).values({ id: unitId, code: "U-1" });
    const [buyer, seller] = [await person("Sample Buyer"), await company()];
    const input = (sellerId: string) => ({
      dealType: "primary_offplan",
      sellerMortgage: false,
      buyerMortgage: false,
      planTakenOver: false,
      unitId,
      priceFils: 1_000_000,
      parties: [
        { role: "buyer", partyId: buyer.id, order: 1, shareBps: 10_000 },
        { role: "seller", partyId: sellerId, order: 1, shareBps: 10_000 },
      ],
    });
    expect(await fails(createDeal(ctx(), input(newId()), actor))).toEqual({ status: 422, code: "unknown_party" });
    expect(await database.db.select().from(deals)).toHaveLength(0);
    const d = await createDeal(ctx(), input(seller.id), actor);
    expect(
      (await database.db.select().from(dealParties).where(eq(dealParties.dealId, d.id))).map((r) => r.role).toSorted(),
    ).toEqual(["buyer", "seller"]);
  });
  test("C9 deferred: a duplicate beneficial owner is a 422; one company row however often it is set", async () => {
    const co = await company();
    const p = await person("Owner One");
    await addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: p.id, shareBps: 2500 }, actor);
    expect(
      await fails(addBeneficialOwner(ctx(), { companyPartyId: co.id, personPartyId: p.id, shareBps: 1000 }, actor)),
    ).toEqual({ status: 422, code: "owner_exists" });
    await Promise.all([1, 2, 3].map((i) => setCompany(ctx(), { name: `Co ${i}`, kind: "brokerage" }, actor)));
    expect((await database.pool.query("select count(*)::int as n from companies")).rows[0].n).toBe(1);
  });
});
