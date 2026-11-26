/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { LocalDiskStore } from "@platform/adapters";
import { FixedClock } from "@platform/kernel";
import {
  companyDetails,
  dealEvents,
  listingDocuments,
  listingParties,
  listings,
  parties,
  type SpaDatabase,
  spaApprovals,
  signatories,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import { SpaDemoClock } from "../src/clock.ts";
import { createApp } from "../src/app.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  createListingDraft,
  expirePermits,
  recordOwnershipAs,
  recordSignatureAs,
  stepListing,
  updateListing,
  uploadListingDocument,
} from "../src/manager/listings.ts";
import { setCompany } from "../src/manager/parties.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";
import { issueToken } from "./session.ts";

const url = spaTestDatabaseUrl();
const NOW = Date.parse("2026-11-25T06:00:00Z"); // Dubai day 2026-11-25
const SECRET = "test-secret-test-secret-test-secret";
const PDF = new Uint8Array(await Bun.file(resolve(import.meta.dir, "fixtures/fictional-title-deed.pdf")).arrayBuffer());

describe.skipIf(!url)("M3: listing workspace (S74, S77)", () => {
  let database: SpaDatabase;
  let ctx: SpaContext;
  let clock: FixedClock;
  let users: Record<string, U>;
  let dir: string;
  let store: LocalDiskStore;
  const as = (k: string) => users[k]!;
  const fail = (p: Promise<unknown>) =>
    p.then(
      () => null,
      (e: { status?: number; code?: string; reasons?: string[]; message?: string }) => e,
    );
  const person = (n: string, share?: number) => ({
    kind: "person" as const,
    fullNameEn: n,
    email: `${n.replace(/\W/g, "").toLowerCase()}@example.test`,
    ...(share ? { shareBps: share } : {}),
  });
  const company = (n: string, share?: number) => ({
    kind: "company" as const,
    tradeName: n,
    email: `${n.replace(/\W/g, "").toLowerCase()}@example.test`,
    licenceNo: "LIC-1",
    licenceExpiresOn: "2027-12-31",
    issuingAuthority: "DED",
    signatory: {
      fullNameEn: `${n} Signer`,
      email: `signer-${n.replace(/\W/g, "").toLowerCase()}@example.test`,
      authority: "poa" as const,
    },
    ...(share ? { shareBps: share } : {}),
  });
  const draftInput = (sellers: unknown[], extra: Record<string, unknown> = {}) => ({
    title: "2-bed apartment, Demo Tower",
    community: "Demo Marina",
    propertyDescription: "A fictional flat.",
    askingPriceFils: 150_000_000,
    sellers,
    ...extra,
  });
  const make = (sellers: unknown[], extra: Record<string, unknown> = {}) =>
    createListingDraft(ctx, draftInput(sellers, extra), as("officer"));
  const stateOf = async (id: string) =>
    (await database.db.select().from(listings).where(eq(listings.id, id)))[0]!.state;
  const eventTypes = async (id: string) =>
    (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, id))).map((e) => e.type);
  /** A listing that is signed and matched, with a permit ending `expires`. */
  async function ready(expires = "2027-05-01") {
    const l = await make([person("Sara Demo"), person("Omar Demo")], {
      permitNo: "PERMIT-1",
      permitExpiresOn: expires,
    });
    await recordOwnershipAs(
      ctx,
      l.id,
      { kind: "title_deed", ref: "TD-1", ownersAsOnDocument: ["Sara Demo", "Omar Demo"] },
      as("officer"),
    );
    for (const lp of await database.db.select().from(listingParties).where(eq(listingParties.listingId, l.id)))
      await recordSignatureAs(ctx, l.id, lp.partyId, as("officer"));
    return l;
  }

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "spa-listing-docs-"));
    store = new LocalDiskStore(dir);
    database = await freshSpaDatabase(url!);
    clock = new FixedClock(new Date(NOW));
    ctx = { database, clock, facts: failClosedFacts };
    users = await seedUsers(database);
    await setCompany(ctx, { name: "Fictional Co", kind: "brokerage" }, "system");
  });
  afterAll(async () => {
    await database?.close();
    await rm(dir, { recursive: true, force: true });
  });

  describe("Task 1: draft with new sellers", () => {
    test("a person and a company seller create parties, company details, a signatory, links and one event", async () => {
      const l = await make([person("Alia Demo", 6000), company("Demo Holdings", 4000)]);
      expect(l.ref).toMatch(/^L-\d{4}$/);
      const links = await database.db.select().from(listingParties).where(eq(listingParties.listingId, l.id));
      expect(links.map((x) => x.shareBps).toSorted()).toEqual([4000, 6000]);
      const ps = await database.db.select().from(parties);
      const co = ps.find((p) => p.fullNameEn === "Demo Holdings")!;
      expect(co.kind).toBe("company");
      expect(
        (await database.db.select().from(companyDetails).where(eq(companyDetails.partyId, co.id)))[0]!.licenceNo,
      ).toBe("LIC-1");
      const sig = await database.db.select().from(signatories).where(eq(signatories.companyPartyId, co.id));
      expect(sig).toHaveLength(1);
      expect(ps.find((p) => p.id === sig[0]!.personPartyId)!.fullNameEn).toBe("Demo Holdings Signer");
      const ev = (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, l.id)))[0]!;
      expect(ev.type).toBe("LISTING_CREATED");
      expect(JSON.stringify(ev.payload)).not.toContain("Alia");
      expect(await stateOf(l.id)).toBe("DRAFT");
    });

    test("createListingDraft refuses duplicate sellers: 422, nothing written", async () => {
      const before = (await database.db.select().from(parties)).length;
      const e = await fail(make([person("Same Person"), person("Same Person")]));
      expect(e).toMatchObject({ status: 422, code: "invalid_listing" });
      expect((await database.db.select().from(parties)).length).toBe(before);
    });

    test("shares must add up to 100% when given; none is allowed; some is refused", async () => {
      expect(await fail(make([person("Share A", 6000), person("Share B", 3000)]))).toMatchObject({
        status: 422,
        code: "invalid_listing",
        reasons: expect.arrayContaining(["sellers: shares must add up to 100%"]),
      });
      expect(await fail(make([person("Share C", 6000), person("Share D")]))).toMatchObject({ status: 422 });
      expect(await make([person("Share E"), person("Share F")])).toHaveProperty("id");
    });

    test("no seller is refused with a sentence", async () => {
      expect(await fail(make([]))).toMatchObject({ status: 422, reasons: ["sellers: Add at least one seller"] });
    });

    test("a developer-only company refuses; an unknown agent is refused", async () => {
      await setCompany(ctx, { name: "Fictional Co", kind: "developer" }, "system");
      try {
        expect((await fail(make([person("Dev Seller")])))?.status).toBe(403);
      } finally {
        await setCompany(ctx, { name: "Fictional Co", kind: "brokerage" }, "system");
      }
      expect(await fail(make([person("Agent Test")], { agentUserId: as("finance").id }))).toMatchObject({
        status: 422,
      });
      expect(await make([person("Agent Ok")], { agentUserId: as("manager").id })).toHaveProperty("id");
    });

    test("updateListing: fields change, event names fields only; SOLD refuses; sellers can't change", async () => {
      const l = await make([person("Edit Me")]);
      await updateListing(ctx, l.id, { title: "New title", askingPriceFils: 160_000_000 }, as("officer"));
      const row = (await database.db.select().from(listings).where(eq(listings.id, l.id)))[0]!;
      expect(row.title).toBe("New title");
      const ev = (
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, l.id), eq(dealEvents.type, "LISTING_UPDATED")))
      )[0]!;
      expect(ev.payload).toEqual({ fields: ["title", "askingPriceFils"] });
      expect(
        await fail(
          updateListing(ctx, l.id, { permitIssuedOn: "2027-01-01", permitExpiresOn: "2026-01-01" }, as("officer")),
        ),
      ).toMatchObject({ status: 422 });
      await database.db.update(listings).set({ state: "SOLD" }).where(eq(listings.id, l.id));
      expect(await fail(updateListing(ctx, l.id, { title: "x" }, as("officer")))).toMatchObject({
        status: 409,
        code: "listing_not_editable",
      });
      expect((await fail(updateListing(ctx, l.id, { title: "x" }, as("admin"))))?.status).toBe(403);
    });

    test("editing a published listing's permit to yesterday unpublishes it at once", async () => {
      const l = await ready("2027-05-01");
      await stepListing(ctx, l.id, { event: "VERIFY" }, as("officer"));
      await stepListing(ctx, l.id, { event: "ACTIVATE" }, as("officer"));
      await stepListing(ctx, l.id, { event: "PUBLISH" }, as("officer"));
      await updateListing(ctx, l.id, { permitExpiresOn: "2026-11-24" }, as("officer"));
      expect(await stateOf(l.id)).toBe("ACTIVE");
      const ev = (
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, l.id), eq(dealEvents.type, "UNPUBLISH")))
      )[0]!;
      expect(ev.payload).toMatchObject({ reason: "permit expired" });
    });
  });

  describe("Task 2: documents, ownership, signatures", () => {
    test("a PDF is stored once per kind and hash; the second upload is a duplicate with no event", async () => {
      const l = await make([person("Doc Owner")]);
      const a = await uploadListingDocument(
        ctx,
        store,
        l.id,
        "title_deed",
        { name: "deed.pdf", bytes: PDF },
        as("officer"),
      );
      expect(a.duplicate).toBe(false);
      const b = await uploadListingDocument(
        ctx,
        store,
        l.id,
        "title_deed",
        { name: "deed.pdf", bytes: PDF },
        as("officer"),
      );
      expect(b).toEqual({ id: a.id, duplicate: true });
      expect(
        await database.db.select().from(listingDocuments).where(eq(listingDocuments.listingId, l.id)),
      ).toHaveLength(1);
      expect((await eventTypes(l.id)).filter((t) => t === "LISTING_DOCUMENT_UPLOADED")).toHaveLength(1);
      const ev = (
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, l.id), eq(dealEvents.type, "LISTING_DOCUMENT_UPLOADED")))
      )[0]!;
      expect(JSON.stringify(ev.payload)).not.toContain("deed.pdf");
    });

    test("a text file renamed .pdf is refused; documents are append-only", async () => {
      const l = await make([person("Doc Two")]);
      expect(
        await fail(
          uploadListingDocument(
            ctx,
            store,
            l.id,
            "permit",
            { name: "x.pdf", bytes: new TextEncoder().encode("hello") },
            as("officer"),
          ),
        ),
      ).toMatchObject({ status: 422, code: "unsupported_file" });
      await uploadListingDocument(ctx, store, l.id, "permit", { name: "p.pdf", bytes: PDF }, as("officer"));
      const del = async () => {
        await database.db.delete(listingDocuments).where(eq(listingDocuments.listingId, l.id));
      };
      await expect(del()).rejects.toThrow();
    });

    test("ownership mismatch opens seller_verification; a matching re-entry withdraws it", async () => {
      const l = await make([person("Match Me")]);
      const bad = await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-9", ownersAsOnDocument: ["Someone Else"] },
        as("officer"),
      );
      expect(bad.matched).toBe(false);
      const open = () =>
        database.db
          .select()
          .from(spaApprovals)
          .where(and(eq(spaApprovals.entityId, l.id), eq(spaApprovals.gate, "seller_verification")));
      expect((await open())[0]!.status).toBe("pending");
      const good = await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-9", ownersAsOnDocument: ["Match Me"] },
        as("officer"),
      );
      expect(good.matched).toBe(true);
      const [a] = await open();
      expect(a!.status).toBe("cancelled");
      expect(a!.decisionNote).toBe("ownership now matches");
      expect(await eventTypes(l.id)).toContain("APPROVAL_WITHDRAWN");
    });

    test("a signature for a non-seller is 422 not_a_seller; read roles can't write", async () => {
      const l = await make([person("Signer One")]);
      expect(await fail(recordSignatureAs(ctx, l.id, crypto.randomUUID(), as("officer")))).toMatchObject({
        status: 422,
        code: "not_a_seller",
      });
      expect((await fail(recordSignatureAs(ctx, l.id, crypto.randomUUID(), as("admin"))))?.status).toBe(403);
      expect((await fail(recordOwnershipAs(ctx, l.id, {}, as("admin"))))?.status).toBe(403);
    });
  });

  describe("review fixes", () => {
    test("ownership can't be re-entered once verified, and a signature can't be recorded on a withdrawn listing", async () => {
      const l = await ready();
      await stepListing(ctx, l.id, { event: "VERIFY" }, as("officer"));
      expect(
        await fail(
          recordOwnershipAs(
            ctx,
            l.id,
            { kind: "title_deed", ref: "TD-X", ownersAsOnDocument: ["Someone Else"] },
            as("officer"),
          ),
        ),
      ).toMatchObject({ status: 409, code: "listing_not_editable" });
      await stepListing(ctx, l.id, { event: "WITHDRAW", reason: "Seller withdrew" }, as("officer"));
      const [lp] = await database.db.select().from(listingParties).where(eq(listingParties.listingId, l.id));
      expect(await fail(recordSignatureAs(ctx, l.id, lp!.partyId, as("officer")))).toMatchObject({
        status: 409,
        code: "listing_not_editable",
      });
    });

    test("a changed mismatching document replaces the pending seller_verification with one for the new document", async () => {
      const l = await make([person("Key Owner")]);
      await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-A", ownersAsOnDocument: ["Other One"] },
        as("officer"),
      );
      await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-B", ownersAsOnDocument: ["Other Two"] },
        as("officer"),
      );
      const rows = await database.db
        .select()
        .from(spaApprovals)
        .where(and(eq(spaApprovals.entityId, l.id), eq(spaApprovals.gate, "seller_verification")));
      expect(rows.map((r) => r.status).toSorted()).toEqual(["cancelled", "pending"]);
      const pending = rows.find((r) => r.status === "pending")!;
      expect(JSON.stringify(pending.proposal)).toContain("TD-B");
      expect(rows.find((r) => r.status === "cancelled")!.decisionNote).toBe("the ownership document changed");
    });

    test("a decided approval is never withdrawn by a later match", async () => {
      const l = await make([person("Decided Owner")]);
      await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-D", ownersAsOnDocument: ["Not Matching"] },
        as("officer"),
      );
      const [ap] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.entityId, l.id));
      await database.db
        .update(spaApprovals)
        .set({ status: "approved", decidedAt: new Date(NOW) })
        .where(eq(spaApprovals.id, ap!.id));
      await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-D", ownersAsOnDocument: ["Decided Owner"] },
        as("officer"),
      );
      expect((await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, ap!.id)))[0]!.status).toBe(
        "approved",
      );
    });

    test("a company seller's signatory points to no authority document", async () => {
      const l = await make([company("Sentinel Co")]);
      const co = (await database.db.select().from(parties)).find((p) => p.fullNameEn === "Sentinel Co")!;
      const [sig] = await database.db.select().from(signatories).where(eq(signatories.companyPartyId, co.id));
      expect(sig!.documentId).toBe("00000000-0000-0000-0000-000000000000");
      expect(l.id).toBeString();
    });

    test("only sales roles read the unpublish reason and the activity notes", async () => {
      const { getListing } = await import("../src/manager/listing-reads.ts");
      const l = await ready();
      for (const ev of ["VERIFY", "ACTIVATE", "PUBLISH"]) await stepListing(ctx, l.id, { event: ev }, as("officer"));
      await stepListing(ctx, l.id, { event: "UNPUBLISH", reason: "Seller asked to pause" }, as("officer"));
      expect((await getListing(ctx, as("officer"), l.id)).lastUnpublish).toMatchObject({
        reason: "Seller asked to pause",
      });
      const admin = await getListing(ctx, as("admin"), l.id);
      expect(admin.lastUnpublish).toBeNull();
      expect(JSON.stringify(admin)).not.toContain("Seller asked to pause");
    });
  });

  describe("Task 3: steps", () => {
    test("VERIFY on a bare draft is refused with both sentences; the happy path reaches PUBLISHED", async () => {
      const bare = await make([person("Bare Seller")], { permitNo: "P", permitExpiresOn: "2027-05-01" });
      const e = await fail(stepListing(ctx, bare.id, { event: "VERIFY" }, as("officer")));
      expect(e).toMatchObject({ status: 409, code: "step_refused" });
      expect(e!.reasons).toEqual([
        "The listing agreement isn't signed.",
        "The ownership document isn't matched to the sellers.",
      ]);
      const l = await ready();
      for (const [ev, to] of [
        ["VERIFY", "VERIFIED"],
        ["ACTIVATE", "ACTIVE"],
        ["PUBLISH", "PUBLISHED"],
      ] as const) {
        await stepListing(ctx, l.id, { event: ev }, as("officer"));
        expect(await stateOf(l.id)).toBe(to);
      }
    });

    test("ACTIVATE without a permit says so; a permit ending today still publishes", async () => {
      const l = await make([person("No Permit")]);
      await recordOwnershipAs(
        ctx,
        l.id,
        { kind: "title_deed", ref: "TD-2", ownersAsOnDocument: ["No Permit"] },
        as("officer"),
      );
      const [lp] = await database.db.select().from(listingParties).where(eq(listingParties.listingId, l.id));
      await recordSignatureAs(ctx, l.id, lp!.partyId, as("officer"));
      await stepListing(ctx, l.id, { event: "VERIFY" }, as("officer"));
      expect(await fail(stepListing(ctx, l.id, { event: "ACTIVATE" }, as("officer")))).toMatchObject({
        status: 409,
        reasons: ["No advertising permit is recorded."],
      });
      await updateListing(ctx, l.id, { permitNo: "P-2", permitExpiresOn: "2026-11-25" }, as("officer"));
      await stepListing(ctx, l.id, { event: "ACTIVATE" }, as("officer"));
      await stepListing(ctx, l.id, { event: "PUBLISH" }, as("officer"));
      expect(await stateOf(l.id)).toBe("PUBLISHED");
    });

    test("the day after, the sweep unpublishes: ACTIVE and 'permit expired' on the record", async () => {
      const l = await ready("2026-11-25");
      for (const ev of ["VERIFY", "ACTIVATE", "PUBLISH"]) await stepListing(ctx, l.id, { event: ev }, as("officer"));
      const later = new FixedClock(new Date(NOW + 24 * 3600 * 1000));
      const r = await expirePermits({ ...ctx, clock: later });
      expect(r.unpublished).toContain(l.id);
      expect(await stateOf(l.id)).toBe("ACTIVE");
      const { getListing } = await import("../src/manager/listing-reads.ts");
      const rec = await getListing({ ...ctx, clock: later }, as("officer"), l.id);
      expect(rec.lastUnpublish).toEqual({ on: "2026-11-26", reason: "permit expired" });
      expect(rec.next).toMatchObject({ event: "PUBLISH", reasons: ["The advertising permit has expired."] });
    });

    test("WITHDRAW and UNPUBLISH need a reason; OFFER_OPENED isn't a route step; reasons are kept", async () => {
      const l = await ready();
      expect(await fail(stepListing(ctx, l.id, { event: "WITHDRAW" }, as("officer")))).toMatchObject({
        status: 422,
        code: "reason_required",
      });
      expect(await fail(stepListing(ctx, l.id, { event: "OFFER_OPENED" }, as("officer")))).toMatchObject({
        status: 422,
      });
      await stepListing(ctx, l.id, { event: "WITHDRAW", reason: "Owner changed mind" }, as("officer"));
      expect(await stateOf(l.id)).toBe("WITHDRAWN");
      const ev = (
        await database.db
          .select()
          .from(dealEvents)
          .where(and(eq(dealEvents.entityId, l.id), eq(dealEvents.type, "WITHDRAW")))
      )[0]!;
      expect(ev.payload).toEqual({ reason: "Owner changed mind" });
    });

    test("the record's next step, actions and sellers by role", async () => {
      const { getListing } = await import("../src/manager/listing-reads.ts");
      const l = await make([person("Role Seller")]);
      const rec = await getListing(ctx, as("officer"), l.id);
      expect(rec.next).toMatchObject({ event: "VERIFY", label: "Verify the listing" });
      expect(rec.next!.reasons).toHaveLength(2);
      expect(rec.actions).toEqual(["WITHDRAW"]);
      expect(rec.sellers![0]!.partyId).toBeString();
      const admin = await getListing(ctx, as("admin"), l.id);
      expect(admin).toMatchObject({ next: null, actions: [], sellers: null, documents: null });
    });
  });

  test("routes: agents, create, update, documents, steps, each behind a session and a role", async () => {
    const app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      documents: store,
    });
    const bearer = (k: string) => ({ authorization: `Bearer ${issueToken(SECRET, users[k]!.id, NOW)}` });
    const json = { "content-type": "application/json" };
    expect((await app.request("/api/listings/agents")).status).toBe(401);
    expect((await app.request("/api/listings/agents", { headers: bearer("admin") })).status).toBe(403);
    const agents = (await (await app.request("/api/listings/agents", { headers: bearer("officer") })).json()) as {
      id: string;
    }[];
    expect(agents.map((a) => a.id).toSorted()).toEqual(
      [as("officer").id, as("manager").id, as("salesadmin").id].toSorted(),
    );
    const created = await app.request("/api/listings", {
      method: "POST",
      headers: { ...bearer("officer"), ...json },
      body: JSON.stringify(draftInput([person("Route Seller")])),
    });
    expect(created.status).toBe(201);
    const { id } = (await created.json()) as { id: string };
    const dup = await app.request("/api/listings", {
      method: "POST",
      headers: { ...bearer("officer"), ...json },
      body: JSON.stringify(draftInput([person("Dup X"), person("Dup X")])),
    });
    expect(dup.status).toBe(422);
    expect(
      (
        await app.request(`/api/listings/${id}`, {
          method: "PUT",
          headers: { ...bearer("officer"), ...json },
          body: JSON.stringify({ title: "Routed" }),
        })
      ).status,
    ).toBe(200);
    const form = new FormData();
    form.set("kind", "title_deed");
    form.set("file", new File([PDF], "deed.pdf", { type: "application/pdf" }));
    const up = await app.request(`/api/listings/${id}/documents`, {
      method: "POST",
      headers: bearer("officer"),
      body: form,
    });
    expect(up.status).toBe(201);
    const docId = ((await up.json()) as { id: string }).id;
    const file = await app.request(`/api/listings/${id}/documents/${docId}/file`, { headers: bearer("officer") });
    expect(file.status).toBe(200);
    expect(file.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await app.request(`/api/listings/${id}/documents/${docId}/file`, { headers: bearer("admin") })).status,
    ).toBe(403);
    const step = await app.request(`/api/listings/${id}/steps`, {
      method: "POST",
      headers: { ...bearer("officer"), ...json },
      body: JSON.stringify({ event: "VERIFY" }),
    });
    expect(step.status).toBe(409);
    expect(((await step.json()) as any).code).toBe("step_refused");
    const rec = (await (await app.request(`/api/listings/${id}`, { headers: bearer("officer") })).json()) as any;
    expect(rec.documents).toHaveLength(1);
    expect(rec.documents[0]).toMatchObject({ kind: "title_deed", kindLabel: "Title deed", fileName: "deed.pdf" });
  });
});
