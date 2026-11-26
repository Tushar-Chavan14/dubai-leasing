import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { dealEvents, deals, deposits, listings, offers, parties, spaLeads, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import type { SpaContext } from "../src/manager/context.ts";
import { recordDeposit } from "../src/manager/deposits.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  createListing,
  listingStep,
  recordListingSignature,
  recordOwnership,
  stepListing,
} from "../src/manager/listings.ts";
import { answerOffer, listOffers, makeOffer, withdrawOffer } from "../src/manager/offers.ts";
import { createParty, setCompany } from "../src/manager/parties.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U>;
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let mailer = new FakeMailer();
const ctx = (): SpaContext => ({
  database,
  clock,
  facts: failClosedFacts,
  mail: { mailer, webBaseUrl: "https://spa.example.test" },
});
const actor = "user:00000000-0000-7000-8000-0000000000aa" as const;
const tokenOf = (m: { text: string }) => /\/b\/([\w-]+)\/offer/.exec(m.text)![1]!;
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const person = (n: string, over: object = {}) => ({
  kind: "person" as const,
  fullNameEn: n,
  email: `${n.replace(/\W/g, "").toLowerCase()}${newId().slice(-4)}@example.test`,
  nationality: "Testland",
  ...over,
});

async function activeListing(owners = ["Seller One", "Seller Two"]) {
  const sellers: string[] = [];
  for (const n of owners)
    sellers.push(
      (
        await createParty(
          ctx(),
          {
            kind: "person",
            fullNameEn: n,
            nationality: "Testland",
            email: `${n.replace(/\W/g, "")}@example.test`,
            passportNo: "X1",
          },
          actor,
        )
      ).id,
    );
  const l = await createListing(
    ctx(),
    {
      title: "2-bed apartment",
      community: "[COMMUNITY]",
      propertyDescription: "x",
      askingPriceFils: 200_000_000,
      permitNo: "[PERMIT NO.]",
      permitExpiresOn: "2027-05-01",
      sellers: sellers.map((partyId, i) => ({ role: "seller" as const, partyId, order: i + 1 })),
    },
    actor,
  );
  await recordOwnership(ctx(), l.id, { kind: "title_deed", ref: "x", ownersAsOnDocument: owners }, actor);
  for (const s of sellers) await recordListingSignature(ctx(), l.id, s, actor);
  await listingStep(ctx(), l.id, "VERIFY", { actor });
  await listingStep(ctx(), l.id, "ACTIVATE", { actor });
  return { ...l, sellers };
}
const state = async (id: string) => (await database.db.select().from(listings).where(eq(listings.id, id)))[0]!.state;
/** Offers on a listing and the tokens mailed to its sellers for the newest one. */
async function offer(listingId: string, over: Record<string, unknown> = {}, who = users.officer!) {
  const before = mailer.sent.length;
  const r = await makeOffer(ctx(), { listingId, priceFils: 195_000_000, buyers: [person("Buyer Name")], ...over }, who);
  return { ...r, tokens: mailer.sent.slice(before).map(tokenOf) };
}
const lead = async (listingId: string) => {
  const id = newId();
  await database.db.insert(spaLeads).values({
    id,
    propertyKind: "listing",
    listingId,
    name: "Lead Buyer",
    email: "lead.buyer@example.test",
    source: "form",
    status: "interested",
    agentUserId: users.officer!.id,
    consentAt: clock.now(),
    createdAt: clock.now(),
    updatedAt: clock.now(),
  });
  return id;
};
const leadStatus = async (id: string) =>
  (await database.db.select().from(spaLeads).where(eq(spaLeads.id, id)))[0]!.status;

describe.skipIf(!url)("M6: offers from the staff screen (S81)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    mailer = new FakeMailer();
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("an offer emails every seller; when all accept the deal opens in OFFER_AGREED, the listing is UNDER_OFFER and the lead converts", async () => {
    const l = await activeListing();
    const leadId = await lead(l.id);
    const o = await offer(l.id, {
      leadId,
      buyers: [
        person("Alice Buyer", { shareBps: 5000 }),
        {
          kind: "company",
          tradeName: "Beta Holdings",
          email: "beta@example.test",
          licenceNo: "L1",
          licenceExpiresOn: "2027-12-31",
          issuingAuthority: "DED",
          signatory: { fullNameEn: "Beta Signer", email: "betasigner@example.test", authority: "poa" },
          shareBps: 5000,
        },
      ],
    });
    expect(o.emailed.map((e) => e.status)).toEqual(["sent", "sent"]);
    expect(o.tokens).toHaveLength(2);
    expect(await state(l.id)).toBe("UNDER_OFFER");
    expect(await leadStatus(leadId)).toBe("interested");
    expect(await answerOffer(ctx(), o.tokens[0]!, "accept")).toEqual({ status: "SENT" });
    const r = await answerOffer(ctx(), o.tokens[1]!, "accept");
    expect(r.status).toBe("ACCEPTED");
    const [d] = await database.db.select().from(deals).where(eq(deals.id, r.dealId!));
    expect(d).toMatchObject({ state: "OFFER_AGREED", dealType: "resale_ready", priceFils: 195_000_000 });
    expect(await state(l.id)).toBe("UNDER_OFFER");
    expect(await leadStatus(leadId)).toBe("converted");
    const [lr] = await database.db.select().from(spaLeads).where(eq(spaLeads.id, leadId));
    expect(lr!.dealId).toBe(r.dealId!);
    // the deposit is recorded after acceptance, its amount by policy
    const dep = await recordDeposit(
      ctx(),
      r.dealId!,
      { chequeNo: "123456", bank: "Test Bank", chequeOn: "2026-11-25", holder: "Seller One" },
      actor,
    );
    expect(dep.amountFils).toBe(19_500_000);
    expect((await database.db.select().from(deposits)).length).toBe(1);
  });

  test("one reject rejects the offer, the listing goes back and the lead stays interested", async () => {
    const l = await activeListing();
    const leadId = await lead(l.id);
    const o = await offer(l.id, { leadId });
    await answerOffer(ctx(), o.tokens[0]!, "accept");
    expect((await answerOffer(ctx(), o.tokens[1]!, "reject")).status).toBe("REJECTED");
    expect(await state(l.id)).toBe("ACTIVE");
    expect(await leadStatus(leadId)).toBe("interested");
    expect((await database.db.select().from(deals)).length).toBe(0);
  });

  test("a second offer while one is sent is 409 and leaves no buyer behind", async () => {
    const l = await activeListing();
    await offer(l.id);
    const before = (await database.db.select().from(parties)).length;
    expect(await fails(offer(l.id, { buyers: [person("Second Buyer")] }))).toEqual({
      status: 409,
      code: "open_offer_exists",
    });
    expect((await database.db.select().from(parties)).length).toBe(before);
  });

  test("an offer that expires while the link is open can't be answered and creates no deal", async () => {
    const l = await activeListing();
    const o = await offer(l.id, { validDays: 2 });
    clock.set(new Date("2026-11-22T06:00:00Z"));
    expect(await fails(answerOffer(ctx(), o.tokens[0]!, "accept"))).toEqual({ status: 410, code: "offer_expired" });
    expect((await database.db.select().from(deals)).length).toBe(0);
  });

  test("withdrawing the listing while an offer is out withdraws the offer by code; the links stop and the lead stays", async () => {
    const l = await activeListing();
    const leadId = await lead(l.id);
    const o = await offer(l.id, { leadId });
    await stepListing(ctx(), l.id, { event: "WITHDRAW", reason: "The owner changed their mind" }, users.officer!);
    expect(await state(l.id)).toBe("WITHDRAWN");
    const [row] = await database.db.select().from(offers).where(eq(offers.id, o.offerId));
    expect(row!.status).toBe("WITHDRAWN");
    expect(await fails(answerOffer(ctx(), o.tokens[0]!, "accept"))).toEqual({ status: 410, code: "offer_closed" });
    expect(await leadStatus(leadId)).toBe("interested");
    const types = (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, l.id))).map((e) => e.type);
    expect(types).toContain("OFFER_WITHDRAWN");
  });

  test("a withdraw needs a reason, a sales role and a company with listings; revising makes a new offer at a new price", async () => {
    const l = await activeListing();
    const first = await offer(l.id);
    expect((await fails(withdrawOffer(ctx(), first.offerId, "", users.officer!)))?.code).toBe("reason_required");
    expect((await fails(withdrawOffer(ctx(), first.offerId, "ok reason", users.finance!)))?.status).toBe(403);
    await withdrawOffer(ctx(), first.offerId, "Buyer asked to change the price", users.officer!);
    expect(await state(l.id)).toBe("ACTIVE");
    expect((await fails(withdrawOffer(ctx(), first.offerId, "again please", users.officer!)))?.status).toBe(409);
    const second = await offer(l.id, { priceFils: 190_000_000, buyers: [person("Revised Buyer")] });
    expect(second.offerId).not.toBe(first.offerId);
    const [a, b] = await Promise.all(
      [first.offerId, second.offerId].map(
        async (id) => (await database.db.select().from(offers).where(eq(offers.id, id)))[0]!,
      ),
    );
    expect([a!.status, a!.priceFils, b!.status, b!.priceFils]).toEqual(["WITHDRAWN", 195_000_000, "SENT", 190_000_000]);
    // the withdrawn offer's link no longer works
    expect(await fails(answerOffer(ctx(), first.tokens[0]!, "accept"))).toEqual({ status: 410, code: "offer_closed" });
    await setCompany(ctx(), { name: "Fictional Developments", kind: "developer" }, "system");
    expect(
      (await fails(makeOffer(ctx(), { listingId: l.id, priceFils: 1, buyers: [person("Z")] }, users.officer!)))?.status,
    ).toBe(403);
  });

  test("bad offers are refused: validity days out of range, shares, a seller as buyer", async () => {
    const l = await activeListing();
    for (const over of [{ validDays: 0 }, { validDays: 31 }, { buyers: [] }, { priceFils: 0 }])
      expect((await fails(offer(l.id, over)))?.status).toBe(422);
    const seller = await database.db.select().from(parties).where(eq(parties.id, l.sellers[0]!));
    expect((await fails(offer(l.id, { buyers: [{ partyId: seller[0]!.id }] })))?.status).toBe(422);
    expect(await state(l.id)).toBe("ACTIVE");
  });

  test("the offer list shows each seller's answer; a role that only reads sees no buyer contact details", async () => {
    const l = await activeListing();
    const o = await offer(l.id);
    await answerOffer(ctx(), o.tokens[0]!, "accept");
    const sales = await listOffers(ctx(), users.officer!, l.id);
    expect(sales.offers).toHaveLength(1);
    expect(sales.offers[0]!.sellers.map((s) => s.answerLabel).toSorted()).toEqual(["Accepted", "Waiting"]);
    expect(sales.offers[0]!.buyers?.[0]?.email).toContain("@example.test");
    expect(sales.offers[0]!.canWithdraw).toBe(true);
    const admin = await listOffers(ctx(), users.admin!, l.id);
    expect(admin.offers[0]!.buyers).toBeNull();
    expect(admin.offers[0]!.canWithdraw).toBe(false);
    expect(admin.offers[0]!.sellers.map((s) => s.name)).toEqual(["A seller", "A seller"]);
    expect((await fails(listOffers(ctx(), users.finance!, l.id)))?.status).toBe(403);
    expect(JSON.stringify(sales)).not.toMatch(/token|\/b\//);
  });

  test("a link answers once; an accepted offer can't be withdrawn; the deposit's bank and date go to sales roles only", async () => {
    const l = await activeListing(["Only Seller"]);
    const o = await offer(l.id);
    expect((await answerOffer(ctx(), o.tokens[0]!, "accept")).status).toBe("ACCEPTED");
    expect(await fails(answerOffer(ctx(), o.tokens[0]!, "accept"))).toEqual({ status: 410, code: "link_used" });
    expect((await fails(withdrawOffer(ctx(), o.offerId, "changed my mind", users.officer!)))?.status).toBe(409);
    const [d] = await database.db.select().from(deals);
    await recordDeposit(
      ctx(),
      d!.id,
      { chequeNo: "123456", bank: "Test Bank", chequeOn: "2026-11-25", holder: "Only Seller" },
      actor,
    );
    const sales = await listOffers(ctx(), users.officer!, l.id);
    expect(sales.offers[0]!.deposit).toMatchObject({ amountFils: 19_500_000, bank: "Test Bank" });
    expect(sales.offers[0]!.canRecordDeposit).toBe(false);
    const admin = await listOffers(ctx(), users.admin!, l.id);
    expect(admin.offers[0]!.deposit).toBeNull();
    expect(JSON.stringify(admin)).not.toContain("Test Bank");
  });
});
