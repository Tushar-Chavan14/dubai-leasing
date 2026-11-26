import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { dealParties, deals, listingParties, listings, offerParties, offers, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { createDeal } from "../src/manager/deals.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { createListing, listingStep, recordListingSignature, recordOwnership } from "../src/manager/listings.ts";
import { answerOffer, expireOffers, sendOffer as sendOfferRaw } from "../src/manager/offers.ts";
import { createParty } from "../src/manager/parties.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let mailer = new FakeMailer();
const ctx = (): SpaContext => ({
  database,
  clock,
  facts: failClosedFacts,
  mail: { mailer, webBaseUrl: "https://spa.example.test" },
});
/** The links reach sellers only by email (S54): a test reads them from the mail the fake mailer kept. */
const tokenOf = (m: { text: string }) => /\/b\/([\w-]+)\/offer/.exec(m.text)![1]!;
const sendOffer = async (...args: Parameters<typeof sendOfferRaw>) => {
  const before = mailer.sent.length;
  const r = await sendOfferRaw(...args);
  return { ...r, links: mailer.sent.slice(before).map((m) => ({ to: m.to, token: tokenOf(m) })) };
};
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
      email: `${name.replace(/\W/g, "")}@example.test`,
      passportNo: "X0000001",
    },
    actor,
  );

async function activeListing(owners = ["Seller One", "Seller Two"]) {
  const sellers = [];
  for (const n of owners) sellers.push((await person(n)).id);
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
const offerOn = async (listingId: string, priceFils = 195_000_000) => {
  const buyer = await person(`Buyer ${newId().slice(-4)}`);
  return sendOffer(
    ctx(),
    {
      listingId,
      priceFils,
      buyerMortgage: true,
      targetTransferOn: "2027-01-15",
      conditions: "Subject to finance",
      buyers: [{ partyId: buyer.id, order: 1 }],
    },
    actor,
  );
};
const listingState = async (id: string) =>
  (await database.db.select().from(listings).where(eq(listings.id, id)))[0]!.state;

describe.skipIf(!url)("offers (C7)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    mailer = new FakeMailer();
    await database?.close();
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("offer flags: off-plan resale needs both; ready resale can't have a plan taken over; the deal gets them", async () => {
    const offplan = await activeListing(["Only Seller"]);
    await database.pool.query("update listings set ownership_kind = 'oqood' where id = $1", [offplan.id]);
    const buyer = await person("Flag Buyer");
    const send = (listingId: string, flags: object) =>
      sendOffer(
        ctx(),
        {
          listingId,
          priceFils: 195_000_000,
          buyerMortgage: false,
          buyers: [{ partyId: buyer.id, order: 1 }],
          ...flags,
        },
        actor,
      );
    for (const flags of [{}, { sellerMortgage: true }, { planTakenOver: true }])
      expect(await fails(send(offplan.id, flags))).toEqual({ status: 422, code: "invalid_offer" });
    const ready = await activeListing(["Ready Seller"]);
    expect(await fails(send(ready.id, { planTakenOver: true }))).toEqual({ status: 422, code: "invalid_offer" });
    const o = await send(offplan.id, { sellerMortgage: true, planTakenOver: true });
    const r = await answerOffer(ctx(), o.links[0]!.token, "accept");
    const [d] = await database.db.select().from(deals).where(eq(deals.id, r.dealId!));
    expect([d?.dealType, d?.sellerMortgage, d?.planTakenOver]).toEqual(["resale_offplan", true, true]);
  });

  test("sendOffer returns no link; each seller gets one email, and the link is only in it", async () => {
    const l = await activeListing(["Mail Seller One", "Mail Seller Two"]);
    const buyer = await person("Mail Buyer Name");
    const r = await sendOfferRaw(
      ctx(),
      { listingId: l.id, priceFils: 195_000_000, buyerMortgage: false, buyers: [{ partyId: buyer.id, order: 1 }] },
      actor,
    );
    expect(Object.keys(r).toSorted()).toEqual(["emailed", "offerId", "validUntil"]);
    expect(r.emailed.map((e) => e.status)).toEqual(["sent", "sent"]);
    expect(r.emailed.map((e) => e.sellerPartyId).toSorted()).toEqual([...l.sellers].toSorted());
    expect(mailer.sent.map((m) => m.to).toSorted()).toEqual([
      "MailSellerOne@example.test",
      "MailSellerTwo@example.test",
    ]);
    for (const m of mailer.sent) {
      expect(m.subject).toBe("Answer the offer · 2-bed apartment");
      expect(m.text).toContain("AED 1,950,000");
      expect(m.text + m.html).not.toContain("Mail Buyer Name");
    }
    const tokens = mailer.sent.map(tokenOf);
    expect(new Set(tokens).size).toBe(2);
    const rows = (await database.pool.query("select * from outbound_messages")).rows;
    expect(rows).toHaveLength(2);
    expect(rows.every((x) => x.status === "sent" && x.body_sha256 && x.smtp_response && x.purpose === "link")).toBe(
      true,
    );
    const dump = JSON.stringify([
      rows,
      (await database.pool.query("select * from deal_events")).rows,
      (await database.pool.query("select * from offer_links")).rows,
    ]);
    for (const t of tokens) expect(dump).not.toContain(t);
    // The emailed link works.
    expect((await answerOffer(ctx(), tokens[0]!, "accept")).status).toBe("SENT");
  });

  test("with email not configured, an offer is refused (503) and nothing is created", async () => {
    const l = await activeListing(["No Mail Seller"]);
    const buyer = await person("No Mail Buyer");
    const e = await sendOfferRaw(
      { database, clock, facts: failClosedFacts },
      { listingId: l.id, priceFils: 195_000_000, buyerMortgage: false, buyers: [{ partyId: buyer.id, order: 1 }] },
      actor,
    ).catch((x) => x);
    expect(e.status).toBe(503);
    expect(await listingState(l.id)).toBe("ACTIVE");
  });

  test("an offer puts the listing under offer; a second one is refused", async () => {
    const l = await activeListing();
    const o = await offerOn(l.id);
    expect(o.links).toHaveLength(2);
    expect(o.validUntil).toBe("2026-11-22");
    expect(await listingState(l.id)).toBe("UNDER_OFFER");
    expect(await fails(offerOn(l.id))).toEqual({ status: 409, code: "open_offer_exists" });
  });

  test("every co-owner accepts → the deal is created at the offer price with the offer's buyers", async () => {
    const l = await activeListing();
    const o = await offerOn(l.id, 195_000_000);
    expect((await answerOffer(ctx(), o.links[0]!.token, "accept")).status).toBe("SENT");
    const r = await answerOffer(ctx(), o.links[1]!.token, "accept");
    expect(r.status).toBe("ACCEPTED");
    const [d] = await database.db.select().from(deals).where(eq(deals.id, r.dealId!));
    expect([d?.priceFils, d?.dealType, d?.buyerMortgage, d?.state]).toEqual([
      195_000_000,
      "resale_ready",
      true,
      "OFFER_AGREED",
    ]);
    const ps = await database.db.select().from(dealParties).where(eq(dealParties.dealId, r.dealId!));
    expect(
      ps
        .filter((p) => p.role === "seller")
        .map((p) => p.partyId)
        .toSorted(),
    ).toEqual([...l.sellers].toSorted());
    expect(await listingState(l.id)).toBe("UNDER_OFFER");
  });

  test("one co-owner's rejection rejects the offer and frees the listing; a revision is a new offer", async () => {
    const l = await activeListing();
    const o = await offerOn(l.id);
    await answerOffer(ctx(), o.links[0]!.token, "accept");
    expect((await answerOffer(ctx(), o.links[1]!.token, "reject")).status).toBe("REJECTED");
    expect(await listingState(l.id)).toBe("ACTIVE");
    const revised = await offerOn(l.id, 198_000_000);
    expect(revised.offerId).not.toBe(o.offerId);
  });

  test("links are single-use; answering after the last valid day is refused; the sweep expires once", async () => {
    const l = await activeListing(["Only Seller"]);
    const o = await offerOn(l.id);
    clock.advanceDays(4);
    expect(await fails(answerOffer(ctx(), o.links[0]!.token, "accept"))).toEqual({
      status: 410,
      code: "offer_expired",
    });
    expect((await expireOffers(ctx())).expired).toEqual([o.offerId]);
    expect((await expireOffers(ctx())).expired).toEqual([]);
    expect(await listingState(l.id)).toBe("ACTIVE");
    clock.set(new Date("2026-11-19T06:00:00Z"));
    const o2 = await offerOn(l.id);
    await answerOffer(ctx(), o2.links[0]!.token, "reject");
    expect(await fails(answerOffer(ctx(), o2.links[0]!.token, "accept"))).toEqual({ status: 410, code: "link_used" });
  });

  test("an offer's price can't change; a deal can't bypass an open offer", async () => {
    const l = await activeListing(["Only Seller"]);
    const o = await offerOn(l.id);
    const r = await database.pool.query("update offers set price_fils = 1 where id = $1", [o.offerId]).then(
      () => "ok",
      (e: Error) => e.message,
    );
    expect(r).toContain("fixed");
    const buyer = await person("Direct Buyer");
    expect(
      await fails(
        createDeal(
          ctx(),
          {
            dealType: "resale_ready",
            sellerMortgage: false,
            buyerMortgage: false,
            planTakenOver: false,
            listingId: l.id,
            priceFils: 1,
            parties: [
              { role: "buyer", partyId: buyer.id, order: 1 },
              { role: "seller", partyId: l.sellers[0]!, order: 1 },
            ],
          },
          actor,
        ),
      ),
    ).toEqual({ status: 409, code: "open_offer_exists" });
    void offers;
  });

  test("the public link page names neither buyers nor sellers", async () => {
    const app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: "s".repeat(40),
      demoMode: false,
      nowMs: () => 0,
    });
    // The app reads the real date; make the offer on that same date so its link is still valid.
    clock.set(new SpaDemoClock(database, false).now());
    const l = await activeListing(["Hidden Seller Name"]);
    const o = await offerOn(l.id);
    const res = await app.request(`/public/offer-links/${o.links[0]!.token}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).toSorted()).toEqual([
      "buyerMortgage",
      "conditions",
      "listingTitle",
      "priceFils",
      "status",
      "targetTransferOn",
      "validUntil",
    ]);
    expect(JSON.stringify(body)).not.toMatch(/Hidden Seller Name|Buyer /);
    const ans = await app.request(`/public/offer-links/${o.links[0]!.token}/answer`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ answer: "reject" }),
    });
    expect(ans.status).toBe(200);
    expect((await app.request("/public/offer-links/nope")).status).toBe(404);
  });

  const sqlFails = (q: string, args: unknown[] = []) =>
    database.pool.query(q, args).then(
      () => "ok",
      (e: Error) => e.message,
    );

  test("triggers: an answered link, an offer's buyers and its deal can't be rewritten", async () => {
    const l = await activeListing(["Only Seller"]);
    const o = await offerOn(l.id);
    await answerOffer(ctx(), o.links[0]!.token, "accept");
    expect(await sqlFails("update offer_links set answer = 'reject' where offer_id = $1", [o.offerId])).toContain(
      "answered once",
    );
    expect(await sqlFails("delete from offer_links where offer_id = $1", [o.offerId])).toContain("never deleted");
    expect(await sqlFails("update offer_parties set share_bps = 1 where offer_id = $1", [o.offerId])).toContain(
      "fixed once sent",
    );
    expect(await sqlFails("delete from offer_parties where offer_id = $1", [o.offerId])).toContain("fixed once sent");
    const [offer] = await database.db.select().from(offers).where(eq(offers.id, o.offerId));
    expect(offer?.status).toBe("ACCEPTED");
    expect(await sqlFails("update offers set deal_id = $1 where id = $2", [newId(), o.offerId])).toContain("offers:");
    expect(await sqlFails("delete from offers where id = $1", [o.offerId])).toContain("never deleted");
    void offerParties;
  });

  test("an offer for a listing with no sellers is refused", async () => {
    const id = newId();
    await database.db.insert(listings).values({ id, state: "ACTIVE", permitExpiresOn: "2027-05-01" });
    expect(await fails(offerOn(id))).toEqual({ status: 422, code: "no_sellers" });
    void listingParties;
  });

  test("conditions can't name a buyer, even with other case or accents (S39)", async () => {
    const l = await activeListing(["Only Seller"]);
    const buyer = await person("María Núñez");
    const offer = (conditions: string) =>
      sendOffer(
        ctx(),
        {
          listingId: l.id,
          priceFils: 195_000_000,
          buyerMortgage: false,
          conditions,
          buyers: [{ partyId: buyer.id, order: 1 }],
        },
        actor,
      );
    expect(await fails(offer("Subject to a visit by MARIA NUNEZ on Friday"))).toEqual({
      status: 422,
      code: "conditions_name_party",
    });
    expect(await listingState(l.id)).toBe("ACTIVE");
    expect((await offer("Subject to finance")).offerId).toBeTruthy();
  });
});
