import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { createApp } from "../src/app.ts";
import type { SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import type { SpaContext } from "../src/manager/context.ts";
import { SpaDomainError } from "../src/manager/errors.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  addBuilding,
  addUnit,
  createPriceList,
  createProject,
  getProject,
  publishPriceList,
  updateProject,
} from "../src/manager/inventory.ts";
import { listingStep } from "../src/manager/listings.ts";
import { updateLeadStatus } from "../src/manager/lead-status.ts";
import { recordLead, recordStaffLead } from "../src/manager/leads.ts";
import { setCompany } from "../src/manager/parties.ts";
import {
  bookViewing,
  cancelViewing,
  cancelViewingAs,
  cancelViewingByToken,
  freeSlotsFor,
  recordViewingOutcome,
  rescheduleViewing,
  sendViewingMail,
  viewingMailRows,
} from "../src/manager/viewings.ts";
import { seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
// Wednesday 2026-11-25 10:00 Dubai. Viewing days Mon-Sat 10-18, 30 minutes, lead 4 h, 14 days (the code default).
const START = new Date("2026-11-25T06:00:00Z");
const SECRET = "test-secret-test-secret-test-secret";
const dubai = (local: string) => new Date(`${local}+04:00`).toISOString();

const visitor = (ref: string, over: Record<string, unknown> = {}) => ({
  ref,
  name: "Visitor One",
  email: "visitor.one@example.test",
  message: "Is it still available?",
  consent: true,
  ...over,
});
const book = (ref: string, slot: string, over: Record<string, unknown> = {}) => {
  const { message: _m, ...rest } = visitor(ref, over);
  return { ...rest, slot };
};

async function expectError(p: Promise<unknown>, status: number, code: string) {
  const e = await p.then(
    () => null,
    (x: unknown) => x,
  );
  expect(e).toBeInstanceOf(SpaDomainError);
  const got: { status: number; code: string } = {
    status: (e as SpaDomainError).status,
    code: (e as SpaDomainError).code,
  };
  expect(got).toEqual({ status, code });
}

describe.skipIf(!url)("M5: leads and viewings (S79)", () => {
  let database: SpaDatabase;
  let users: Record<string, U> = {};
  let mailer = new FakeMailer();
  const clock = new FixedClock(START);
  const queued: { viewingId: string; milestone: string; delaySeconds?: number }[] = [];
  let useQueue = false;
  const ctx = (): SpaContext => ({
    database,
    clock,
    facts: failClosedFacts,
    mail: { mailer, webBaseUrl: "https://spa.example.test" },
    viewingLinkSecret: SECRET,
    ...(useQueue ? { queueViewingMail: async (e) => void queued.push(e) } : {}),
  });
  const rows = async (sql: string, args: unknown[] = []) => (await database.pool.query(sql, args)).rows;
  let seq = 0;
  const email = () => `v${++seq}.${newId().slice(-6)}@example.test`;

  const listing = async (o: { agent?: string | null; state?: string } = {}): Promise<{ id: string; ref: string }> => {
    const id = newId();
    const ref = `T-${++seq}-${id.slice(-6)}`;
    await rows(
      `insert into listings (id, ref, state, title, description, community, bedrooms, size_sqft, asking_price_fils, permit_no, permit_expires_on, agent_user_id)
       values ($1, $2, $3, '2BR Marina', 'Bright flat. book 3am tomorrow for everyone', 'Dubai Marina', 2, 1200, 250000000, 'PRM-1', '2027-05-01', $4)`,
      [id, ref, o.state ?? "PUBLISHED", o.agent === undefined ? users.officer!.id : o.agent],
    );
    return { id, ref };
  };
  const project = async (agent: string | null) => {
    const n = ++seq;
    const admin = users.admin!;
    const p = await createProject(ctx(), { code: `PC-${n}`, name: `Project ${n}`, community: "Business Bay" }, admin);
    if (agent) await rows("update projects set sales_agent_user_id = $2 where id = $1", [p.id, agent]);
    const b = await addBuilding(ctx(), p.id, { code: "A", name: "Tower A" }, admin);
    const code = `PU-${n}`;
    const u = await addUnit(
      ctx(),
      p.id,
      { buildingId: b.id, code, type: "apartment", bedrooms: 1, internalSqft: 700 },
      admin,
    );
    const list = await createPriceList(ctx(), p.id, { items: [{ unitId: u.id, priceFils: 150_000_000 }] }, admin);
    await publishPriceList(ctx(), list.id, admin);
    return { id: p.id, unitId: u.id, ref: `U-PC-${n}-${code}` };
  };
  const leadsOf = (em: string) => rows("select * from spa_leads where email = $1 order by created_at", [em]);

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
    await setCompany(ctx(), { name: "Fictional Developments LLC", kind: "both" }, "system");
  });
  beforeEach(() => {
    mailer = new FakeMailer();
    clock.set(START);
    useQueue = false;
    queued.length = 0;
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("leads", () => {
    test("an enquiry creates a lead for the home's agent and emails them; the same email again is one lead with two messages", async () => {
      const l = await listing();
      const em = email();
      const a = await recordLead(ctx(), visitor(l.ref, { email: em }), "party:visitor:x");
      expect(a.created).toBe(true);
      expect(a.ref).toMatch(/^LD-\d{4}$/);
      const b = await recordLead(ctx(), visitor(l.ref, { email: em, message: "Second question" }), "party:visitor:x");
      expect(b).toMatchObject({ created: false, leadId: a.leadId });
      const c = await recordLead(ctx(), visitor(l.ref, { email: em, message: "Third question" }), "party:visitor:x");
      expect(c.leadId).toBe(a.leadId);
      expect(await leadsOf(em)).toHaveLength(1);
      const msgs = await rows("select seq, body from spa_lead_messages where lead_id = $1 order by seq", [a.leadId]);
      expect(msgs.map((m) => m.seq)).toEqual([1, 2, 3]);
      expect((await leadsOf(em))[0]).toMatchObject({ status: "new", agent_user_id: users.officer!.id, source: "form" });
      // One "new enquiry" mail per message to the agent, none to the visitor.
      expect(mailer.sent.filter((m) => m.to === "officer@spa-demo.test")).toHaveLength(3);
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(0);
      // Events never carry the visitor's email.
      const ev = await rows(
        "select payload::text as p from deal_events where entity_kind = 'lead' and entity_id = $1",
        [a.leadId],
      );
      expect(ev.length).toBeGreaterThanOrEqual(3);
      expect(ev.every((e) => !e.p.includes(em))).toBe(true);
    });

    test("a different home is a separate lead", async () => {
      const a = await listing();
      const b = await listing();
      const em = email();
      const x = await recordLead(ctx(), visitor(a.ref, { email: em }), "party:visitor:x");
      const y = await recordLead(ctx(), visitor(b.ref, { email: em }), "party:visitor:x");
      expect(x.leadId).not.toBe(y.leadId);
      expect(await leadsOf(em)).toHaveLength(2);
    });

    test("a unit's lead goes to the project's sales agent, or to nobody", async () => {
      const withAgent = await project(users.officer!.id);
      const without = await project(null);
      const a = await recordLead(ctx(), visitor(withAgent.ref, { email: email() }), "party:visitor:x");
      const b = await recordLead(ctx(), visitor(without.ref, { email: email() }), "party:visitor:x");
      const [ra] = await rows("select agent_user_id, unit_id, property_kind from spa_leads where id = $1", [a.leadId]);
      const [rb] = await rows("select agent_user_id from spa_leads where id = $1", [b.leadId]);
      expect(ra).toMatchObject({ agent_user_id: users.officer!.id, unit_id: withAgent.unitId, property_kind: "unit" });
      expect(rb.agent_user_id).toBeNull();
    });

    test("the project's sales agent is set from the project form, must be an active sales user, and new leads use it", async () => {
      const p = await project(null);
      await expectError(
        updateProject(ctx(), p.id, { salesAgentUserId: users.finance!.id }, users.admin!),
        422,
        "invalid_agent",
      );
      await expectError(updateProject(ctx(), p.id, { salesAgentUserId: newId() }, users.admin!), 422, "invalid_agent");
      await expectError(
        updateProject(ctx(), p.id, { salesAgentUserId: users.manager!.id }, users.officer!),
        403,
        "forbidden",
      );
      await updateProject(ctx(), p.id, { salesAgentUserId: users.manager!.id }, users.admin!);
      expect((await getProject(ctx(), users.admin!, p.id)).salesAgent).toEqual({
        id: users.manager!.id,
        name: "manager",
      });
      const r = await recordLead(ctx(), visitor(p.ref, { email: email() }), "party:visitor:x");
      expect((await rows("select agent_user_id from spa_leads where id = $1", [r.leadId]))[0].agent_user_id).toBe(
        users.manager!.id,
      );
      await updateProject(ctx(), p.id, { salesAgentUserId: null }, users.admin!);
      expect((await getProject(ctx(), users.admin!, p.id)).salesAgent).toBeNull();
      // A lead made before the change keeps its agent.
      expect((await rows("select agent_user_id from spa_leads where id = $1", [r.leadId]))[0].agent_user_id).toBe(
        users.manager!.id,
      );
    });

    test("no consent, a bad email, a non-public home: nothing stored", async () => {
      const l = await listing();
      const draft = await listing({ state: "DRAFT" });
      await expectError(recordLead(ctx(), visitor(l.ref, { consent: false }), "party:visitor:x"), 422, "invalid_lead");
      await expectError(recordLead(ctx(), visitor(l.ref, { email: "nope" }), "party:visitor:x"), 422, "invalid_lead");
      await expectError(recordLead(ctx(), visitor(draft.ref), "party:visitor:x"), 404, "not_found");
      await expectError(recordLead(ctx(), visitor("L-9999-nothing"), "party:visitor:x"), 404, "not_found");
    });

    test("an email can send only the policy's number of enquiries a day", async () => {
      const l = await listing();
      const em = email();
      for (let i = 0; i < 5; i++)
        await recordLead(ctx(), visitor(l.ref, { email: em, message: `q${i}` }), "party:visitor:x");
      await expectError(recordLead(ctx(), visitor(l.ref, { email: em }), "party:visitor:x"), 429, "rate_limited");
    });

    test("status moves: contacted, interested, closed needs a note; a closed lead is final; an officer can't touch another's lead", async () => {
      const l = await listing();
      const r = await recordLead(ctx(), visitor(l.ref, { email: email() }), "party:visitor:x");
      await updateLeadStatus(ctx(), r.leadId, "contacted", users.officer!);
      await updateLeadStatus(ctx(), r.leadId, "interested", users.officer!);
      await expectError(updateLeadStatus(ctx(), r.leadId, "closed", users.officer!), 422, "note_required");
      await expectError(updateLeadStatus(ctx(), r.leadId, "converted", users.officer!), 422, "invalid_status");
      await expectError(updateLeadStatus(ctx(), r.leadId, "viewing_booked", users.officer!), 422, "invalid_status");
      await updateLeadStatus(ctx(), r.leadId, "closed", users.manager!, "Bought elsewhere");
      await expectError(updateLeadStatus(ctx(), r.leadId, "contacted", users.manager!), 409, "lead_finished");
      const other = await recordLead(
        ctx(),
        visitor((await listing({ agent: users.manager!.id })).ref, { email: email() }),
        "party:visitor:x",
      );
      await expectError(updateLeadStatus(ctx(), other.leadId, "contacted", users.officer!), 403, "forbidden");
      await expectError(updateLeadStatus(ctx(), r.leadId, "contacted", users.finance!), 403, "forbidden");
      // After closing, a new enquiry opens a new lead.
      const again = await recordLead(
        ctx(),
        visitor(l.ref, { email: (await rows("select email from spa_leads where id = $1", [r.leadId]))[0].email }),
        "party:visitor:x",
      );
      expect(again.created).toBe(true);
    });

    test("a name can't carry a link, an address or a number (it is greeted in mail to the visitor's address)", async () => {
      const l = await listing();
      for (const name of ["Click http://x.test now", "pay@bank.test", "Visitor 12345", "A", "<b>Bold</b>"])
        await expectError(
          recordLead(ctx(), visitor(l.ref, { email: email(), name }), "party:visitor:x"),
          422,
          "invalid_lead",
        );
      for (const name of ["Sara Khan", "Jean-Luc O'Neil", "Dr. María José", "فاطمة الزهراء"])
        await recordLead(ctx(), visitor(l.ref, { email: email(), name }), "party:visitor:x");
    });

    test("staff can type in a lead (source staff)", async () => {
      const l = await listing();
      const r = await recordStaffLead(
        ctx(),
        { ref: l.ref, name: "Phone Caller", email: email(), message: "Called the office" },
        users.officer!,
      );
      const [row] = await rows("select source from spa_leads where id = $1", [r.leadId]);
      expect(row.source).toBe("staff");
      await expect(
        recordStaffLead(ctx(), { ref: l.ref, name: "X Y", email: email(), message: "hi" }, users.finance!),
      ).rejects.toThrow();
    });
  });

  describe("viewings", () => {
    test("free slots follow the policy, skip taken ones of the same agent (any home), and start after the lead time", async () => {
      const a = await listing();
      const b = await listing();
      const slots = await freeSlotsFor(ctx(), { kind: "listing", ref: a.ref }, 3);
      expect(slots).toEqual([dubai("2026-11-25T14:00:00"), dubai("2026-11-25T14:30:00"), dubai("2026-11-25T15:00:00")]);
      await bookViewing(ctx(), book(b.ref, slots[0]!, { email: email() }), "party:visitor:x");
      // The same agent has the 14:00 slot on the other home: it's gone here too.
      expect((await freeSlotsFor(ctx(), { kind: "listing", ref: a.ref }, 2))[0]).toBe(dubai("2026-11-25T14:30:00"));
      // A different kind for the same ref has none.
      expect(await freeSlotsFor(ctx(), { kind: "unit", ref: a.ref }, 3)).toEqual([]);
    });

    test("booking creates the lead, sets viewing_booked, stores the viewing with a hashed token and emails visitor and agent", async () => {
      const l = await listing();
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(
        ctx(),
        book(l.ref, slot!, { email: em, phone: "+971 50 123 4567" }),
        "party:visitor:x",
      );
      expect(r.startsAt).toBe(slot!);
      const [lead] = await leadsOf(em);
      expect(lead.status).toBe("viewing_booked");
      const [v] = await rows("select * from spa_viewings where id = $1", [r.viewingId]);
      expect(v).toMatchObject({ status: "booked", agent_user_id: users.officer!.id, lead_id: r.leadId });
      expect(v.cancel_token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(new Date(v.ends_at).getTime() - new Date(v.starts_at).getTime()).toBe(30 * 60_000);
      const toVisitor = mailer.sent.find((m) => m.to === em)!;
      expect(toVisitor.subject).toContain("Your viewing is booked");
      expect(toVisitor.text).toMatch(/https:\/\/spa\.example\.test\/v\/[\w-]{43}\/cancel/);
      expect(toVisitor.text).toContain("(Dubai)");
      expect(mailer.sent.some((m) => m.to === "officer@spa-demo.test" && m.subject.startsWith("New viewing"))).toBe(
        true,
      );
      // The raw token is not in the database.
      const tokenInMail = /\/v\/([\w-]{43})\/cancel/.exec(toVisitor.text)![1]!;
      expect(JSON.stringify(v)).not.toContain(tokenInMail);
      const stored = await viewingMailRows(ctx(), r.viewingId);
      expect(stored.map((s) => s.milestone).sort()).toEqual(["agent:new", "invite"]);
    });

    test("a booking sends the agent one email (New viewing) that carries the visitor's own words; no separate New enquiry", async () => {
      const l = await listing();
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      await bookViewing(
        ctx(),
        { ...book(l.ref, slot!, { email: em }), message: "Is parking included?" },
        "party:visitor:x",
      );
      const toAgent = mailer.sent.filter((m) => m.to === "officer@spa-demo.test");
      expect(toAgent.map((m) => m.subject.split(" · ")[0])).toEqual(["New viewing"]);
      expect(toAgent[0]!.text).toContain("Is parking included?");
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      // No message: nothing of the default line in the agent's mail.
      const [, s2] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 2);
      mailer.sent.length = 0;
      await bookViewing(ctx(), book(l.ref, s2!, { email: email() }), "party:visitor:x");
      expect(mailer.sent.find((m) => m.to === "officer@spa-demo.test")!.text).not.toContain("Booked a viewing.");
    });

    test("two visitors at the same slot at once: one booking, the other 409 slot_taken (Review Focus 1)", async () => {
      const l = await listing();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const results = await Promise.allSettled([
        bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x"),
        bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x"),
        bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x"),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      for (const r of results.filter((r) => r.status === "rejected")) {
        expect((r as PromiseRejectedResult).reason).toBeInstanceOf(SpaDomainError);
        expect((r as PromiseRejectedResult).reason.code).toBe("slot_taken");
      }
      const booked = await rows("select 1 from spa_viewings where starts_at = $1 and status = 'booked'", [slot]);
      expect(booked).toHaveLength(1);
      // The losers left no lead behind.
      const leads = await rows(
        "select 1 from spa_leads l join spa_lead_messages m on m.lead_id = l.id where l.created_at >= $1",
        [START],
      );
      expect(leads.length).toBeGreaterThan(0);
    });

    test("a slot off the grid or in the past is 422 slot_unavailable", async () => {
      const l = await listing();
      await expectError(
        bookViewing(ctx(), book(l.ref, dubai("2026-11-25T14:15:00"), { email: email() }), "party:visitor:x"),
        422,
        "slot_unavailable",
      );
      await expectError(
        bookViewing(ctx(), book(l.ref, dubai("2026-11-25T11:00:00"), { email: email() }), "party:visitor:x"),
        422,
        "slot_unavailable",
      );
      // Friday is a viewing day; Sunday (29 Nov) is not.
      await expectError(
        bookViewing(ctx(), book(l.ref, dubai("2026-11-29T11:00:00"), { email: email() }), "party:visitor:x"),
        422,
        "slot_unavailable",
      );
      await expectError(
        bookViewing(ctx(), book(l.ref, dubai("2027-03-02T11:00:00"), { email: email() }), "party:visitor:x"),
        422,
        "slot_unavailable",
      );
    });

    test("a home without an agent: its own slots are guarded", async () => {
      const l = await listing({ agent: null });
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      await bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x");
      await expectError(
        bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x"),
        409,
        "slot_taken",
      );
    });

    test("withdrawing the listing cancels its future viewings, emails the visitor once, and the reminder then skips (Review Focus 2)", async () => {
      const l = await listing();
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(ctx(), book(l.ref, slot!, { email: em }), "party:visitor:x");
      mailer.sent.length = 0;
      await listingStep(ctx(), l.id, "UNPUBLISH", {
        actor: `user:${users.manager!.id}`,
        payload: { reason: "owner changed mind" },
      });
      const [after] = await rows("select status, cancel_reason from spa_viewings where id = $1", [r.viewingId]);
      expect(after).toEqual({ status: "cancelled", cancel_reason: "The home is no longer available" });
      await sendViewingMail(ctx(), r.viewingId, "cancel");
      await sendViewingMail(ctx(), r.viewingId, "cancel");
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      expect(mailer.sent.find((m) => m.to === em)!.text).toContain("no longer available");
      // A reminder that fires later finds it cancelled.
      clock.set(new Date(new Date(slot!).getTime() - 3_600_000));
      await sendViewingMail(ctx(), r.viewingId, "reminder");
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      // The lead is no longer "viewing booked".
      const [lead] = await leadsOf(em);
      expect(lead.status).toBe("new");
    });

    test("the reminder job runs twice: one mail; it waits until 24 hours before", async () => {
      const l = await listing();
      const em = email();
      useQueue = true;
      const slot = dubai("2026-11-27T11:00:00");
      const r = await bookViewing(ctx(), book(l.ref, slot, { email: em }), "party:visitor:x");
      // The confirmation and the reminder are queued, not sent inline; the reminder waits for 24 h before.
      expect(queued.map((q) => q.milestone)).toEqual(["invite", "reminder"]);
      // 24 hours before 2026-11-27 11:00 Dubai is 2026-11-26 11:00; the clock is at 2026-11-25 10:00 Dubai: 25 hours.
      expect(queued[1]!.delaySeconds).toBe(25 * 3600);
      await sendViewingMail(ctx(), r.viewingId, "invite");
      await sendViewingMail(ctx(), r.viewingId, "reminder"); // too early: nothing
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      clock.set(new Date(dubai("2026-11-26T11:30:00")));
      await sendViewingMail(ctx(), r.viewingId, "reminder");
      await sendViewingMail(ctx(), r.viewingId, "reminder");
      const mine = mailer.sent.filter((m) => m.to === em);
      expect(mine).toHaveLength(2);
      expect(mine[1]!.subject).toContain("Reminder");
      // A viewing booked inside the window gets no separate reminder job.
      queued.length = 0;
      await bookViewing(ctx(), book(l.ref, dubai("2026-11-26T16:00:00"), { email: email() }), "party:visitor:x");
      expect(queued.map((q) => q.milestone)).toEqual(["invite"]);
    });

    test("the visitor's cancel link works once; the second click is 'already cancelled' with no second email (Review Focus 3)", async () => {
      const l = await listing();
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(ctx(), book(l.ref, slot!, { email: em }), "party:visitor:x");
      const token = /\/v\/([\w-]{43})\/cancel/.exec(mailer.sent.find((m) => m.to === em)!.text)![1]!;
      mailer.sent.length = 0;
      expect(await cancelViewingByToken(ctx(), token)).toEqual({ status: "cancelled" });
      expect(await cancelViewingByToken(ctx(), token)).toEqual({ status: "already_cancelled" });
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      expect(mailer.sent[0]!.text).toContain("as you asked");
      expect(await cancelViewingByToken(ctx(), "x".repeat(43))).toEqual({ status: "not_found" });
      expect(await cancelViewingByToken(ctx(), "short")).toEqual({ status: "not_found" });
      // The slot is free again.
      expect((await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1))[0]).toBe(slot!);
      const [row] = await rows("select status, cancel_reason from spa_viewings where id = $1", [r.viewingId]);
      expect(row).toEqual({ status: "cancelled", cancel_reason: "Cancelled by the visitor" });
    });

    test("staff cancel needs a reason and emails once; a cancelled viewing can't be cancelled again", async () => {
      const l = await listing();
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(ctx(), book(l.ref, slot!, { email: em }), "party:visitor:x");
      await expectError(cancelViewingAs(ctx(), r.viewingId, "", users.officer!), 422, "reason_required");
      await cancelViewingAs(ctx(), r.viewingId, "Agent is ill", users.officer!);
      await expectError(cancelViewingAs(ctx(), r.viewingId, "Again please", users.officer!), 409, "not_booked");
      expect(mailer.sent.filter((m) => m.to === em && m.subject.startsWith("Viewing cancelled"))).toHaveLength(1);
      await expectError(cancelViewing(ctx(), newId(), "No such viewing", "system"), 404, "not_found");
    });

    test("closing a lead (or marking it not interested) cancels its future viewings and emails the visitor once; a started one keeps waiting", async () => {
      for (const status of ["closed", "not_interested"] as const) {
        const l = await listing();
        const em = email();
        const [s1, s2] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 2);
        const a = await bookViewing(ctx(), book(l.ref, s1!, { email: em }), "party:visitor:x");
        await bookViewing(ctx(), book(l.ref, s2!, { email: em }), "party:visitor:x");
        mailer.sent.length = 0;
        await updateLeadStatus(ctx(), a.leadId, status, users.officer!, "Bought elsewhere");
        const rows2 = await rows("select status, cancel_reason from spa_viewings where lead_id = $1", [a.leadId]);
        expect(rows2.map((r) => r.status)).toEqual(["cancelled", "cancelled"]);
        expect(rows2[0].cancel_reason).toBe("The enquiry was closed");
        // The slots are free for others again; the lead has the final status; each viewing was mailed once.
        expect((await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1))[0]).toBe(s1!);
        expect((await leadsOf(em))[0].status).toBe(status);
        const mine = mailer.sent.filter((m) => m.to === em);
        expect(mine).toHaveLength(2);
        expect(mine[0]!.text).toContain("closed your enquiry");
        const ev = await rows(
          "select from_state, to_state from deal_events where entity_kind = 'lead' and entity_id = $1 and type = 'LEAD_STATUS' order by at desc, id desc",
          [a.leadId],
        );
        expect(ev[0].to_state).toBe(status);
      }
      // A viewing that has started is left for its outcome.
      const l = await listing();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x");
      clock.set(new Date(new Date(slot!).getTime() + 3_600_000));
      await updateLeadStatus(ctx(), r.leadId, "not_interested", users.officer!);
      expect((await rows("select status from spa_viewings where id = $1", [r.viewingId]))[0].status).toBe("booked");
    });

    test("an outcome needs a viewing that has started; nothing marks a no-show by itself (Review Focus 4)", async () => {
      const l = await listing();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const r = await bookViewing(ctx(), book(l.ref, slot!, { email: email() }), "party:visitor:x");
      await expectError(
        recordViewingOutcome(ctx(), r.viewingId, "attended", undefined, users.officer!),
        409,
        "viewing_not_started",
      );
      clock.set(new Date(new Date(slot!).getTime() + 3 * 86_400_000));
      const [still] = await rows("select status from spa_viewings where id = $1", [r.viewingId]);
      expect(still.status).toBe("booked");
      await expectError(
        recordViewingOutcome(ctx(), r.viewingId, "gone", undefined, users.officer!),
        422,
        "invalid_outcome",
      );
      await recordViewingOutcome(ctx(), r.viewingId, "no_show", "Did not come", users.officer!);
      await expectError(
        recordViewingOutcome(ctx(), r.viewingId, "attended", undefined, users.officer!),
        409,
        "not_booked",
      );
      const [row] = await rows("select status, outcome_note from spa_viewings where id = $1", [r.viewingId]);
      expect(row).toEqual({ status: "no_show", outcome_note: "Did not come" });
    });

    test("reschedule keeps the lead, frees the old slot, and the visitor gets one new confirmation", async () => {
      const l = await listing();
      const em = email();
      const [s1, s2] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 2);
      const r = await bookViewing(ctx(), book(l.ref, s1!, { email: em }), "party:visitor:x");
      mailer.sent.length = 0;
      const moved = await rescheduleViewing(ctx(), r.viewingId, s2!, users.officer!);
      const [old] = await rows("select status, cancel_reason, lead_id from spa_viewings where id = $1", [r.viewingId]);
      const [fresh] = await rows("select status, lead_id, starts_at from spa_viewings where id = $1", [
        moved.viewingId,
      ]);
      expect(old).toMatchObject({ status: "cancelled", cancel_reason: "Rescheduled", lead_id: r.leadId });
      expect(fresh).toMatchObject({ status: "booked", lead_id: r.leadId });
      expect(new Date(fresh.starts_at).toISOString()).toBe(s2!);
      const [lead] = await leadsOf(em);
      expect(lead.status).toBe("viewing_booked");
      expect(mailer.sent.filter((m) => m.to === em).map((m) => m.subject)).toEqual([
        expect.stringContaining("Your viewing is booked"),
      ]);
      // The old viewing sends no cancellation.
      await sendViewingMail(ctx(), r.viewingId, "cancel");
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      // A taken slot refuses the move.
      const other = await bookViewing(ctx(), book(l.ref, s1!, { email: email() }), "party:visitor:x");
      await expectError(rescheduleViewing(ctx(), other.viewingId, s2!, users.officer!), 409, "slot_taken");
    });

    test("a unit that leaves AVAILABLE cancels its future viewings", async () => {
      const p = await project(users.officer!.id);
      const em = email();
      const [slot] = await freeSlotsFor(ctx(), { kind: "unit", ref: p.ref }, 1);
      const r = await bookViewing(ctx(), book(p.ref, slot!, { email: em }), "party:visitor:x");
      const { moveProperty } = await import("../src/manager/advance.ts");
      const { withSpaTx } = await import("@spa/db");
      await withSpaTx(database, (tx) =>
        moveProperty(ctx(), tx, { kind: "unit", id: p.unitId }, "HOLD", { actor: "system" }),
      );
      const [row] = await rows("select status, cancel_reason from spa_viewings where id = $1", [r.viewingId]);
      expect(row.status).toBe("cancelled");
      expect(row.cancel_reason).toBe("The home is no longer available");
    });

    test("without mail configured nothing can be booked", async () => {
      const l = await listing();
      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: l.ref }, 1);
      const c = { ...ctx() } as SpaContext;
      delete (c as { mail?: unknown }).mail;
      await expectError(
        bookViewing(c, book(l.ref, slot!, { email: email() }), "party:visitor:x"),
        503,
        "mail_unavailable",
      );
    });
  });

  describe("routes", () => {
    const NOW_MS = START.getTime();
    const makeApp = () =>
      createApp({
        database,
        jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
        clock: clock as never,
        sessionSecret: SECRET,
        demoMode: false,
        nowMs: () => NOW_MS,
        mail: { mailer, webBaseUrl: "https://spa.example.test" },
      });
    const post = (app: ReturnType<typeof createApp>, path: string, body: unknown, as?: U, ip = "198.51.100.1") =>
      app.request(path, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": ip,
          ...(as ? { authorization: `Bearer ${issueToken(SECRET, as.id, NOW_MS)}` } : {}),
        },
        body: JSON.stringify(body),
      });
    const getAs = (app: ReturnType<typeof createApp>, path: string, as: U) =>
      app.request(path, { headers: { authorization: `Bearer ${issueToken(SECRET, as.id, NOW_MS)}` } });

    test("slots, enquiry and booking happy paths; a non-public reference is 404; nothing of another visitor is echoed", async () => {
      const app = makeApp();
      const l = await listing();
      const draft = await listing({ state: "DRAFT" });
      const s = await app.request(`/public/catalogue/${l.ref}/slots`);
      expect(s.status).toBe(200);
      const slots = ((await s.json()) as { slots: string[] }).slots;
      expect(slots.length).toBeGreaterThan(3);
      expect((await app.request(`/public/catalogue/${draft.ref}/slots`)).status).toBe(404);
      expect((await app.request(`/public/catalogue/nothing/slots`)).status).toBe(404);

      const em = email();
      const e1 = await post(app, `/public/catalogue/${l.ref}/enquiries`, visitor(l.ref, { email: em }));
      expect(e1.status).toBe(201);
      const e2 = await post(app, `/public/catalogue/${l.ref}/enquiries`, visitor(l.ref, { email: em }));
      // The same answer whether or not this email had a lead: nothing to learn about other visitors.
      expect(await e2.json()).toEqual(await e1.clone().json());
      expect(await e1.json()).toEqual({ ok: true });
      expect(await leadsOf(em)).toHaveLength(1);

      const b = await post(
        app,
        `/public/catalogue/${l.ref}/viewings`,
        book(l.ref, slots[0]!, { email: em, phone: "0501234567" }),
      );
      expect(b.status).toBe(201);
      expect(await b.json()).toEqual({ ok: true, startsAt: slots[0] });
      const taken = await post(app, `/public/catalogue/${l.ref}/viewings`, book(l.ref, slots[0]!, { email: email() }));
      expect(taken.status).toBe(409);
      expect(((await taken.json()) as { code: string }).code).toBe("slot_taken");
      const after = ((await (await app.request(`/public/catalogue/${l.ref}/slots`)).json()) as { slots: string[] })
        .slots;
      expect(after).not.toContain(slots[0]);
      expect((await post(app, `/public/catalogue/${draft.ref}/enquiries`, visitor(draft.ref))).status).toBe(404);
      expect((await post(app, `/public/catalogue/${draft.ref}/viewings`, book(draft.ref, slots[0]!))).status).toBe(404);
    });

    test("missing consent is 422, a bad body 422, and a path reference wins over the body's", async () => {
      const app = makeApp();
      const l = await listing();
      const other = await listing();
      const noConsent = await post(
        app,
        `/public/catalogue/${l.ref}/enquiries`,
        visitor(l.ref, { consent: false, email: email() }),
      );
      expect(noConsent.status).toBe(422);
      expect(
        (
          await post(app, `/public/catalogue/${l.ref}/viewings`, {
            ...book(l.ref, dubai("2026-11-26T11:00:00")),
            consent: undefined,
          })
        ).status,
      ).toBe(422);
      expect((await post(app, `/public/catalogue/${l.ref}/enquiries`, "not json" as never)).status).toBe(422);
      const em = email();
      await post(app, `/public/catalogue/${l.ref}/enquiries`, visitor(other.ref, { email: em }));
      const [lead] = await leadsOf(em);
      expect(lead.listing_id).toBe(l.id);
    });

    test("too many writes from one address: 429", async () => {
      const app = makeApp();
      const l = await listing();
      let last = 0;
      for (let i = 0; i < 21; i++)
        last = (
          await post(
            app,
            `/public/catalogue/${l.ref}/enquiries`,
            visitor(l.ref, { consent: false }),
            undefined,
            "198.51.100.77",
          )
        ).status;
      expect(last).toBe(429);
      // Another address is unaffected.
      expect(
        (
          await post(
            app,
            `/public/catalogue/${l.ref}/enquiries`,
            visitor(l.ref, { consent: false }),
            undefined,
            "198.51.100.78",
          )
        ).status,
      ).toBe(422);
    });

    test("the per-home hourly cap from the policy: the next visitor is 429", async () => {
      const app = makeApp();
      const l = await listing();
      const policy = (await rows("select values from spa_policy order by version desc limit 1"))[0]?.values;
      const { DEFAULT_SPA_POLICY } = await import("@spa/core");
      const publish = (values: unknown) =>
        rows(
          "insert into spa_policy (version, values, created_by, created_at) select coalesce(max(version), 0) + 1, $1::jsonb, 'test', now() from spa_policy",
          [JSON.stringify(values)],
        );
      await publish({
        ...DEFAULT_SPA_POLICY,
        listingChat: { messagesPerListingPerHour: 200, enquiriesPerListingPerHour: 2 },
      });
      try {
        const codes: number[] = [];
        for (let i = 0; i < 3; i++)
          codes.push(
            (
              await post(
                app,
                `/public/catalogue/${l.ref}/enquiries`,
                visitor(l.ref, { email: email() }),
                undefined,
                `198.51.100.${100 + i}`,
              )
            ).status,
          );
        expect(codes).toEqual([201, 201, 429]);
      } finally {
        await publish(policy ?? DEFAULT_SPA_POLICY);
      }
    });

    test("the cancel link: the first click cancels, the second says already cancelled with no second email, a made-up one is not found", async () => {
      const app = makeApp();
      const l = await listing();
      const em = email();
      const slots = ((await (await app.request(`/public/catalogue/${l.ref}/slots`)).json()) as { slots: string[] })
        .slots;
      await post(app, `/public/catalogue/${l.ref}/viewings`, book(l.ref, slots[2]!, { email: em }));
      const token = /\/v\/([\w-]{43})\/cancel/.exec(mailer.sent.find((m) => m.to === em)!.text)![1]!;
      mailer.sent.length = 0;
      const one = await post(app, "/public/viewings/cancel", { token });
      expect(await one.json()).toEqual({ status: "cancelled" });
      const two = await post(app, "/public/viewings/cancel", { token });
      expect(await two.json()).toEqual({ status: "already_cancelled" });
      expect(mailer.sent.filter((m) => m.to === em)).toHaveLength(1);
      expect(await (await post(app, "/public/viewings/cancel", { token: "y".repeat(43) })).json()).toEqual({
        status: "not_found",
      });
      expect(await (await post(app, "/public/viewings/cancel", { nope: 1 })).json()).toEqual({ status: "not_found" });
    });

    test("staff routes: officers see their own leads, finance none; outcome and cancel need the right state; reads carry no enum text", async () => {
      const app = makeApp();
      const mine = await listing();
      const theirs = await listing({ agent: users.manager!.id });
      const a = await recordLead(ctx(), visitor(mine.ref, { email: email(), name: "Mine Visitor" }), "party:visitor:x");
      const b = await recordLead(
        ctx(),
        visitor(theirs.ref, { email: email(), name: "Their Visitor" }),
        "party:visitor:x",
      );
      const list = async (u: U, qs = "") =>
        (
          (await (await getAs(app, `/api/leads${qs}`, u)).json()) as {
            items: { id: string; statusLabel: string; sourceLabel: string }[];
          }
        ).items;
      const officerIds = (await list(users.officer!)).map((i) => i.id);
      expect(officerIds).toContain(a.leadId);
      expect(officerIds).not.toContain(b.leadId);
      const managerIds = (await list(users.manager!)).map((i) => i.id);
      expect(managerIds).toEqual(expect.arrayContaining([a.leadId, b.leadId]));
      expect((await list(users.manager!, "?mine=1")).map((i) => i.id)).not.toContain(a.leadId);
      expect((await getAs(app, "/api/leads", users.finance!)).status).toBe(403);
      expect((await app.request("/api/leads")).status).toBe(401);
      expect((await getAs(app, `/api/leads/${b.leadId}`, users.officer!)).status).toBe(403);
      const rec = (await (await getAs(app, `/api/leads/${a.leadId}`, users.officer!)).json()) as Record<string, any>;
      expect(rec).toMatchObject({ name: "Mine Visitor", statusLabel: "New", sourceLabel: "Property page form" });
      expect(rec.messages[0].body).toBe("Is it still available?");
      expect((await list(users.officer!)).every((i) => !/_/.test(i.statusLabel + i.sourceLabel))).toBe(true);

      const [slot] = await freeSlotsFor(ctx(), { kind: "listing", ref: mine.ref }, 1);
      const bk = await post(app, "/api/viewings", { leadId: a.leadId, slot }, users.officer!);
      expect(bk.status).toBe(201);
      const viewingId = ((await bk.json()) as { viewingId: string }).viewingId;
      const today = async (when: string, u: U) =>
        (await (await getAs(app, `/api/viewings?when=${when}`, u)).json()) as {
          items: { id: string; needsOutcome: boolean }[];
        };
      const soon = [
        ...(await today("today", users.officer!)).items,
        ...(await today("upcoming", users.officer!)).items,
      ];
      expect(soon.map((i) => i.id)).toContain(viewingId);
      expect(
        (await post(app, `/api/viewings/${viewingId}/outcome`, { outcome: "attended" }, users.officer!)).status,
      ).toBe(409);
      expect((await post(app, `/api/viewings/${viewingId}/cancel`, { reason: "" }, users.officer!)).status).toBe(422);
      expect(
        (await post(app, `/api/viewings/${viewingId}/cancel`, { reason: "Agent unwell" }, users.manager!)).status,
      ).toBe(200);
      expect((await today("past", users.officer!)).items.map((i) => i.id)).not.toContain(viewingId);
      // The demo clock moves on: a booked viewing with no outcome shows in Past with needsOutcome (Review Focus 4).
      const bk2 = await post(
        app,
        "/api/viewings",
        { leadId: a.leadId, slot: (await freeSlotsFor(ctx(), { kind: "listing", ref: mine.ref }, 1))[0] },
        users.officer!,
      );
      const v2 = ((await bk2.json()) as { viewingId: string }).viewingId;
      clock.set(new Date(START.getTime() + 5 * 86_400_000));
      const past = (await today("past", users.officer!)).items.find((i) => i.id === v2);
      expect(past?.needsOutcome).toBe(true);
      expect(
        (await post(app, `/api/viewings/${v2}/outcome`, { outcome: "attended", note: "Liked it" }, users.officer!))
          .status,
      ).toBe(200);
      expect((await post(app, `/api/viewings/${v2}/outcome`, { outcome: "no_show" }, users.officer!)).status).toBe(409);
      // Status route: a note closes; staff-entered lead.
      expect(
        (
          await app.request(`/api/leads/${a.leadId}/status`, {
            method: "PUT",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${issueToken(SECRET, users.officer!.id, NOW_MS)}`,
            },
            body: JSON.stringify({ status: "closed" }),
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await post(
            app,
            "/api/leads",
            { ref: mine.ref, name: "Walk In", email: email(), message: "Came to the office" },
            users.officer!,
          )
        ).status,
      ).toBe(201);
    });
  });
});
