import { beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDiskStore } from "@leasing/adapters";
import { calendarDate, type ChannelUpdate, formatAed, newId, type OfferTerms } from "@leasing/core";
import {
  actionLinks,
  applications,
  contracts,
  contractSigners,
  conversations,
  type Database,
  documents,
  ejariSubmissions,
  leaseEvents,
  leaseParties,
  leases,
  messages,
  outboundMessages,
  parties,
  tasks,
  units,
  visitorVerifications,
} from "@leasing/db";
import { and, eq } from "drizzle-orm";
import { createApi } from "../src/api/app.ts";
import { APPLICATION_MAIL_JOB, createApplication, sendApplicationMail } from "../src/manager/applications.ts";
import { DEFAULT_ADDENDUM } from "../src/manager/contracts.ts";
import { handleChannelUpdate } from "../src/manager/enquiries.ts";
import { LEASE_MAIL_JOB, type LeaseMailJob, sendLeaseMail } from "../src/manager/lease-mail.ts";
import { webHistory } from "../src/manager/web-chat.ts";
import { CHAT_CODE_JOB, sendChatCode } from "../src/manager/web-chat-status.ts";
import { isTimedAgentJob } from "../src/manager/agent-switches.ts";
import { freshDatabase, noDb, testCompany, testContext } from "./harness.ts";

const START = "2026-11-02T04:00:00Z"; // Monday 08:00 Dubai
let database: Database;

async function world() {
  const t = testContext(database, START);
  const { ctx, scheduler, mailer } = t;
  const landlordId = newId();
  await database.db.insert(parties).values({ id: landlordId, kind: "company", fullNameEn: "Fictional Holdings LLC" });
  const companyId = await testCompany(database);
  let n = 0;
  const unit = async () => {
    const id = newId();
    n++;
    await database.db.insert(units).values({
      companyId,
      id,
      code: `JVC-0${400 + n}`,
      building: `Demo ${n} Residence`,
      community: "Jumeirah Village Circle",
      unitNo: `${400 + n}`,
      bedrooms: 1,
      state: "LISTED",
      askingRentFils: 7_400_000,
      landlordPartyId: landlordId,
    });
    return id;
  };

  /** A web chat with the contact email given (phone skipped). */
  const chat = async (email: string | null = "sara@example.com", visitorId = newId()) => {
    const send = (input: { kind: "text"; text: string } | { kind: "callback"; data: string }) =>
      handleChannelUpdate(ctx, {
        channel: "web",
        updateId: newId(),
        chatId: visitorId,
        from: { id: visitorId },
        ...input,
      } as ChannelUpdate);
    const say = (text: string) => send({ kind: "text", text });
    const tap = (data: string) => send({ kind: "callback", data });
    if (email) {
      await say(email);
      await tap("contact:skip");
    }
    const conv = async () =>
      (
        await database.db
          .select()
          .from(conversations)
          .where(and(eq(conversations.channel, "web"), eq(conversations.externalChatId, visitorId)))
      )[0]!;
    return { visitorId, say, tap, conv };
  };

  let done = 0;
  /** Runs the queued mail jobs (the engine's workers, called directly). */
  const drain = async () => {
    while (done < scheduler.jobs.length) {
      const j = scheduler.jobs[done++]!;
      if (isTimedAgentJob(j)) continue; // a reminder pg-boss would hold until its startAfter
      if (j.name === CHAT_CODE_JOB) {
        const d = j.data as { verificationId: string; sealed: string };
        await sendChatCode(ctx, d.verificationId, d.sealed);
      } else if (j.name === APPLICATION_MAIL_JOB) {
        const d = j.data as { applicationId: string; kind: "viewing" | "docs" | "offer" | "accepted"; seq: number };
        await sendApplicationMail(ctx, d.applicationId, d.kind, d.seq, (j.data as { variant?: string }).variant);
      } else if (j.name === LEASE_MAIL_JOB) await sendLeaseMail(ctx, j.data as unknown as LeaseMailJob);
    }
  };
  const lastCode = () => {
    const m = mailer.sent.toReversed().find((x) => x.subject === "Your verification code");
    return m ? /\b(\d{6})\b/.exec(m.text)![1]! : null;
  };
  /** Asks for a code and types it: the chat is verified. */
  const verify = async (c: Awaited<ReturnType<typeof chat>>) => {
    await c.tap("status:start");
    await drain();
    return c.say(lastCode()!);
  };

  const apply = async (email: string, nameEn = "Sara Khan") => {
    const unitId = await unit();
    const a = await createApplication(ctx, { unitId, nameEn, email, kind: "individual" }, "user:test");
    return { ...a, unitId };
  };
  const setState = (id: string, state: "SCREENING" | "OFFER" | "RESERVED", offer?: Partial<OfferTerms>) =>
    database.db
      .update(applications)
      .set({
        state,
        ...(offer
          ? {
              offer: {
                revision: 1,
                annualRentFils: 7_200_000,
                askingRentFils: 7_400_000,
                cheques: 4,
                depositFils: 360_000,
                rentFreeDays: 0,
                moveInOn: "2026-12-01",
                startOn: "2026-12-01",
                endOn: "2027-11-30",
                reservationFils: 50_000,
                expiresOn: "2026-11-20",
                ...offer,
              } as OfferTerms,
            }
          : {}),
      })
      .where(eq(applications.id, id));

  /** A lease for the tenant email, in the given state; a sent contract (CONTRACT) or an issued Ejari (MOVE_IN). */
  const lease = async (email: string, state: "CONTRACT" | "REGISTRATION" | "MOVE_IN", ref: string) => {
    const unitId = await unit();
    const tenantId = newId();
    await database.db.insert(parties).values({ id: tenantId, kind: "individual", fullNameEn: "Sara Khan", email });
    const leaseId = newId();
    await database.db.insert(leases).values({
      id: leaseId,
      ref,
      unitId,
      state,
      startOn: calendarDate("2026-12-01"),
      endOn: calendarDate("2027-11-30"),
      annualRentFils: 8_000_000,
      cheques: 2,
      depositFils: 400_000,
      rulesVersion: ctx.rulesVersion,
      ejariNo: state === "MOVE_IN" ? "SIM-EJ-1" : null,
    });
    await database.db.insert(leaseParties).values({ leaseId, partyId: tenantId, role: "tenant" });
    const out = { leaseId, tenantId, signerId: null as string | null };
    if (state === "CONTRACT") {
      const stored = await ctx.documents.put(new TextEncoder().encode("%PDF-1.4 test"), "pdf");
      const documentId = newId();
      await database.db.insert(documents).values({
        id: documentId,
        partyId: tenantId,
        leaseId,
        kind: "contract",
        sha256: stored.sha256,
        path: stored.path,
        mime: "application/pdf",
      });
      const contractId = newId();
      await database.db.insert(contracts).values({
        id: contractId,
        leaseId,
        version: 1,
        status: "sent",
        fields: {} as never,
        sources: {},
        addendum: DEFAULT_ADDENDUM,
        inputHash: "x",
        documentId,
        sha256: stored.sha256,
        createdBy: "test",
        createdAt: ctx.clock.now(),
      });
      out.signerId = newId();
      await database.db.insert(contractSigners).values({
        id: out.signerId,
        contractId,
        partyId: tenantId,
        role: "tenant",
        nameEn: "Sara Khan",
        email,
        createdAt: ctx.clock.now(),
      });
    }
    if (state === "MOVE_IN") {
      await database.db.insert(ejariSubmissions).values({
        id: newId(),
        leaseId,
        approvalId: newId(),
        attempt: 1,
        payload: {} as never,
        payloadSha256: "x",
        status: "issued",
        ejariNo: "SIM-EJ-1",
        createdAt: ctx.clock.now(),
      });
    }
    return out;
  };

  return { ...t, chat, drain, lastCode, verify, apply, setState, lease, unit };
}

const NEUTRAL = "If this email has applications, we sent a 6-digit code";

describe.skipIf(noDb)("web chat status check", () => {
  beforeEach(async () => {
    database = await freshDatabase();
  });

  test("the reply before verification is the same with or without records; only a known email gets mail", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const known = await w.chat("sara@example.com");
    const unknown = await w.chat("nobody@example.com");
    const a = await known.tap("status:start");
    const b = await unknown.tap("status:start");
    expect(a.reply!.text).toContain(NEUTRAL);
    expect(a.reply!.input).toBe("code");
    expect(b.reply!.input).toBe("code");
    expect(a.reply!.text.replace("s***@example.com", "X")).toBe(b.reply!.text.replace("n***@example.com", "X"));
    expect(a.reply!.status).toBeUndefined();
    expect(b.reply!.status).toBeUndefined();
    expect(a.reply!.buttons!.map((x) => x.data)).toEqual(b.reply!.buttons!.map((x) => x.data));
    await w.drain();
    // The job is queued for both (no timing difference); only the known email gets mail.
    const codes = w.mailer.sent.filter((m) => m.subject === "Your verification code");
    expect(codes.map((m) => m.to)).toEqual(["sara@example.com"]);
    // The unknown email still counts toward the limit (a row exists) but nothing was sent, and no code works.
    const rows = await database.db.select().from(visitorVerifications);
    expect(rows).toHaveLength(2);
    const wrong = await unknown.say("123456");
    expect(wrong.reply!.text).toContain("did not work");
  });

  test("status:show is not a code trigger; the typed code is not stored; ids must be strict UUIDs", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const c = await w.chat();
    const r = await c.tap("status:show");
    expect(r.reply!.text).not.toContain(NEUTRAL);
    expect(await database.db.select().from(visitorVerifications)).toHaveLength(0);
    await c.tap("status:start");
    await w.drain();
    await c.say(w.lastCode()!);
    const bodies = (await database.db.select().from(messages)).filter((m) => m.direction === "in").map((m) => m.body);
    expect(bodies).toContain("(code entered)");
    expect(bodies.join(" ")).not.toContain(w.lastCode()!);
    const odd = await c.tap("status:up:" + "a".repeat(36));
    expect(odd.reply!.text).not.toContain("Done");
  });

  test("parallel code requests from different chats still send at most 3", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const chats = [];
    for (let i = 0; i < 5; i++) chats.push(await w.chat("sara@example.com"));
    await Promise.all(chats.map((c) => c.tap("status:start")));
    expect(await database.db.select().from(visitorVerifications)).toHaveLength(3);
    await w.drain();
    expect(w.mailer.sent.filter((m) => m.subject === "Your verification code")).toHaveLength(3);
  });

  test("the code mail is stored as evidence with a hash of the body; the code itself is never stored", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const c = await w.chat();
    await c.tap("status:start");
    await w.drain();
    const code = w.lastCode()!;
    expect(code).toMatch(/^\d{6}$/);
    const [out] = await database.db.select().from(outboundMessages).where(eq(outboundMessages.purpose, "chat_code"));
    expect(out).toMatchObject({
      status: "sent",
      to: "sara@example.com",
      template: "chat_code",
      entityKind: "conversation",
    });
    expect(out!.bodySha256).toHaveLength(64);
    expect(out!.smtpResponse).toBeTruthy();
    const [v] = await database.db.select().from(visitorVerifications);
    expect(v!.codeHash).not.toContain(code);
    expect(v!.codeHash).toHaveLength(64);
    // The job payload never holds the code in clear.
    expect(JSON.stringify(w.scheduler.jobs)).not.toContain(code);
    // Running the job twice sends one mail.
    const job = w.scheduler.jobs.find((j) => j.name === CHAT_CODE_JOB)!.data as { sealed: string };
    await sendChatCode(w.ctx, v!.id, job.sealed);
    expect(w.mailer.sent.filter((m) => m.subject === "Your verification code")).toHaveLength(1);
  });

  test("a screening application: tracker, next step, upload button; nobody else's records", async () => {
    const w = await world();
    const mine = await w.apply("sara@example.com");
    await w.setState(mine.id, "SCREENING");
    const other = await w.apply("omar@example.com", "Omar Ali");
    await w.setState(other.id, "SCREENING");
    const c = await w.chat();
    const r = await w.verify(c);
    const status = r.reply!.status!;
    expect(status.apps).toHaveLength(1);
    const item = status.apps[0]!;
    expect(item).toMatchObject({ kind: "application", ref: mine.ref, stage: "Documents" });
    expect(item.stages.map((s) => `${s.name}:${s.state}`)).toEqual([
      "Viewing:done",
      "Documents:current",
      "Offer:todo",
      "Contract:todo",
      "Ejari:todo",
    ]);
    expect(item.nextStep).toBe("We are checking your documents. If we need more, we will email you.");
    expect(item.offer).toBeUndefined();
    expect(item.actions).toEqual([{ label: "Email me the upload link", data: `status:up:${mine.id}` }]);
    // Text fallback; nothing about the other applicant; no ID or deposit wording.
    expect(r.reply!.text).toContain(mine.ref);
    expect(r.reply!.text).not.toContain(other.ref);
    expect(JSON.stringify(r.reply)).not.toMatch(/deposit|landlord|emirates/i);
    expect(r.reply!.buttons!.map((b) => b.data)).toEqual([`status:up:${mine.id}`, "contact:change"]);
  });

  test("an offer out shows the current revision's rent and cheques, formatted by code; a held offer shows neither", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "OFFER", { revision: 3, annualRentFils: 7_150_000, cheques: 6 });
    const held = await w.apply("sara@example.com");
    await w.setState(held.id, "OFFER", { revision: 1, annualRentFils: 6_000_000, cheques: 12 });
    await database.db.insert(tasks).values({
      id: newId(),
      entityKind: "application",
      entityId: held.id,
      kind: "send_offer",
      title: "Send the offer",
      assigneeRole: "leasing_officer",
      dedupeKey: `${held.id}:send_offer`,
      createdBy: "system",
      createdAt: w.ctx.clock.now(),
    });
    const c = await w.chat();
    const r = await w.verify(c);
    const byRef = new Map(r.reply!.status!.apps.map((x) => [x.ref, x]));
    const out = byRef.get(a.ref)!;
    expect(out.stage).toBe("Offer");
    expect(out.offer).toEqual({ annualRentFils: 7_150_000, annualRent: formatAed(7_150_000), cheques: 6 });
    expect(out.actions.map((x) => x.data)).toContain(`status:of:${a.id}`);
    expect(r.reply!.text).toContain(`Offer: ${formatAed(7_150_000)} a year, 6 cheques.`);
    const h = byRef.get(held.ref)!;
    expect(h.offer).toBeUndefined();
    expect(h.nextStep).toBe("We are preparing your offer.");
    expect(h.actions).toEqual([]);
    expect(r.reply!.text).not.toContain(formatAed(6_000_000));
    // With two records, each button says which one it is for.
    expect(out.actions[0]!.label).toContain(a.ref);
  });

  test("leases: a sent contract offers the signing link; an issued Ejari offers the certificate", async () => {
    const w = await world();
    const sign = await w.lease("sara@example.com", "CONTRACT", "L-TEST1");
    const reg = await w.lease("sara@example.com", "MOVE_IN", "L-TEST2");
    const c = await w.chat();
    const r = await w.verify(c);
    const byRef = new Map(r.reply!.status!.apps.map((x) => [x.ref, x]));
    const s = byRef.get("L-TEST1")!;
    expect(s).toMatchObject({ kind: "lease", stage: "Contract" });
    expect(s.offer).toMatchObject({ annualRentFils: 8_000_000, cheques: 2 });
    expect(s.actions.map((x) => x.data)).toEqual([`status:sg:${sign.leaseId}`]);
    const e = byRef.get("L-TEST2")!;
    expect(e.stages.every((x) => x.state === "done")).toBe(true);
    expect(e.actions.map((x) => x.data)).toEqual([`status:ej:${reg.leaseId}`]);
  });

  test("re-sends reuse the mail jobs, are idempotent per Dubai day, and go to the address on file", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "SCREENING");
    const c = await w.chat();
    await w.verify(c);
    const before = w.mailer.sent.length;
    const first = await c.tap(`status:up:${a.id}`);
    expect(first.reply!.text).toBe("Done. We emailed the link to the address on your application.");
    await w.drain();
    const mail = w.mailer.sent.slice(before);
    expect(mail).toHaveLength(1);
    expect(mail[0]!.to).toBe("sara@example.com");
    expect(mail[0]!.text).toContain("/documents");
    // The same day again: no second job, no second mail, and the emailed link still works.
    const again = await c.tap(`status:up:${a.id}`);
    expect(again.reply!.text).toContain("already emailed that today");
    await w.drain();
    expect(w.mailer.sent.slice(before)).toHaveLength(1);
    const live = await database.db
      .select()
      .from(actionLinks)
      .where(and(eq(actionLinks.entityId, a.id), eq(actionLinks.purpose, "kyc_upload")));
    expect(live.filter((l) => !l.usedAt)).toHaveLength(1);
    // The next day it goes again, and the earlier upload link is spent.
    w.clock.set(new Date("2026-11-02T20:30:00Z"));
    expect((await c.tap(`status:up:${a.id}`)).reply!.text).toContain("Done");
    await w.drain();
    expect(w.mailer.sent.slice(before)).toHaveLength(2);
    const events = await database.db.select().from(leaseEvents).where(eq(leaseEvents.entityId, a.id));
    expect(events.filter((e) => e.type === "APPLICANT_LINK_RESENT")).toHaveLength(2);
  });

  test("re-send of the offer, signing link and Ejari certificate", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "OFFER");
    const sign = await w.lease("sara@example.com", "CONTRACT", "L-TEST1");
    const reg = await w.lease("sara@example.com", "MOVE_IN", "L-TEST2");
    const c = await w.chat();
    await w.verify(c);
    const before = w.mailer.sent.length;
    // The offer is out through `setState` without a held task.
    await w.setState(a.id, "OFFER", { revision: 2 });
    expect((await c.tap(`status:of:${a.id}`)).reply!.text).toContain("Done");
    expect((await c.tap(`status:sg:${sign.leaseId}`)).reply!.text).toContain("Done");
    expect((await c.tap(`status:ej:${reg.leaseId}`)).reply!.text).toContain("Done");
    await w.drain();
    const subjects = w.mailer.sent.slice(before).map((m) => m.subject);
    expect(subjects).toHaveLength(3);
    expect(w.mailer.sent.slice(before).every((m) => m.to === "sara@example.com")).toBe(true);
    // Again the same day: each says so, and nothing more is sent.
    for (const d of [`status:of:${a.id}`, `status:sg:${sign.leaseId}`, `status:ej:${reg.leaseId}`])
      expect((await c.tap(d)).reply!.text).toContain("already emailed that today");
    await w.drain();
    expect(w.mailer.sent.slice(before)).toHaveLength(3);
  });

  test("a held offer is not re-sent until a person has sent it", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "OFFER", {});
    const event = (type: string) =>
      database.db.insert(leaseEvents).values({
        id: newId(),
        entityKind: "application",
        entityId: a.id,
        type,
        actor: "system",
        payload: { revision: 1 },
        rulesVersion: "x",
        at: new Date(START),
      });
    await event("OFFER_HELD");
    const c = await w.chat();
    await w.verify(c);
    const before = w.mailer.sent.length;
    const r = await c.tap(`status:of:${a.id}`);
    expect(r.reply!.text).toBe("Your offer is being prepared. We'll email it soon.");
    await w.drain();
    expect(w.mailer.sent.slice(before)).toHaveLength(0);
    await event("OFFER_SENT");
    expect((await c.tap(`status:of:${a.id}`)).reply!.text).toContain("Done");
  });

  test("booking a unit that already has an open application: neutral reply unless verified (no enumeration)", async () => {
    const w = await world();
    const unitId = await w.unit();
    const bookIt = async (c: Awaited<ReturnType<typeof w.chat>>) => {
      const shown = await c.tap(`unit:${unitId}`);
      await c.tap(shown.reply!.buttons!.find((x) => x.data.startsWith("slot:"))!.data);
      return c.say("Sara Khan");
    };
    const first = await w.chat();
    expect((await bookIt(first)).reply!.text).toContain("Your viewing is booked");
    // Another visitor types the same email: nothing about the viewing, its time or its existence.
    const other = await w.chat("sara@example.com");
    const neutral = await bookIt(other);
    expect(neutral.reply!.text).toBe(
      "If you already asked about this property, check your email for the details we sent.",
    );
    expect(neutral.reply!.text).not.toMatch(/viewing|booked|applied|\d{1,2}:\d{2}/i);
    // After the email code the same repeat gets the specific answer.
    await w.verify(other);
    const specific = await bookIt(other);
    expect(specific.reply!.text).toContain("already have a viewing of this home booked");
    expect(await database.db.select().from(applications)).toHaveLength(1);
  });

  test("nothing re-sends without a verified session, or for a record under another email", async () => {
    const w = await world();
    const mine = await w.apply("sara@example.com");
    await w.setState(mine.id, "SCREENING");
    const other = await w.apply("omar@example.com", "Omar Ali");
    await w.setState(other.id, "SCREENING");
    const c = await w.chat();
    const early = await c.tap(`status:up:${mine.id}`);
    expect(early.reply!.text).toContain("check your email");
    await w.verify(c);
    const before = w.scheduler.jobs.length;
    const foreign = await c.tap(`status:up:${other.id}`);
    expect(foreign.reply!.text).toContain("not available");
    expect(w.scheduler.jobs).toHaveLength(before);
  });

  test("wrong cookie: another visitor can't use a verified session, and history holds no details", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "SCREENING");
    const owner = await w.chat("sara@example.com");
    await w.verify(owner);
    // A second visitor with the same email but no code gets nothing.
    const other = await w.chat("sara@example.com");
    const tryAct = await other.tap(`status:up:${a.id}`);
    expect(tryAct.reply!.status).toBeUndefined();
    expect(tryAct.reply!.text).toContain("check your email");
    const start = await other.tap("status:start");
    expect(start.reply!.status).toBeUndefined();
    expect(start.reply!.text).toContain(NEUTRAL);
    // The owner's stored history never has the ref, only the placeholder line.
    const history = await webHistory(w.ctx, owner.visitorId);
    expect(JSON.stringify(history)).not.toContain(a.ref);
    expect(history.some((m) => m.body.includes("Your applications were shown here"))).toBe(true);
  });

  test("wrong guesses use up the attempts; an expired code does not work", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const c = await w.chat();
    await c.tap("status:start");
    await w.drain();
    const code = w.lastCode()!;
    const wrong = code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++) expect((await c.say(wrong)).reply!.text).toContain("did not work");
    // The right code is refused after five misses.
    expect((await c.say(code)).reply!.text).toContain("did not work");
    expect((await database.db.select().from(visitorVerifications))[0]!.attempts).toBe(5);

    // A fresh code, but typed after 15 minutes.
    await c.tap("status:start");
    await w.drain();
    const fresh = w.lastCode()!;
    w.clock.set(new Date(w.clock.now().getTime() + 16 * 60_000));
    expect((await c.say(fresh)).reply!.text).toContain("did not work");
  });

  test("a non-numeric message at the code step asks for the code again", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const c = await w.chat();
    await c.tap("status:start");
    const r = await c.say("what?");
    expect(r.reply!.text).toContain("6-digit code");
    expect(r.reply!.input).toBe("code");
    expect((await c.conv()).flow.step).toBe("asking_status_code");
  });

  test("at most 3 codes per email per hour, across chats; the reply never changes", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    const replies: string[] = [];
    for (let i = 0; i < 4; i++) {
      const c = await w.chat("sara@example.com");
      replies.push((await c.tap("status:start")).reply!.text);
    }
    expect(new Set(replies).size).toBe(1);
    await w.drain();
    expect(w.mailer.sent.filter((m) => m.subject === "Your verification code")).toHaveLength(3);
    // An hour later it works again.
    w.clock.set(new Date(w.clock.now().getTime() + 61 * 60_000));
    const c = await w.chat("sara@example.com");
    await c.tap("status:start");
    await w.drain();
    expect(w.mailer.sent.filter((m) => m.subject === "Your verification code")).toHaveLength(4);
  });

  test("Change email ends the session, even if the old email comes back", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "SCREENING");
    const c = await w.chat();
    expect((await w.verify(c)).reply!.status).toBeDefined();
    await c.tap("contact:change");
    await c.say("other@example.com");
    await c.tap("contact:skip");
    await c.say("sara@example.com");
    await c.tap("contact:skip");
    const back = await c.tap("status:start");
    expect(back.reply!.status).toBeUndefined();
    expect(back.reply!.text).toContain(NEUTRAL);
  });

  test("Use a different email: the old verification is dropped and the code flow restarts for the new address", async () => {
    const w = await world();
    await w.apply("sara@example.com");
    await w.apply("new.person@example.com", "New Person");
    const c = await w.chat();
    expect((await w.verify(c)).reply!.status).toBeDefined();
    const ask = await c.tap("contact:change");
    expect(ask.reply!.text.toLowerCase()).toContain("email");
    // Nothing verified carries over: the old session can't show status any more.
    const rows = await database.db.select().from(visitorVerifications);
    expect(rows.every((r) => r.verifiedAt === null)).toBe(true);
    await c.say("new.person@example.com");
    await c.tap("contact:skip");
    const start = await c.tap("status:start");
    expect(start.reply!.status).toBeUndefined();
    expect(start.reply!.input).toBe("code");
    await w.drain();
    const sent = w.mailer.sent.filter((m) => m.subject === "Your verification code");
    expect(sent.at(-1)!.to).toBe("new.person@example.com");
    // Applicant and application records are untouched.
    expect(await database.db.select().from(applications)).toHaveLength(2);
    expect((await database.db.select().from(parties).where(eq(parties.email, "sara@example.com"))).length).toBe(1);
    expect((await c.conv()).contactEmail).toBe("new.person@example.com");
  });

  test("the quick-action pills Book a viewing and Apply now are handled in code", async () => {
    const w = await world();
    const c = await w.chat();
    const book = await c.tap("chat:book");
    expect(book.reply!.text).toContain("Pick a home first");
    const apply = await c.tap("chat:apply");
    expect(apply.reply!.text).toContain("Pick a home first");
  });

  test("the session lasts 24 hours and is reused by the chip", async () => {
    const w = await world();
    const a = await w.apply("sara@example.com");
    await w.setState(a.id, "SCREENING");
    const c = await w.chat();
    await w.verify(c);
    w.clock.set(new Date(w.clock.now().getTime() + 23 * 3_600_000));
    const again = await c.tap("status:start");
    expect(again.reply!.status!.apps).toHaveLength(1);
    expect(w.scheduler.jobs.filter((j) => j.name === CHAT_CODE_JOB)).toHaveLength(1);
    w.clock.set(new Date(w.clock.now().getTime() + 2 * 3_600_000));
    const expired = await c.tap("status:start");
    expect(expired.reply!.status).toBeUndefined();
  });

  test("the menu buttons offer the status chip", async () => {
    const w = await world();
    const c = await w.chat();
    const r = await c.say("my sink is leaking");
    expect(r.reply!.buttons!.map((b) => b.data)).toContain("status:start");
    expect(r.reply!.buttons!.find((b) => b.data === "status:start")!.label).toBe("Check my applications");
  });
});

describe.skipIf(noDb)("web chat status check over HTTP", () => {
  test("code requests are limited per client IP", async () => {
    database = await freshDatabase();
    const t = testContext(database, START);
    const app = createApi(t.ctx, {
      sessionSecret: "s",
      channelSecret: "chan",
      mediaStore: new LocalDiskStore(mkdtempSync(join(tmpdir(), "leasing-media-"))),
    });
    const post = (ip: string) => {
      const v = newId();
      return app.request("/channel/web/updates", {
        method: "POST",
        headers: { authorization: "Bearer chan", "content-type": "application/json", "x-forwarded-for": ip },
        body: JSON.stringify({
          channel: "web",
          kind: "callback",
          data: "status:start",
          updateId: newId(),
          chatId: v,
          from: { id: v },
        }),
      });
    };
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await post("7.7.7.7")).status;
    expect(last).toBe(429);
    expect((await post("6.6.6.6")).status).toBe(200);
  });
});
