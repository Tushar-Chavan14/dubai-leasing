import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import { listings, type SpaDatabase, spaApprovals, spaUsers } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { decideApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { createListing, listingStep, recordListingSignature, recordOwnership } from "../src/manager/listings.ts";
import { createParty } from "../src/manager/parties.ts";

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
const seller = (name: string) =>
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

async function listingWith(names: string[], permitExpiresOn = "2027-05-01") {
  const ids = [];
  for (const n of names) ids.push((await seller(n)).id);
  const l = await createListing(
    ctx(),
    {
      title: "2-bed apartment, [BUILDING]",
      community: "[COMMUNITY]",
      propertyDescription: "2 bed, [BUILDING]",
      askingPriceFils: 200_000_000,
      permitNo: "[PERMIT NO.]",
      permitExpiresOn,
      sellers: ids.map((partyId, i) => ({
        role: "seller",
        partyId,
        order: i + 1,
        shareBps: Math.floor(10_000 / ids.length) + (i === 0 ? 10_000 % ids.length : 0),
      })),
    },
    actor,
  );
  return { ...l, sellers: ids };
}
const stateOf = async (id: string) => (await database.db.select().from(listings).where(eq(listings.id, id)))[0]!.state;

describe.skipIf(!url)("listings with sellers (C5)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
  });
  afterAll(async () => {
    await database?.close();
  });

  test("two co-owners documented, listed and signed: VERIFY, then ACTIVATE with a valid permit", async () => {
    const l = await listingWith(["Sara Example Khan", "Omar Example Khan"]);
    expect(l.ref).toMatch(/^L-\d{4}$/);
    expect(
      await recordOwnership(
        ctx(),
        l.id,
        {
          kind: "title_deed",
          ref: "[TITLE DEED NO.]",
          ownersAsOnDocument: ["SARA  EXAMPLE KHAN", "omar example-khan"],
        },
        actor,
      ),
    ).toEqual({ matched: true });
    for (const s of l.sellers) await recordListingSignature(ctx(), l.id, s, actor);
    await listingStep(ctx(), l.id, "VERIFY", { actor });
    await listingStep(ctx(), l.id, "ACTIVATE", { actor });
    expect(await stateOf(l.id)).toBe("ACTIVE");
  });

  test("a co-owner missing from the listing opens seller_verification; VERIFY waits for the sales manager", async () => {
    const l = await listingWith(["Sara Example Khan"]);
    const r = await recordOwnership(
      ctx(),
      l.id,
      { kind: "title_deed", ref: "[TITLE DEED NO.]", ownersAsOnDocument: ["Sara Example Khan", "Omar Example Khan"] },
      actor,
    );
    expect(r.matched).toBe(false);
    const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, r.approvalId!));
    expect(a?.gate).toBe("seller_verification");
    expect(a?.reasons.join(" ")).toContain("Omar Example Khan");
    await recordListingSignature(ctx(), l.id, l.sellers[0]!, actor);
    expect(await fails(listingStep(ctx(), l.id, "VERIFY", { actor }))).toEqual({ status: 422, code: "guard_failed" });
    const manager = { id: newId(), role: "sales_manager" as const };
    await database.db.insert(spaUsers).values({ ...manager, email: "m@spa-demo.test", name: "M" });
    await decideApproval(ctx(), r.approvalId!, manager, { decision: "approve", note: "co-owner gave a POA" });
    await listingStep(ctx(), l.id, "VERIFY", { actor });
    expect(await stateOf(l.id)).toBe("VERIFIED");
  });

  test("every seller signs before VERIFY", async () => {
    const l = await listingWith(["Sara Example Khan", "Omar Example Khan"]);
    await recordOwnership(
      ctx(),
      l.id,
      { kind: "title_deed", ref: "x", ownersAsOnDocument: ["Sara Example Khan", "Omar Example Khan"] },
      actor,
    );
    await recordListingSignature(ctx(), l.id, l.sellers[0]!, actor);
    expect(await fails(listingStep(ctx(), l.id, "VERIFY", { actor }))).toEqual({ status: 422, code: "guard_failed" });
    expect(await fails(recordListingSignature(ctx(), l.id, newId(), actor))).toEqual({
      status: 422,
      code: "not_a_seller",
    });
  });

  test("deal-driven events aren't public; an expired permit can't activate", async () => {
    const l = await listingWith(["Sara Example Khan"], "2026-11-17");
    expect(await fails(listingStep(ctx(), l.id, "SELL" as never, { actor }))).toEqual({
      status: 409,
      code: "deal_only",
    });
    await recordOwnership(ctx(), l.id, { kind: "oqood", ref: "x", ownersAsOnDocument: ["Sara Example Khan"] }, actor);
    await recordListingSignature(ctx(), l.id, l.sellers[0]!, actor);
    await listingStep(ctx(), l.id, "VERIFY", { actor });
    expect(await fails(listingStep(ctx(), l.id, "ACTIVATE", { actor }))).toEqual({ status: 422, code: "guard_failed" });
  });
  test("review #1: owners match one-to-one; empty names never match; accents compare equal", async () => {
    const l = await listingWith(["Sara Example Khan", "Omar Example Khan"]);
    const r = await recordOwnership(
      ctx(),
      l.id,
      { kind: "title_deed", ref: "x", ownersAsOnDocument: ["Sara Example Khan", "sara example khan"] },
      actor,
    );
    expect(r.matched).toBe(false);
    expect(
      await fails(
        recordOwnership(
          ctx(),
          l.id,
          { kind: "title_deed", ref: "x", ownersAsOnDocument: ["---", "Omar Example Khan"] },
          actor,
        ),
      ),
    ).toEqual({ status: 422, code: "invalid_ownership" });
    expect(await fails(seller("---"))).toEqual({ status: 422, code: "invalid_party" });
    const n = await listingWith(["Maria Nu\u0301n\u0303ez"]);
    expect(
      (await recordOwnership(ctx(), n.id, { kind: "oqood", ref: "x", ownersAsOnDocument: ["MARIA NÚÑEZ"] }, actor))
        .matched,
    ).toBe(true);
  });

  test("review #2: an approved seller_verification covers only the document it was given for", async () => {
    const l = await listingWith(["Sara Example Khan"]);
    const first = await recordOwnership(
      ctx(),
      l.id,
      { kind: "title_deed", ref: "TD-1", ownersAsOnDocument: ["Sara Example Khan", "Omar Example Khan"] },
      actor,
    );
    const manager = { id: newId(), role: "sales_manager" as const };
    await database.db.insert(spaUsers).values({ ...manager, email: "m2@spa-demo.test", name: "M" });
    await decideApproval(ctx(), first.approvalId!, manager, { decision: "approve", note: "checked" });
    await recordListingSignature(ctx(), l.id, l.sellers[0]!, actor);
    await recordOwnership(
      ctx(),
      l.id,
      { kind: "title_deed", ref: "TD-2", ownersAsOnDocument: ["Someone Else"] },
      actor,
    );
    expect(await fails(listingStep(ctx(), l.id, "VERIFY", { actor }))).toEqual({ status: 422, code: "guard_failed" });
  });
  test("C7 deferred: no caller refs, permit dates in order, unique sellers, ownership only before VERIFY", async () => {
    const one = await seller("Ref Seller");
    const base = {
      title: "t",
      community: "c",
      propertyDescription: "x",
      askingPriceFils: 1,
      sellers: [{ role: "seller" as const, partyId: one.id, order: 1 }],
    };
    const l = await createListing(ctx(), { ...base, ref: "L-0001" }, actor);
    expect(l.ref).toMatch(/^L-\d{4}$/);
    const other = await createListing(ctx(), { ...base, ref: l.ref }, actor);
    expect(other.ref).not.toBe(l.ref);
    expect(
      await fails(
        createListing(ctx(), { ...base, permitIssuedOn: "2027-01-02", permitExpiresOn: "2027-01-01" }, actor),
      ),
    ).toEqual({ status: 422, code: "invalid_listing" });
    expect(
      await fails(
        createListing(
          ctx(),
          {
            ...base,
            sellers: [
              { role: "seller", partyId: one.id, order: 1 },
              { role: "seller", partyId: one.id, order: 2 },
            ],
          },
          actor,
        ),
      ),
    ).toEqual({ status: 422, code: "invalid_listing" });
    await database.pool.query("update listings set state = 'WITHDRAWN' where id = $1", [l.id]);
    expect(
      await fails(recordOwnership(ctx(), l.id, { kind: "oqood", ref: "x", ownersAsOnDocument: ["Ref Seller"] }, actor)),
    ).toEqual({ status: 409, code: "listing_not_editable" });
  });
});
