import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FakeMailer } from "@platform/adapters";
import { FixedClock, newId } from "@platform/kernel";
import { DEFAULT_SPA_POLICY, taskVisibleTo } from "@spa/core";
import {
  amlCases,
  amlHits,
  chasePauses,
  chases,
  chaseTemplates,
  dealEvents,
  deals,
  documents,
  kycRuns,
  outboundMessages,
  parties,
  type SpaDatabase,
  spaApprovals,
  spaTasks,
} from "@spa/db";
import { fillChaseMail } from "@spa/helpers";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, asc, eq } from "drizzle-orm";
import {
  AGREEMENT_REVIEW_JOB,
  CHASE_JOB,
  CHASE_SWEEP_JOB,
  chaseKey,
  chaseSweepKey,
  createBoss,
  startJobs,
} from "../src/jobs.ts";
import { chaseDeal, chaseSweep, openChaseItems, pauseChasing, resumeChasing } from "../src/manager/chase.ts";
import { approveChaseTemplate, createChaseTemplate, currentChaseTemplate } from "../src/manager/chase-templates.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { requestDocuments } from "../src/manager/kyc.ts";
import { publishPolicy } from "../src/manager/policy.ts";
import { viewTask } from "../src/manager/views.ts";
import { dealInDraft, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U> = {};
let mailer = new FakeMailer();
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const ctx = (withMail = true): SpaContext => ({
  database,
  clock,
  facts: failClosedFacts,
  ...(withMail ? { mail: { mailer, webBaseUrl: "https://spa.example.test" } } : {}),
});
const on = (iso: string) => clock.set(new Date(`${iso}T06:00:00Z`));
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );

const TEMPLATE = {
  subject: "Documents needed · {property}",
  body: "Dear {party_name},\nFor {property} we still need:\n{items}\nContact {agent_name} at {agent_email}.\n{company_name}",
};

/** A ready resale at PARTY_CHECK with documents requested from its buyer and its seller. */
async function world(o: { sellers?: string[]; buyers?: string[] } = {}) {
  const made = await dealInDraft(ctx(), database, {
    type: "resale_ready",
    buyers: o.buyers ?? ["Buyer One"],
    sellers: o.sellers ?? ["Seller One"],
    unitNo: "U-101",
  });
  await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, made.dealId));
  // Recorded without the portal's documents mail (C35): these tests are about the chaser's own mail.
  await requestDocuments(ctx(false), made.dealId, users.officer!);
  return made;
}
async function approvedTemplate(t = TEMPLATE) {
  const d = await createChaseTemplate(ctx(), users.admin!, t);
  await approveChaseTemplate(ctx(), users.admin!, d.id);
  return d;
}
const upload = async (dealId: string, partyId: string, kind = "passport", at = clock.now()) => {
  await database.db.insert(documents).values({
    id: newId(),
    dealId,
    partyId,
    kind: kind as never,
    fileName: `${kind}.png`,
    mime: "image/png",
    sizeBytes: 10,
    sha256: newId(),
    storageKey: newId(),
    uploadedBy: "user:x",
    uploadedAt: at,
  });
};
/** The deal's documents are all uploaded, except what a test leaves out. */
const uploadAll = async (dealId: string, partyIds: string[], at = clock.now()) => {
  for (const p of partyIds) await upload(dealId, p, "passport", at);
};
const LONG_AGO = new Date("2026-11-10T06:00:00Z");
const kycRun = async (
  dealId: string,
  partyId: string,
  o: {
    role?: "buyer_person" | "seller_person";
    status: "passed" | "review" | "blocked" | "needs_human";
    flags?: { kind: string; message: string; blocking?: boolean }[];
    validUntil?: string | null;
    passportExpiresOn?: string | null;
    at?: Date;
  },
) => {
  const id = newId();
  await database.db.insert(kycRuns).values({
    id,
    dealId,
    partyId,
    role: o.role ?? "buyer_person",
    configScope: "any",
    configVersion: 0,
    status: o.status,
    flags: (o.flags ?? []).map((f) => ({ docId: null, blocking: false, ...f })),
    identity: o.passportExpiresOn ? { passportExpiresOn: o.passportExpiresOn } : {},
    answers: {},
    validUntil: o.validUntil ?? null,
    docsHash: newId(),
    createdAt: o.at ?? clock.now(),
  });
  return id;
};
async function complianceCase(dealId: string, partyId: string, status: "open" | "info_requested") {
  const [a] = await database.db
    .insert(spaApprovals)
    .values({
      id: newId(),
      gate: "aml_flag",
      entityKind: "deal",
      entityId: dealId,
      dedupeKey: `${dealId}:aml:${newId()}`,
      title: "Compliance review",
      proposal: { note: "Sanctions match on the buyer" },
      reasons: ["a sanctions match"],
      rulesVersion: null,
      approverRole: "compliance_officer",
      status: "pending",
      proposedBy: "system:aml-screening",
      createdAt: clock.now(),
    } as never)
    .returning({ id: spaApprovals.id });
  const [c] = await database.db
    .insert(amlCases)
    .values({
      id: newId(),
      dealId,
      status,
      approvalId: a!.id,
      summary: "Sanctions match for the buyer: please send source of funds evidence",
      instructionLike: false,
      openedAt: clock.now(),
    })
    .returning({ id: amlCases.id });
  await database.db.insert(amlHits).values({
    id: newId(),
    caseId: c!.id,
    partyId,
    subjectKey: `party:${partyId}`,
    rule: "sanctions",
    severity: "flag",
    detail: "sanctions list match",
    listVersion: "v1",
    createdAt: clock.now(),
  });
  return c!.id;
}
const chasesOf = (dealId: string) =>
  database.db.select().from(chases).where(eq(chases.dealId, dealId)).orderBy(asc(chases.createdAt), asc(chases.step));
const tasksOf = (dealId: string) => database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId));
const mails = () => mailer.sent.map((m) => ({ to: m.to, subject: m.subject, text: m.text, html: m.html }));
const allText = async (dealId: string): Promise<string> => {
  const rows = await chasesOf(dealId);
  const out = await database.db.select().from(outboundMessages).where(eq(outboundMessages.entityId, dealId));
  const tasks = await tasksOf(dealId);
  return JSON.stringify([mails(), rows, out, tasks.filter((t) => t.kind === "chase_overdue")]);
};
/** Words a chase may never carry, with "review" too: nothing a party or an agent reads names a review. */
const REVEALING = /\baml\b|launder|sanction|screening|screened|\bpep\b|\bedd\b|suspicious|compliance|\breview\b/i;

describe.skipIf(!url)("chaser: templates, items, schedule and stop rules (C25, S23, S60)", () => {
  beforeEach(async () => {
    on("2026-11-19");
    mailer = new FakeMailer();
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  describe("templates: written and approved by an admin", () => {
    test("an admin saves a draft (version 1, then 2); nobody else can", async () => {
      const a = await createChaseTemplate(ctx(), users.admin!, TEMPLATE);
      expect(a).toMatchObject({ version: 1, status: "draft" });
      const b = await createChaseTemplate(ctx(), users.admin!, { ...TEMPLATE, subject: "Still needed · {property}" });
      expect(b.version).toBe(2);
      for (const u of [
        users.officer!,
        users.manager!,
        users.salesadmin!,
        users.legal!,
        users.finance!,
        users.compliance!,
      ])
        expect(await fails(createChaseTemplate(ctx(), u, TEMPLATE))).toMatchObject({ status: 403 });
      const events = await database.db.select().from(dealEvents).where(eq(dealEvents.type, "CHASE_TEMPLATE_CREATED"));
      expect(events).toHaveLength(2);
    });

    test("a text with an unknown placeholder or a banned word can't be saved, and nothing is stored", async () => {
      for (const bad of [
        { ...TEMPLATE, body: `${TEMPLATE.body} {hit_list}` },
        { ...TEMPLATE, body: `${TEMPLATE.body} This is for AML checks.` },
        { ...TEMPLATE, subject: "Screening documents · {property}" },
        { ...TEMPLATE, body: `${TEMPLATE.body} Sanctions list` },
        { ...TEMPLATE, body: `${TEMPLATE.body} compliance flag` },
        { ...TEMPLATE, body: "No list here" },
      ]) {
        expect(await fails(createChaseTemplate(ctx(), users.admin!, bad))).toMatchObject({
          status: 422,
          code: "invalid_chase_template",
        });
      }
      expect(await database.db.select().from(chaseTemplates)).toEqual([]);
    });

    test("an admin approves a draft once; approving the next version retires the one before; the current one is the latest approved", async () => {
      expect(await currentChaseTemplate(database.db)).toBeNull();
      const a = await createChaseTemplate(ctx(), users.admin!, TEMPLATE);
      for (const u of [users.officer!, users.manager!, users.legal!])
        expect(await fails(approveChaseTemplate(ctx(), u, a.id))).toMatchObject({ status: 403 });
      expect(await approveChaseTemplate(ctx(), users.admin!, a.id)).toMatchObject({ version: 1, status: "approved" });
      expect(await fails(approveChaseTemplate(ctx(), users.admin!, a.id))).toMatchObject({ status: 409 });
      expect((await currentChaseTemplate(database.db))!.version).toBe(1);
      const b = await createChaseTemplate(ctx(), users.admin!, { ...TEMPLATE, subject: "Reminder · {property}" });
      await approveChaseTemplate(ctx(), users.admin!, b.id);
      const rows = await database.db.select().from(chaseTemplates).orderBy(asc(chaseTemplates.version));
      expect(rows.map((r) => [r.version, r.status])).toEqual([
        [1, "retired"],
        [2, "approved"],
      ]);
      expect((await currentChaseTemplate(database.db))!.version).toBe(2);
      expect(await fails(approveChaseTemplate(ctx(), users.admin!, newId()))).toMatchObject({ status: 404 });
    });

    test("approval checks the text again: a draft that got a banned word by other means is refused", async () => {
      await database.db.insert(chaseTemplates).values({
        id: "00000000-0000-7000-8000-0000000000aa",
        kind: "chase",
        version: 1,
        subject: "Documents · {property}",
        body: "{items} for the AML team",
        status: "draft",
        createdBy: "user:x",
        createdAt: clock.now(),
      });
      expect(
        await fails(approveChaseTemplate(ctx(), users.admin!, "00000000-0000-7000-8000-0000000000aa")),
      ).toMatchObject({ status: 422, code: "invalid_chase_template" });
    });
  });

  describe("items and the first chase", () => {
    test("without an approved template nothing is sent", async () => {
      const { dealId } = await world();
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0, skipped: "no_template" });
      expect(mails()).toEqual([]);
      expect(await chasesOf(dealId)).toEqual([]);
    });

    test("without mail configured the chase refuses (503), like the other reminders", async () => {
      const { dealId } = await world();
      await approvedTemplate();
      expect(await fails(chaseDeal(ctx(false), dealId))).toMatchObject({ status: 503, code: "mail_unavailable" });
    });

    test("the first run emails each party the documents still missing, with fixed reasons, and stores each chase as evidence", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      const t = await approvedTemplate();
      const r = await chaseDeal(ctx(), dealId);
      expect(r).toMatchObject({ sent: 2, tasks: 0 });
      expect(mails().map((m) => m.subject)).toEqual(Array.from({ length: 2 }, () => "Documents needed · Unit U-101"));
      expect(mails()[0]!.text).toContain("- Passport data page: document not received yet");
      expect(mails()[0]!.text).toContain("Dear Buyer One,");
      expect(mails()[1]!.text).toContain("Dear Seller One,");
      expect(mails()[0]!.text).not.toMatch(/\{[a-z_]+\}/);

      const rows = await chasesOf(dealId);
      expect(rows.map((c) => [c.partyId, c.itemKey, c.reasonCode, c.step, c.templateVersion])).toEqual(
        [buyerIds[0]!, sellerIds[0]!].map((p) => [p, "missing:passport", "document_missing", 0, 1]),
      );
      expect(new Set(rows.map((c) => c.templateId))).toEqual(new Set([t.id]));
      // Each stored hash is the hash of the template as code filled it, and it is what the outbound row kept.
      const out = await database.db.select().from(outboundMessages).where(eq(outboundMessages.entityId, dealId));
      expect(out.map((o) => [o.purpose, o.template, o.templateVersion, o.status])).toEqual(
        Array.from({ length: 2 }, () => ["reminder", "chase", 1, "sent"]),
      );
      for (const c of rows) {
        const m = mailer.sent.find((x) => x.to.startsWith(c.partyId.slice(-8)))!;
        expect(c.bodySha256).toBe(createHash("sha256").update(`${m.text}\n${m.html}`).digest("hex"));
        expect(out.find((o) => o.id === c.outboundMessageId)!.bodySha256).toBe(c.bodySha256);
        const [p] = await database.db.select().from(parties).where(eq(parties.id, c.partyId));
        const expected = fillChaseMail(
          { version: 1, ...TEMPLATE },
          {
            partyName: p!.fullNameEn,
            property: "Unit U-101",
            agentName: "your agent",
            agentEmail: "this address",
            companyName: "the sales team",
            items: [{ label: "Passport data page", reason: "document_missing" }],
          },
        );
        expect(c.bodySha256).toBe(createHash("sha256").update(`${expected.text}\n${expected.html}`).digest("hex"));
      }
      expect(await allText(dealId)).not.toMatch(REVEALING);
    });

    test("a party that has uploaded what is asked gets nothing", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [buyerIds[0]!]);
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 1 });
      expect((await chasesOf(dealId)).map((c) => c.partyId)).toEqual([sellerIds[0]!]);
      await uploadAll(dealId, [sellerIds[0]!]);
      on("2026-11-21");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0 });
    });

    test("the same day's run twice sends once", async () => {
      const { dealId } = await world();
      await approvedTemplate();
      await chaseDeal(ctx(), dealId);
      const again = await chaseDeal(ctx(), dealId);
      expect(again).toMatchObject({ sent: 0, tasks: 0 });
      expect(mails()).toHaveLength(2);
      expect(await chasesOf(dealId)).toHaveLength(2);
      expect(await database.db.select().from(outboundMessages)).toHaveLength(2);
    });

    test("a mail the server refuses is not recorded as a chase and is sent again on the next run", async () => {
      const { dealId } = await world({ sellers: ["Seller One"] });
      await approvedTemplate();
      mailer.failNext = new Error("smtp down");
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(1);
      expect(await chasesOf(dealId)).toHaveLength(1);
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 1 });
      expect(await chasesOf(dealId)).toHaveLength(2);
      expect(mails()).toHaveLength(2);
    });
  });

  describe("failed and expired KYC items, with the fixed reasons", () => {
    test("an expired passport, an unreadable photo and a name that differs each get their fixed words; a clean pass gets none", async () => {
      const { dealId, buyerIds, sellerIds } = await world({ buyers: ["Buyer One", "Buyer Two"] });
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds], LONG_AGO);
      await kycRun(dealId, buyerIds[0]!, {
        status: "blocked",
        flags: [{ kind: "expired", message: "The passport has expired.", blocking: true }],
        passportExpiresOn: "2026-01-01",
        at: new Date("2026-11-18T06:00:00Z"),
      });
      await kycRun(dealId, buyerIds[1]!, {
        status: "review",
        flags: [{ kind: "unreadable", message: "The photo is blurred." }],
        at: new Date("2026-11-18T06:00:00Z"),
      });
      await kycRun(dealId, sellerIds[0]!, {
        role: "seller_person",
        status: "review",
        flags: [{ kind: "name_mismatch", message: "Name differs." }],
        at: new Date("2026-11-18T06:00:00Z"),
      });
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(3);
      const text = mails().map((m) => m.text);
      expect(text.find((t) => t.includes("Dear Buyer One"))).toContain("passport expired");
      expect(text.find((t) => t.includes("Dear Buyer Two"))).toContain("photo unreadable");
      expect(text.find((t) => t.includes("Dear Seller One"))).toContain("name differs from the title deed");
      // The words are fixed: the model's or the reader's own message never leaves.
      expect(text.join("\n")).not.toMatch(/blurred|has expired|Name differs\./);
      expect((await chasesOf(dealId)).map((c) => c.reasonCode).toSorted()).toEqual([
        "name_differs_title_deed",
        "passport_expired",
        "photo_unreadable",
      ]);
    });

    test("a pass whose document has since expired is chased; a valid pass is not; a person's approval of a review counts", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds], LONG_AGO);
      await kycRun(dealId, buyerIds[0]!, {
        status: "passed",
        validUntil: "2026-11-01",
        passportExpiresOn: "2026-11-01",
      });
      await kycRun(dealId, sellerIds[0]!, { role: "seller_person", status: "passed", validUntil: "2028-01-01" });
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(1);
      expect(mails()[0]!.text).toContain("passport expired");
    });

    test("a new upload after the failed run ends the chase for it (the next run will read it)", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds], LONG_AGO);
      await kycRun(dealId, buyerIds[0]!, {
        status: "blocked",
        flags: [{ kind: "expired", message: "x", blocking: true }],
        at: new Date("2026-11-18T06:00:00Z"),
      });
      await upload(dealId, buyerIds[0]!, "passport", new Date("2026-11-19T01:00:00Z"));
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0 });
    });
  });

  describe("items compliance asked for, and parties under a compliance review: neutral wording", () => {
    test("an info request maps to 'Additional documents needed' alone; no document name, no original reason, no banned word anywhere", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds]);
      await complianceCase(dealId, buyerIds[0]!, "info_requested");
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(1);
      expect(mails()[0]!.text).toContain("- Additional documents needed");
      expect(mails()[0]!.text).not.toMatch(/passport|source of funds|sanction/i);
      const [c] = await chasesOf(dealId);
      expect([c!.reasonCode, c!.itemKey.startsWith("additional_documents:")]).toEqual(["additional_documents", true]);
      expect(await allText(dealId)).not.toMatch(REVEALING);
      expect(await allText(dealId)).not.toMatch(/source of funds|Sanctions match/i);
    });

    test("a party under an open review whose own documents are also missing still gets only the neutral line, once", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...sellerIds]);
      await complianceCase(dealId, buyerIds[0]!, "open");
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(1);
      expect(mails()[0]!.text).toContain("- Additional documents needed");
      expect(mails()[0]!.text).not.toMatch(/Passport data page|document not received/);
      expect((await chasesOf(dealId)).map((c) => c.reasonCode)).toEqual(["additional_documents"]);
      // An open review with nothing missing sends nothing.
      await uploadAll(dealId, [buyerIds[0]!]);
      on("2026-11-21");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0 });
    });

    test("an upload by that party after the first chase stops it", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds]);
      await complianceCase(dealId, buyerIds[0]!, "info_requested");
      await chaseDeal(ctx(), dealId);
      on("2026-11-21");
      await upload(dealId, buyerIds[0]!, "proof_of_address");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0 });
      expect(mails()).toHaveLength(1);
    });

    test("the overdue task for a reviewed party is neutral too", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds]);
      await complianceCase(dealId, buyerIds[0]!, "info_requested");
      for (const day of ["19", "21", "24", "26"]) {
        on(`2026-11-${day}`);
        await chaseDeal(ctx(), dealId);
      }
      const t = (await tasksOf(dealId)).filter((x) => x.kind === "chase_overdue");
      expect(t).toHaveLength(1);
      expect(JSON.stringify(t)).not.toMatch(REVEALING);
    });
  });

  describe("a neutral item's key names no compliance case (S60 amendment)", () => {
    test("the case id appears nowhere a sales role reads: the task's detail, the chase rows, the mail", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await uploadAll(dealId, [...buyerIds, ...sellerIds]);
      const caseId = await complianceCase(dealId, buyerIds[0]!, "info_requested");
      for (const day of ["19", "21", "24", "26"]) {
        on(`2026-11-${day}`);
        await chaseDeal(ctx(), dealId);
      }
      const tasks = (await tasksOf(dealId)).filter((x) => x.kind === "chase_overdue");
      expect(tasks).toHaveLength(1);
      const seen = tasks.filter((t) => taskVisibleTo(t.role, "sales_officer")).map(viewTask);
      expect(JSON.stringify(seen)).not.toContain(caseId);
      expect(String((tasks[0]!.detail as { itemKey: string }).itemKey)).toStartWith("additional_documents:");
      expect(JSON.stringify(await chasesOf(dealId))).not.toContain(caseId);
      expect(JSON.stringify(mails())).not.toContain(caseId);
      // Still one chase series for the party, and the key is stable from run to run.
      expect(new Set((await chasesOf(dealId)).map((c) => c.itemKey)).size).toBe(1);
    });
  });

  describe("schedule: at request, +2 days, +5 days, then a task at +7", () => {
    test("the days come from the deal's pinned policy, and the task is the agent's, once", async () => {
      const { dealId } = await world();
      await approvedTemplate();
      const count = async (day: string) => {
        on(`2026-11-${day}`);
        return chaseDeal(ctx(), dealId);
      };
      expect(await count("19")).toMatchObject({ sent: 2 });
      expect(await count("20")).toMatchObject({ sent: 0, tasks: 0 });
      expect(await count("21")).toMatchObject({ sent: 2 });
      expect(await count("23")).toMatchObject({ sent: 0 });
      expect(await count("24")).toMatchObject({ sent: 2 });
      expect(await count("25")).toMatchObject({ sent: 0, tasks: 0 });
      expect(await count("26")).toMatchObject({ sent: 0, tasks: 2 });
      expect(await count("27")).toMatchObject({ sent: 0, tasks: 0 });
      expect(await count("30")).toMatchObject({ sent: 0, tasks: 0 });
      expect((await chasesOf(dealId)).map((c) => c.step)).toEqual([0, 0, 1, 1, 2, 2]);
      expect(mails()).toHaveLength(6);
      const t = (await tasksOf(dealId)).filter((x) => x.kind === "chase_overdue");
      expect(t.map((x) => [x.role, x.status])).toEqual([
        ["sales_officer", "open"],
        ["sales_officer", "open"],
      ]);
      expect(t[0]!.title).toMatch(/contact/i);
      expect(JSON.stringify(t)).not.toMatch(REVEALING);
      expect(await allText(dealId)).not.toMatch(REVEALING);
    });

    test("a job that was down sends only the latest step that has come due, not each missed one", async () => {
      const { dealId } = await world({ sellers: ["Seller One"] });
      await approvedTemplate();
      await chaseDeal(ctx(), dealId);
      on("2026-11-25");
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(2);
      expect((await chasesOf(dealId)).map((c) => c.step)).toEqual([0, 0, 2, 2]);
    });

    test("a policy with its own reminder days and chaseTaskAfterDays is followed", async () => {
      await publishPolicy(ctx(), { ...DEFAULT_SPA_POLICY, reminderDays: [1, 3], chaseTaskAfterDays: 4 }, users.admin!);
      const { dealId } = await world({ sellers: ["Seller One"] });
      await approvedTemplate();
      const day = async (d: string) => {
        on(`2026-11-${d}`);
        return chaseDeal(ctx(), dealId);
      };
      await day("19");
      expect((await day("20")).sent).toBe(2);
      expect((await day("21")).sent).toBe(0);
      expect((await day("22")).sent).toBe(2);
      expect(await day("23")).toMatchObject({ sent: 0, tasks: 2 });
      expect((await chasesOf(dealId)).map((c) => c.step)).toEqual([0, 0, 1, 1, 2, 2]);
    });
  });

  describe("stop rules", () => {
    test("a cancelled, completed or handed-over deal is never chased", async () => {
      for (const state of ["CANCELLED", "COMPLETED", "HANDED_OVER"]) {
        const { dealId } = await world();
        await approvedTemplate().catch(() => null);
        await database.db
          .update(deals)
          .set({ state: state as never })
          .where(eq(deals.id, dealId));
        expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0, skipped: "closed" });
      }
      expect(mails()).toEqual([]);
    });

    test("a deal cancelled after the first chase gets no second one", async () => {
      const { dealId } = await world();
      await approvedTemplate();
      await chaseDeal(ctx(), dealId);
      await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, dealId));
      on("2026-11-21");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0, skipped: "closed" });
      expect(mails()).toHaveLength(2);
    });

    test("an upload after the first chase stops that item for that party only", async () => {
      const { dealId, buyerIds, sellerIds } = await world();
      await approvedTemplate();
      await chaseDeal(ctx(), dealId);
      on("2026-11-20");
      await upload(dealId, buyerIds[0]!);
      on("2026-11-21");
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(1);
      expect((await chasesOf(dealId)).filter((c) => c.step === 1).map((c) => c.partyId)).toEqual([sellerIds[0]!]);
      // Nothing is open for the buyer, so no overdue task for them either.
      for (const d of ["24", "26"]) {
        on(`2026-11-${d}`);
        await chaseDeal(ctx(), dealId);
      }
      expect((await tasksOf(dealId)).filter((x) => x.kind === "chase_overdue")).toHaveLength(1);
    });

    test("an agent's pause stops chasing; resuming continues the schedule; pausing twice is harmless", async () => {
      const { dealId } = await world({ sellers: ["Seller One"] });
      await approvedTemplate();
      await chaseDeal(ctx(), dealId);
      expect(await pauseChasing(ctx(), users.officer!, dealId)).toMatchObject({ paused: true, changed: true });
      expect(await pauseChasing(ctx(), users.officer!, dealId)).toMatchObject({ paused: true, changed: false });
      on("2026-11-21");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0, skipped: "paused" });
      on("2026-11-27");
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0, tasks: 0, skipped: "paused" });
      expect(mails()).toHaveLength(2);
      expect(await resumeChasing(ctx(), users.officer!, dealId)).toMatchObject({ paused: false, changed: true });
      expect(await resumeChasing(ctx(), users.officer!, dealId)).toMatchObject({ paused: false, changed: false });
      const r = await chaseDeal(ctx(), dealId);
      expect(r.sent).toBe(2);
      expect(await chaseDeal(ctx(), dealId)).toMatchObject({ sent: 0 });
      const pauses = await database.db.select().from(chasePauses).where(eq(chasePauses.dealId, dealId));
      expect(pauses).toHaveLength(1);
      expect(pauses[0]!.resumedAt).not.toBeNull();
      const types = (await database.db.select().from(dealEvents).where(eq(dealEvents.entityId, dealId))).map(
        (e) => e.type,
      );
      expect(types).toEqual(expect.arrayContaining(["CHASE_PAUSED", "CHASE_RESUMED"]));
    });

    test("who may pause: the people who run the deal; not legal, finance or the compliance roles", async () => {
      const { dealId } = await world();
      for (const u of [users.officer!, users.manager!, users.salesadmin!, users.admin!]) {
        expect(await pauseChasing(ctx(), u, dealId)).toMatchObject({ paused: true });
        await resumeChasing(ctx(), u, dealId);
      }
      for (const u of [users.legal!, users.finance!, users.compliance!, users.mlro!]) {
        expect(await fails(pauseChasing(ctx(), u, dealId))).toMatchObject({ status: 403 });
        expect(await fails(resumeChasing(ctx(), u, dealId))).toMatchObject({ status: 403 });
      }
      expect(await fails(pauseChasing(ctx(), users.officer!, newId()))).toMatchObject({ status: 404 });
    });

    test("pausing a closed deal is refused", async () => {
      const { dealId } = await world();
      await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, dealId));
      expect(await fails(pauseChasing(ctx(), users.officer!, dealId))).toMatchObject({ status: 409 });
    });
  });

  describe("the daily sweep", () => {
    test("queues one job per open deal with the key <dealId>:chase:<date>, none for a closed deal", async () => {
      const a = await world();
      const b = await world();
      const c = await world();
      await database.db.update(deals).set({ state: "CANCELLED" }).where(eq(deals.id, c.dealId));
      const sent: [string, { dealId: string }, { singletonKey: string }][] = [];
      const boss = { send: async (...x: unknown[]) => (sent.push(x as never), "job") };
      const r = await chaseSweep(ctx(), boss as never);
      expect(r.queued).toBe(2);
      expect(sent.map((s) => s[0])).toEqual([CHASE_JOB, CHASE_JOB]);
      expect(sent.map((s) => s[2].singletonKey).toSorted()).toEqual(
        [a.dealId, b.dealId].map((id) => chaseKey(id, "2026-11-19")).toSorted(),
      );
    });
  });

  describe("the jobs (pg-boss)", () => {
    test("named, keyed by Dubai date and deal; the sweep runs once at startup after 08:30 Dubai and each deal is chased once", async () => {
      expect([CHASE_SWEEP_JOB, CHASE_JOB, AGREEMENT_REVIEW_JOB]).toEqual([
        "spa.chase.sweep",
        "spa.chase",
        "spa.agreement.review",
      ]);
      expect(chaseSweepKey("2026-11-19")).toBe("chase-sweep:2026-11-19");
      expect(chaseKey("d1", "2026-11-19")).toBe("d1:chase:2026-11-19");
      const { dealId } = await world();
      await approvedTemplate();
      clock.set(new Date("2026-11-19T06:30:00Z")); // 10:30 in Dubai
      const jobs = await startJobs(createBoss(url!), clock, {
        chaseSweep: () => chaseSweep(ctx(), jobs.boss),
        chase: (data) => chaseDeal(ctx(), data.dealId),
      });
      try {
        for (let i = 0; i < 60 && mails().length < 2; i++) await Bun.sleep(100);
        await Bun.sleep(400);
        expect(mails()).toHaveLength(2);
        expect(await chasesOf(dealId)).toHaveLength(2);
      } finally {
        await jobs.stop();
      }
    });

    test("a restart before 08:30 in Dubai queues no sweep, so nobody is emailed in the night", async () => {
      const { dealId } = await world();
      await approvedTemplate();
      clock.set(new Date("2026-11-19T04:15:00Z")); // 08:15 in Dubai
      const jobs = await startJobs(createBoss(url!), clock, {
        chaseSweep: () => chaseSweep(ctx(), jobs.boss),
        chase: (data) => chaseDeal(ctx(), data.dealId),
      });
      try {
        await Bun.sleep(1500);
        expect(mails()).toEqual([]);
        expect(await chasesOf(dealId)).toEqual([]);
      } finally {
        await jobs.stop();
      }
    });

    test("the review job is queued once per agreement key and run once", async () => {
      const seen: string[] = [];
      const jobs = await startJobs(createBoss(url!), clock, {
        agreementReview: async (d) => void seen.push(d.agreementId),
      });
      try {
        const key = "a1:review";
        await jobs.boss.send(AGREEMENT_REVIEW_JOB, { agreementId: "a1" }, { singletonKey: key });
        await jobs.boss.send(AGREEMENT_REVIEW_JOB, { agreementId: "a1" }, { singletonKey: key });
        for (let i = 0; i < 40 && seen.length === 0; i++) await Bun.sleep(100);
        await Bun.sleep(300);
        expect(seen).toEqual(["a1"]);
      } finally {
        await jobs.stop();
      }
    });
  });

  describe("no model writes chase text", () => {
    test("the chase code never imports a model", () => {
      for (const f of ["chase.ts", "chase-templates.ts"]) {
        const src = readFileSync(join(import.meta.dir, "..", "src", "manager", f), "utf8");
        expect(src).not.toMatch(/@platform\/llm|\bLlm\b|\.chat\(|\.decide\(/);
      }
    });

    test("openChaseItems derives items from code alone: the required documents, with the fixed reason", async () => {
      const { dealId, buyerIds } = await world();
      const [d] = await database.db.select().from(deals).where(eq(deals.id, dealId));
      const list = await openChaseItems(database.db, d!, clock.today());
      const buyer = list.find((p) => p.partyId === buyerIds[0])!;
      expect(buyer.neutral).toBe(false);
      expect(buyer.items).toEqual([
        { itemKey: "missing:passport", reason: "document_missing", label: "Passport data page" },
      ]);
    });
  });

  test("a chase is only ever evidence: the chases table can't be edited", async () => {
    const { dealId } = await world();
    await approvedTemplate();
    await chaseDeal(ctx(), dealId);
    await expect(
      (async () => {
        await database.db
          .update(chases)
          .set({ step: 5 })
          .where(and(eq(chases.dealId, dealId)));
      })(),
    ).rejects.toThrow();
  });
});
