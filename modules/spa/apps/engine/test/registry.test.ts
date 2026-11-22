import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { DEAL_FACT_KEYS, type DealFacts, REGISTRY_NO } from "@spa/core";
import {
  dealEvents,
  deals,
  deposits,
  helperRuns,
  listings,
  registrations,
  type SpaDatabase,
  spaApprovals,
  units,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { FakeOqood } from "@spa/helpers";
import { and, asc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { type FactsLoader, failClosedFacts } from "../src/manager/facts.ts";
import {
  type DocumentStore,
  recordNoc,
  setDealUnit,
  setTargetTransferDate,
  uploadDocument,
} from "../src/manager/noc.ts";
import {
  enqueueRegistration,
  listRegistrations,
  onRegistryGateApproved,
  proposeOnDealEntered,
  registryJobKey,
  requestRegistration,
  submitRegistration,
} from "../src/manager/registry.ts";
import { OQOOD_SUBMIT_JOB, TRANSFER_SUBMIT_JOB, createBoss, startJobs } from "../src/jobs.ts";
import { dealInDraft, markScreened, RB, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
afterAll(async () => {
  await database?.close();
});
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let users: Record<string, U> = {};
let override: Partial<DealFacts> = {};
const facts: FactsLoader = {
  deal: async (tx, row, today) => ({ ...(await failClosedFacts.deal(tx, row, today)), ...override }),
  listing: (tx, row, today) => failClosedFacts.listing(tx, row, today),
};
const ctx = (extra: Partial<SpaContext> = {}): SpaContext => ({ database, clock, facts, rulebook: () => RB, ...extra });
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const store: DocumentStore = {
  async put(bytes, ext) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    return { sha256, path: `${sha256.slice(0, 2)}/${sha256}.${ext}`, bytes: bytes.byteLength };
  },
};
const PDF = new TextEncoder().encode("%PDF-1.4 fictional");

const stateOf = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const attempts = (dealId: string) =>
  database.db.select().from(registrations).where(eq(registrations.dealId, dealId)).orderBy(asc(registrations.attempt));
const runs = (dealId: string) =>
  database.db
    .select()
    .from(helperRuns)
    .where(and(eq(helperRuns.dealId, dealId), eq(helperRuns.helper, "spa_registry")));
const eventTypes = async (dealId: string) =>
  (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, dealId)).orderBy(asc(dealEvents.at))).map(
    (e) => e.type,
  );
const factsOf = (id: string) =>
  withSpaTx(database, async (tx) =>
    failClosedFacts.deal(tx, (await tx.db.select().from(deals).where(eq(deals.id, id)))[0]!, clock.today()),
  );

/** An approved gate of this deal, proposed the way the engine proposes it and decided by the sales admin. */
async function approvedGate(dealId: string, gate: "oqood_submission" | "transfer_submission", key = "") {
  const { id } = await proposeApproval(ctx(), {
    gate,
    entity: { kind: "deal", id: dealId },
    dedupeKey: `${dealId}:${gate}${key}`,
    title: gate,
    proposal: {},
    proposedBy: "system:registry",
  });
  await decideApproval(ctx(), id, users.salesadmin!, { decision: "approve" });
  return id;
}

/** A primary off-plan deal in REGISTRATION (unit sold), screened. */
async function primaryInRegistration() {
  const made = await dealInDraft(ctx(), database, { type: "primary_offplan", buyers: ["Buyer One"], unitNo: "U-101" });
  const [d] = await database.db.select().from(deals).where(eq(deals.id, made.dealId));
  await database.db.update(units).set({ state: "SOLD" }).where(eq(units.id, d!.unitId!));
  await database.db.update(deals).set({ state: "REGISTRATION" }).where(eq(deals.id, made.dealId));
  await markScreened(database, made.dealId);
  return made.dealId;
}

/** A resale through a real NOC, forced into TRANSFER (the steps between are other chunks), screened. */
async function resaleInTransfer(type: "resale_ready" | "resale_offplan" = "resale_ready") {
  const made = await dealInDraft(ctx(), database, { type, buyers: ["Buyer One"], sellers: ["Seller One"] });
  const id = made.dealId;
  await database.db.update(deals).set({ state: "NOC", planTakenOver: false }).where(eq(deals.id, id));
  await markScreened(database, id);
  await database.db.insert(deposits).values({
    dealId: id,
    amountFils: 20_000_000,
    chequeLast4: "1234",
    bank: "Fictional Bank",
    chequeOn: "2026-11-01",
    holder: "Buyer One",
    recordedAt: new Date("2026-11-19T06:00:00Z"),
  });
  await setDealUnit(ctx(), id, { unitNo: "A-101", projectCode: "P1" }, users.officer!);
  await setTargetTransferDate(ctx(), id, "2027-01-15", users.manager!);
  const doc = await uploadDocument(ctx(), store, id, { kind: "noc", fileName: "f.pdf", bytes: PDF }, users.officer!);
  await recordNoc(
    ctx(),
    id,
    {
      documentId: doc.id,
      unitNo: "A-101",
      sellerNames: ["Seller One"],
      issuedOn: "2026-11-01",
      expiresOn: "2027-03-01",
      serviceChargesCleared: true,
      ...(type === "resale_offplan" ? { paidFils: 80_000_000 } : {}),
    },
    users.officer!,
  );
  await database.db.update(deals).set({ state: "TRANSFER" }).where(eq(deals.id, id));
  return id;
}

describe.skipIf(!url)("registry mocks: submission, gates and facts (C27)", () => {
  beforeEach(async () => {
    clock.set(new Date("2026-11-19T06:00:00Z"));
    override = {};
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });

  describe("facts", () => {
    test("the fact keys are unchanged and both facts are false with no attempt", async () => {
      const id = await primaryInRegistration();
      const f = await factsOf(id);
      expect(Object.keys(f).toSorted()).toEqual([...DEAL_FACT_KEYS].toSorted());
      expect([f.oqoodIssued, f.transferIssued]).toEqual([false, false]);
    });

    test("REGISTERED fails closed without an issued row, even with an approved gate", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      expect(
        await fails(advance(ctx(), { kind: "deal", id }, "REGISTERED", { actor: "system", approvalId: gate })),
      ).toEqual({
        status: 422,
        code: "guard_failed",
      });
      expect(await stateOf(id)).toBe("REGISTRATION");
    });

    test("a rejected or unavailable attempt does not make a fact true; an issued one does, per deal type", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const base = {
        dealId: id,
        kind: "oqood_register" as const,
        reasons: [],
        approvalId: gate,
        payloadHash: "h",
        createdAt: clock.now(),
      };
      await database.db
        .insert(registrations)
        .values({ ...base, id: newId(), attempt: 1, requestId: `${id}:a`, status: "rejected" });
      await database.db
        .insert(registrations)
        .values({ ...base, id: newId(), attempt: 2, requestId: `${id}:b`, status: "unavailable" });
      expect((await factsOf(id)).oqoodIssued).toBe(false);
      await database.db.insert(registrations).values({
        ...base,
        id: newId(),
        attempt: 3,
        requestId: `${id}:c`,
        status: "issued",
        registryNo: "SIM-OQD-2026-0000001",
        issuedOn: "2026-11-19",
      });
      expect((await factsOf(id)).oqoodIssued).toBe(true);
      // A transfer row never makes a primary deal's transferIssued true.
      const tgate = await approvedGate(id, "transfer_submission");
      await database.db.insert(registrations).values({
        ...base,
        id: newId(),
        kind: "oqood_transfer",
        approvalId: tgate,
        attempt: 1,
        requestId: `${id}:d`,
        status: "issued",
        registryNo: "SIM-TRF-2026-0000001",
        issuedOn: "2026-11-19",
      });
      expect((await factsOf(id)).transferIssued).toBe(false);
    });

    test("transferIssued counts the right row kind per resale type", async () => {
      for (const [type, right, wrong] of [
        ["resale_ready", "trustee_transfer", "oqood_transfer"],
        ["resale_offplan", "oqood_transfer", "trustee_transfer"],
      ] as const) {
        const id = await resaleInTransfer(type);
        const gate = await approvedGate(id, "transfer_submission");
        const row = (kind: string, n: number) => ({
          id: newId(),
          dealId: id,
          kind: kind as never,
          attempt: n,
          requestId: `${id}:${kind}`,
          status: "issued" as const,
          registryNo: `SIM-TRF-2026-000000${n}`,
          issuedOn: "2026-11-19",
          reasons: [],
          approvalId: gate,
          payloadHash: "h",
          createdAt: clock.now(),
        });
        await database.db.insert(registrations).values(row(wrong, 1));
        expect((await factsOf(id)).transferIssued, `${type} with a ${wrong} row`).toBe(false);
        await database.db.insert(registrations).values(row(right, 1));
        expect((await factsOf(id)).transferIssued, `${type} with a ${right} row`).toBe(true);
        expect((await factsOf(id)).oqoodIssued).toBe(false);
      }
    });
  });

  describe("gate proposals", () => {
    const pending = (dealId: string, gate: string) =>
      database.db
        .select()
        .from(spaApprovals)
        .where(and(eq(spaApprovals.entityId, dealId), eq(spaApprovals.gate, gate as never)));

    test("entering REGISTRATION proposes oqood_submission for the sales admin, once", async () => {
      const id = await primaryInRegistration();
      await withSpaTx(database, (tx) => proposeOnDealEntered(ctx(), { dealId: id, to: "REGISTRATION" }, tx));
      await withSpaTx(database, (tx) => proposeOnDealEntered(ctx(), { dealId: id, to: "REGISTRATION" }, tx));
      const [a, ...rest] = await pending(id, "oqood_submission");
      expect(rest).toEqual([]);
      expect([a?.status, a?.approverRole, a?.proposedBy, a?.dedupeKey]).toEqual([
        "pending",
        "sales_admin",
        "system:registry",
        `${id}:oqood_submission`,
      ]);
      expect(a?.proposal).toMatchObject({ kind: "oqood_register" });
      expect(JSON.stringify(a?.proposal)).not.toMatch(/X0000001/);
    });

    test("entering TRANSFER proposes transfer_submission with the kind of its resale type", async () => {
      for (const [type, kind] of [
        ["resale_ready", "trustee_transfer"],
        ["resale_offplan", "oqood_transfer"],
      ] as const) {
        const id = await resaleInTransfer(type);
        await withSpaTx(database, (tx) => proposeOnDealEntered(ctx(), { dealId: id, to: "TRANSFER" }, tx));
        const [a] = await pending(id, "transfer_submission");
        expect(a?.proposal).toMatchObject({ kind });
        expect(a?.dedupeKey).toBe(`${id}:transfer_submission`);
      }
    });

    test("other states propose nothing, and advance calls the hook inside its transaction", async () => {
      const id = await primaryInRegistration();
      await withSpaTx(database, (tx) => proposeOnDealEntered(ctx(), { dealId: id, to: "SIGNING" }, tx));
      expect(await pending(id, "oqood_submission")).toEqual([]);
      // The real path: ALL_SIGNED_PRIMARY enters REGISTRATION and the hook proposes in the same transaction.
      await database.db.update(deals).set({ state: "SIGNING" }).where(eq(deals.id, id));
      const [row] = await database.db.select().from(deals).where(eq(deals.id, id));
      await database.db.update(units).set({ state: "HELD" }).where(eq(units.id, row!.unitId!));
      override = { allSigned: true };
      await advance(
        ctx({ onDealEntered: (e, tx) => proposeOnDealEntered(ctx(), e, tx) }),
        { kind: "deal", id },
        "ALL_SIGNED",
        { actor: "system" },
      );
      expect(await stateOf(id)).toBe("REGISTRATION");
      expect(await pending(id, "oqood_submission")).toHaveLength(1);
    });
  });

  describe("the decision hook", () => {
    test("approving a submission gate calls the hook after commit; rejecting does not; editing is refused", async () => {
      const seen: unknown[] = [];
      const hooked = ctx({ onGateApproved: async (e) => void seen.push(e) });
      const id = await primaryInRegistration();
      const propose = (key: string) =>
        proposeApproval(ctx(), {
          gate: "oqood_submission",
          entity: { kind: "deal", id },
          dedupeKey: `${id}:${key}`,
          title: "x",
          proposal: {},
          proposedBy: "system:registry",
        });
      const a = await propose("a");
      await decideApproval(hooked, a.id, users.salesadmin!, { decision: "reject", note: "wrong unit" });
      expect(seen).toEqual([]);
      const b = await propose("b");
      expect(await fails(decideApproval(hooked, b.id, users.salesadmin!, { decision: "edit", proposal: {} }))).toEqual({
        status: 422,
        code: "edit_not_allowed",
      });
      expect(seen).toEqual([]);
      await decideApproval(hooked, b.id, users.salesadmin!, { decision: "approve" });
      expect(seen).toEqual([{ approvalId: b.id, gate: "oqood_submission", dealId: id }]);
    });

    test("a hook that throws never undoes the decision", async () => {
      const id = await primaryInRegistration();
      const a = await proposeApproval(ctx(), {
        gate: "oqood_submission",
        entity: { kind: "deal", id },
        dedupeKey: `${id}:x`,
        title: "x",
        proposal: {},
        proposedBy: "system:registry",
      });
      const quiet = console.warn;
      console.warn = () => {};
      try {
        await decideApproval(
          ctx({
            onGateApproved: async () => {
              throw new Error("queue is down");
            },
          }),
          a.id,
          users.salesadmin!,
          { decision: "approve" },
        );
      } finally {
        console.warn = quiet;
      }
      expect((await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, a.id)))[0]!.status).toBe(
        "approved",
      );
    });

    test("the queue message: one job per deal, kind and approval, named by kind", async () => {
      const sent: { name: string; data: unknown; opts: { singletonKey?: string } }[] = [];
      const boss = {
        send: async (name: string, data: unknown, opts: { singletonKey?: string }) => (
          sent.push({ name, data, opts }),
          "j"
        ),
      };
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      await onRegistryGateApproved(ctx(), boss as never, { approvalId: gate, gate: "oqood_submission", dealId: id });
      const r = await resaleInTransfer("resale_ready");
      const tgate = await approvedGate(r, "transfer_submission");
      await onRegistryGateApproved(ctx(), boss as never, { approvalId: tgate, gate: "transfer_submission", dealId: r });
      // Any other gate queues nothing.
      await onRegistryGateApproved(ctx(), boss as never, { approvalId: gate, gate: "noc_review", dealId: id });
      expect(sent).toEqual([
        {
          name: OQOOD_SUBMIT_JOB,
          data: { dealId: id, approvalId: gate, kind: "oqood_register" },
          opts: { singletonKey: `${id}:oqood_register:${gate}` },
        },
        {
          name: TRANSFER_SUBMIT_JOB,
          data: { dealId: r, approvalId: tgate, kind: "trustee_transfer" },
          opts: { singletonKey: `${r}:trustee_transfer:${tgate}` },
        },
      ]);
      expect(registryJobKey(id, "oqood_register", gate)).toBe(`${id}:oqood_register:${gate}`);
      expect([OQOOD_SUBMIT_JOB, TRANSFER_SUBMIT_JOB]).toEqual(["spa.oqood.submit", "spa.transfer.submit"]);
    });

    test("the handler runs once for one key (pg-boss)", async () => {
      const seen: unknown[] = [];
      const jobs = await startJobs(createBoss(url!), clock, { oqoodSubmit: async (d) => void seen.push(d) });
      try {
        const id = await primaryInRegistration();
        const gate = await approvedGate(id, "oqood_submission");
        await enqueueRegistration(ctx(), jobs.boss, { dealId: id, approvalId: gate });
        await enqueueRegistration(ctx(), jobs.boss, { dealId: id, approvalId: gate });
        for (let i = 0; i < 50 && seen.length === 0; i++) await Bun.sleep(100);
        await Bun.sleep(300);
        expect(seen).toEqual([{ dealId: id, approvalId: gate, kind: "oqood_register" }]);
      } finally {
        await jobs.stop();
      }
    });
  });

  describe("submitRegistration", () => {
    const fake = () => new FakeOqood({ issuedOn: "2026-11-19" });
    const run = (f: FakeOqood, dealId: string, approvalId: string) =>
      submitRegistration(ctx(), { oqood: f, transfer: f }, { dealId, approvalId });

    test("primary: sends the payload built from the deal, stores the issued number and moves the deal as system:registry", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake();
      const r = await run(f, id, gate);
      expect(r).toMatchObject({ status: "issued", attempt: 1 });
      expect(f.calls).toHaveLength(1);
      expect(f.calls[0]).toMatchObject({
        kind: "register",
        requestId: `${id}:oqood_register:1`,
        payload: {
          unitNo: "U-101",
          projectCode: null,
          developerName: "Fictional Developments LLC",
          buyers: [{ name: "Buyer One", idNo: "X0000001" }],
          priceFils: 200_000_000,
        },
      });
      const [row] = await attempts(id);
      expect(row).toMatchObject({
        kind: "oqood_register",
        attempt: 1,
        status: "issued",
        issuedOn: "2026-11-19",
        approvalId: gate,
        requestId: `${id}:oqood_register:1`,
      });
      expect(row!.registryNo).toMatch(REGISTRY_NO);
      expect(row!.payloadHash).toBe(
        createHash("sha256")
          .update(JSON.stringify(sortKeys(f.calls[0]!.payload)))
          .digest("hex"),
      );
      expect(await stateOf(id)).toBe("INSTALMENTS");
      const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, gate));
      expect(a!.consumedByEventId).not.toBeNull();
      const evs = await database.db
        .select()
        .from(dealEvents)
        .where(and(eq(dealEvents.entityId, id), eq(dealEvents.type, "REGISTERED")));
      expect(evs.map((e) => e.actor)).toEqual(["system:registry"]);
      expect(evs[0]!.payload).toMatchObject({ approvalId: gate });
      expect(await eventTypes(id)).toContain("REGISTRATION_ATTEMPTED");
      expect(await runs(id)).toEqual([]);
      const [u] = await database.db
        .select()
        .from(units)
        .where(eq(units.id, (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.unitId!));
      expect(u!.state).toBe("REGISTERED");
    });

    test("running it twice (a job retried) makes one attempt and one call", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake();
      await run(f, id, gate);
      const again = await run(f, id, gate);
      expect(again.status).toBe("skipped");
      expect(f.calls).toHaveLength(1);
      expect(await attempts(id)).toHaveLength(1);
    });

    test("a crash after the registry answered: the same request id is sent again and the first answer wins", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake();
      // The first run called the registry but never stored the row: simulate by calling it directly.
      const first = await f.register({ unitNo: "U-101" } as never, { requestId: `${id}:oqood_register:1` });
      await run(f, id, gate);
      expect(f.calls.map((c) => c.requestId)).toEqual([`${id}:oqood_register:1`, `${id}:oqood_register:1`]);
      expect((await attempts(id))[0]!.registryNo).toBe(first.ok ? first.no : "");
    });

    test("a rejection stores the attempt and the reasons, writes a needs_human row and moves nothing", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake().script({
        reject: [{ code: "BUYER_NAME_MISMATCH", field: null, message: "A buyer's name differs." }],
      });
      const r = await run(f, id, gate);
      expect(r).toMatchObject({ status: "rejected", attempt: 1 });
      const [row] = await attempts(id);
      expect(row).toMatchObject({ status: "rejected", registryNo: null, issuedOn: null });
      expect(row!.reasons.map((x) => x.code)).toEqual(["BUYER_NAME_MISMATCH"]);
      expect(await stateOf(id)).toBe("REGISTRATION");
      const [h] = await runs(id);
      expect([h?.status, h?.reasons]).toEqual(["needs_human", ["A buyer's name differs."]]);
      expect(h?.result).toMatchObject({
        kind: "oqood_register",
        attempt: 1,
        outcome: "rejected",
        codes: ["BUYER_NAME_MISMATCH"],
      });
      const f2 = await factsOf(id);
      expect([f2.oqoodIssued, f2.transferIssued]).toEqual([false, false]);
      const [a] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, gate));
      expect(a!.consumedByEventId).toBeNull();
    });

    test("an unavailable answer stores an 'unavailable' attempt and registers nothing", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake().script("unavailable");
      expect(await run(f, id, gate)).toMatchObject({ status: "unavailable", attempt: 1 });
      const [row] = await attempts(id);
      expect(row).toMatchObject({ status: "unavailable", registryNo: null });
      expect(await stateOf(id)).toBe("REGISTRATION");
      expect((await runs(id))[0]).toMatchObject({ status: "needs_human" });
      expect((await factsOf(id)).oqoodIssued).toBe(false);
    });

    test("nothing is submitted for a pending, rejected, other-deal, wrong-gate or already used approval", async () => {
      const id = await primaryInRegistration();
      const other = await primaryInRegistration();
      const mk = async (dealId: string, gate: "oqood_submission" | "transfer_submission", decide?: object) => {
        const a = await proposeApproval(ctx(), {
          gate,
          entity: { kind: "deal", id: dealId },
          dedupeKey: `${dealId}:${gate}:${newId()}`,
          title: "x",
          proposal: {},
          proposedBy: "system:registry",
        });
        if (decide) await decideApproval(ctx(), a.id, users.salesadmin!, decide);
        return a.id;
      };
      const f = fake();
      const bad = {
        pending: await mk(id, "oqood_submission"),
        rejected: await mk(id, "oqood_submission", { decision: "reject", note: "no" }),
        elsewhere: await approvedGate(other, "oqood_submission", "x"),
        wrongGate: await approvedGate(id, "transfer_submission"),
        missing: newId(),
      };
      for (const [label, approvalId] of Object.entries(bad))
        expect(await fails(run(f, id, approvalId)), label).toEqual({ status: 409, code: "gate_required" });
      expect(f.calls).toEqual([]);
      expect(await attempts(id)).toEqual([]);
      // A used approval (consumed by the step) is refused too.
      const good = await approvedGate(id, "oqood_submission", "good");
      await run(f, id, good);
      expect(f.calls).toHaveLength(1);
      const f2 = fake();
      expect(await run(f2, id, good)).toMatchObject({ status: "skipped" });
      expect(f2.calls).toEqual([]);
    });

    test("a deal in another state, or of another type, is not submitted", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      await database.db.update(deals).set({ state: "SIGNING" }).where(eq(deals.id, id));
      const f = fake();
      expect(await run(f, id, gate)).toMatchObject({ status: "skipped" });
      expect(f.calls).toEqual([]);
      // A transfer gate on a primary deal has no kind to submit.
      await database.db.update(deals).set({ state: "REGISTRATION" }).where(eq(deals.id, id));
      const tgate = await approvedGate(id, "transfer_submission");
      expect(await fails(run(f, id, tgate))).toEqual({ status: 409, code: "gate_required" });
    });

    test("a deal missing a record the registry needs names it and sends nothing (needs_human, no attempt row)", async () => {
      const made = await dealInDraft(ctx(), database, { type: "primary_offplan", buyers: ["Buyer One"] });
      const id = made.dealId;
      const [d] = await database.db.select().from(deals).where(eq(deals.id, id));
      await database.db.update(units).set({ state: "SOLD" }).where(eq(units.id, d!.unitId!));
      await database.db.update(deals).set({ state: "REGISTRATION" }).where(eq(deals.id, id));
      await markScreened(database, id);
      await database.db.execute(
        (await import("drizzle-orm")).sql`update parties set passport_no = null where id = ${made.buyerIds[0]}`,
      );
      const gate = await approvedGate(id, "oqood_submission");
      const f = fake();
      const r = await run(f, id, gate);
      expect(r).toMatchObject({ status: "incomplete" });
      expect(f.calls).toEqual([]);
      expect(await attempts(id)).toEqual([]);
      const [h] = await runs(id);
      expect([h?.status, h?.reasons]).toEqual(["needs_human", ["buyer 1 identity number"]]);
    });

    test("a ready resale books the trustee transfer and completes; the listing is sold", async () => {
      const id = await resaleInTransfer("resale_ready");
      const gate = await approvedGate(id, "transfer_submission");
      const f = fake();
      expect(await run(f, id, gate)).toMatchObject({ status: "issued" });
      expect(f.calls[0]).toMatchObject({
        kind: "book",
        requestId: `${id}:trustee_transfer:1`,
        payload: {
          unitNo: "A-101",
          projectCode: "P1",
          titleDeedNo: "TD-FICT-1",
          sellers: [{ name: "Seller One" }],
          buyers: [{ name: "Buyer One", idNo: "X0000001" }],
          priceFils: 200_000_000,
          nocPresent: true,
          serviceChargesCleared: true,
        },
      });
      expect((await attempts(id))[0]).toMatchObject({ kind: "trustee_transfer", status: "issued" });
      expect(await stateOf(id)).toBe("COMPLETED");
      const [d] = await database.db.select().from(deals).where(eq(deals.id, id));
      expect((await database.db.select().from(listings).where(eq(listings.id, d!.listingId!)))[0]!.state).toBe("SOLD");
    });

    test("an off-plan resale uses the Oqood transfer", async () => {
      const id = await resaleInTransfer("resale_offplan");
      const gate = await approvedGate(id, "transfer_submission");
      const f = fake();
      expect(await run(f, id, gate)).toMatchObject({ status: "issued" });
      expect(f.calls[0]).toMatchObject({ kind: "transfer", requestId: `${id}:oqood_transfer:1` });
      expect((await attempts(id))[0]).toMatchObject({ kind: "oqood_transfer" });
      expect(await stateOf(id)).toBe("COMPLETED");
    });

    test("after a rejection, a new proposal is raised on request; its approval makes attempt 2 and succeeds", async () => {
      const id = await primaryInRegistration();
      const first = await approvedGate(id, "oqood_submission");
      const f = fake().script({ reject: [{ code: "UNIT_NOT_FOUND", field: null, message: "No unit." }] });
      await run(f, id, first);
      // The gate that ran is decided and stays unconsumed: it cannot submit again.
      expect(await run(f, id, first)).toMatchObject({ status: "skipped" });
      const sent: unknown[] = [];
      const boss = { send: async (...a: unknown[]) => (sent.push(a), "j") };
      const req = await requestRegistration(ctx(), boss as never, id, users.officer!);
      expect(req.status).toBe("proposed");
      expect(sent).toEqual([]);
      const again = await requestRegistration(ctx(), boss as never, id, users.officer!);
      expect([again.status, again.approvalId]).toEqual(["already_pending", req.approvalId]);
      await decideApproval(ctx(), req.approvalId, users.salesadmin!, { decision: "approve" });
      expect(await run(f, id, req.approvalId)).toMatchObject({ status: "issued", attempt: 2 });
      expect((await attempts(id)).map((a) => [a.attempt, a.status, a.requestId])).toEqual([
        [1, "rejected", `${id}:oqood_register:1`],
        [2, "issued", `${id}:oqood_register:2`],
      ]);
      expect(await stateOf(id)).toBe("INSTALMENTS");
    });

    test("requesting with an approved gate that has no attempt queues its job instead of a new proposal", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      const sent: { name: string }[] = [];
      const boss = { send: async (name: string) => (sent.push({ name }), "j") };
      const r = await requestRegistration(ctx(), boss as never, id, users.salesadmin!);
      expect([r.status, r.approvalId]).toEqual(["queued", gate]);
      expect(sent).toEqual([{ name: OQOOD_SUBMIT_JOB }]);
      // A deal outside the step has nothing to request; a finance user can't.
      expect(await fails(requestRegistration(ctx(), boss as never, id, users.finance!))).toEqual({
        status: 403,
        code: "forbidden",
      });
      await database.db.update(deals).set({ state: "SIGNING" }).where(eq(deals.id, id));
      expect(await fails(requestRegistration(ctx(), boss as never, id, users.officer!))).toEqual({
        status: 409,
        code: "not_in_registration_step",
      });
    });
  });

  describe("routes", () => {
    const SECRET = "s".repeat(40);
    const NOW = Date.now();
    const app = (boss: unknown = { send: async () => "j" }) =>
      createApp({
        database,
        jobs: { boss: boss as never, lastHeartbeat: () => null },
        clock: new SpaDemoClock(database, false),
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW,
        rulebook: () => RB,
      });
    const as = (u: { id: string } | null): Record<string, string> =>
      u ? { authorization: `Bearer ${issueToken(SECRET, u.id, NOW)}` } : {};

    test("GET registrations lists attempts without the payload or any ID number; staff roles only", async () => {
      const id = await primaryInRegistration();
      const gate = await approvedGate(id, "oqood_submission");
      await run(id, gate);
      const ok = await app().request(`/api/deals/${id}/registrations`, { headers: as(users.salesadmin!) });
      expect(ok.status).toBe(200);
      const body = (await ok.json()) as { attempts: Record<string, unknown>[] };
      expect(body.attempts).toHaveLength(1);
      expect(body.attempts[0]).toMatchObject({ kind: "oqood_register", attempt: 1, status: "issued" });
      expect(JSON.stringify(body)).not.toMatch(/X0000001|payloadHash|payload_hash|requestId/);
      expect((await app().request(`/api/deals/${id}/registrations`)).status).toBe(401);
      expect((await app().request(`/api/deals/${id}/registrations`, { headers: as(users.mlro!) })).status).toBe(403);
      expect(
        (await app().request(`/api/deals/${newId()}/registrations`, { headers: as(users.salesadmin!) })).status,
      ).toBe(404);
    });

    test("POST registration/request raises a proposal; roles and state are checked", async () => {
      const id = await primaryInRegistration();
      const post = (u: { id: string } | null) =>
        app().request(`/api/deals/${id}/registration/request`, { method: "POST", headers: as(u) });
      expect((await post(null)).status).toBe(401);
      expect((await post(users.finance!)).status).toBe(403);
      const r = await post(users.officer!);
      expect(r.status).toBe(202);
      expect(await r.json()).toMatchObject({ status: "proposed" });
      expect(await (await post(users.officer!)).json()).toMatchObject({ status: "already_pending" });
      expect(
        (
          await app().request(`/api/deals/not-a-uuid/registration/request`, {
            method: "POST",
            headers: as(users.officer!),
          })
        ).status,
      ).toBe(404);
    });

    function run(id: string, gate: string) {
      const f = new FakeOqood({ issuedOn: "2026-11-19" });
      return submitRegistration(ctx(), { oqood: f, transfer: f }, { dealId: id, approvalId: gate });
    }

    test("listRegistrations reads only this deal's attempts", async () => {
      const a = await primaryInRegistration();
      const b = await primaryInRegistration();
      await run(a, await approvedGate(a, "oqood_submission"));
      expect((await listRegistrations(ctx(), b, users.salesadmin!)).attempts).toEqual([]);
      expect((await listRegistrations(ctx(), a, users.salesadmin!)).attempts).toHaveLength(1);
    });
  });
});

/** The payload hash is over the canonical (sorted-key) JSON, so key order never changes it. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object")
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .toSorted(([x], [y]) => (x < y ? -1 : 1))
        .map(([k, x]) => [k, sortKeys(x)]),
    );
  return v;
}
