import { createHash } from "node:crypto";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, issueToken, newId } from "@platform/kernel";
import { extractPdf, normalizeWs } from "@platform/readers/pdf/extract";
import { DEAL_FACT_KEYS } from "@spa/core";
import { FAKE_SANCTIONS, FakeScreening } from "@spa/helpers";
import {
  agreements,
  dealEvents,
  deals,
  helperRuns,
  parties,
  paymentPlanRows,
  type SpaDatabase,
  spaApprovals,
  spaTasks,
  spaTemplateVersions,
  units,
  withSpaTx,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, asc, eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { AGREEMENT_PREPARE_JOB, createBoss, startJobs } from "../src/jobs.ts";
import { advance } from "../src/manager/advance.ts";
import { decideApproval, proposeApproval } from "../src/manager/approvals.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import { setHelperMode } from "../src/manager/helper-modes.ts";
import { screenDeal } from "../src/manager/aml-screening.ts";
import { enqueuePrepare, prepareAgreement, prepareJobKey, runPrepareJob } from "../src/manager/prepare.ts";
import { setPaymentPlan } from "../src/manager/sheet.ts";
import { addTemplateVersion, createTemplate } from "../src/manager/templates.ts";
import {
  assignmentTpl,
  blank,
  broker,
  dealInDraft,
  markScreened,
  mouTpl,
  RB,
  RB_B,
  seedUsers,
  sign,
  spaTpl,
  toData,
  type Tpl,
  type U,
} from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U> = {};
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
let rulebook: NonNullable<SpaContext["rulebook"]> = () => RB;
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts, rulebook });
/** An in-memory content-addressed store: the bytes can be read back to check the printed text. */
const files = new Map<string, Uint8Array>();
const store = {
  async put(bytes: Uint8Array, ext: string) {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const path = `${sha256.slice(0, 2)}/${sha256}.${ext}`;
    files.set(path, bytes);
    return { sha256, path, bytes: bytes.byteLength };
  },
};
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );
const PLAN = {
  instalments: [
    { label: "Booking", shareBps: 1000, dueOn: "2026-12-01" },
    { label: "On handover", shareBps: 9000, dueOn: "2028-06-30" },
  ],
};

async function approvedTemplate(tpl: Tpl, kind: "spa" | "mou" | "assignment", name = `${kind} template`) {
  const t = await createTemplate(ctx(), { name, documentKind: kind }, users.admin!);
  const v = await addTemplateVersion(
    ctx(),
    { templateId: t.id, docId: "doc-1", docHash: "a".repeat(64), data: toData(tpl) },
    users.admin!,
  );
  await decideApproval(ctx(), v.approvalId, users.legal!, { decision: "approve" });
  return v.id;
}
/** Inserts an approved version without the C13 checks (triggers off): what prepare's own checks must still catch. */
async function forceApprovedTemplate(tpl: Tpl, kind: "spa" | "mou" | "assignment") {
  const data = toData(tpl);
  const t = await createTemplate(ctx(), { name: `forced ${kind}`, documentKind: kind }, users.admin!);
  const { blanks, sections, ...look } = data;
  await database.pool.query("alter table spa_template_versions disable trigger user");
  try {
    await database.db.insert(spaTemplateVersions).values({
      id: newId(),
      templateId: t.id,
      version: 1,
      docId: "d",
      docHash: "a".repeat(64),
      sections,
      blanks,
      look,
      partyBlocks: [],
      signatureRoles: {},
      checks: [],
      rulesVersion: RB.version,
      status: "approved",
      createdBy: "user:x",
      createdAt: new Date(),
      decidedAt: new Date(),
    });
  } finally {
    await database.pool.query("alter table spa_template_versions enable trigger user");
  }
}
const withExtra = (tpl: Tpl, paragraph: string): Tpl => ({
  ...tpl,
  sections: tpl.sections.map((s, i) => (i === 0 ? { ...s, paragraphs: [...s.paragraphs, paragraph] } : s)),
});

const agreementsOf = (dealId: string) =>
  database.db.select().from(agreements).where(eq(agreements.dealId, dealId)).orderBy(asc(agreements.version));
const stateOf = async (id: string) => (await database.db.select().from(deals).where(eq(deals.id, id)))[0]!.state;
const eventsOf = (id: string, type: string) =>
  database.db
    .select()
    .from(dealEvents)
    .where(and(eq(dealEvents.entityId, id), eq(dealEvents.type, type)))
    .orderBy(asc(dealEvents.at), asc(dealEvents.id));
const runsOf = (id: string) => database.db.select().from(helperRuns).where(eq(helperRuns.dealId, id));
const approvalsOf = (id: string) =>
  database.db
    .select()
    .from(spaApprovals)
    .where(and(eq(spaApprovals.entityId, id), eq(spaApprovals.gate, "agreement_approval")))
    .orderBy(asc(spaApprovals.createdAt), asc(spaApprovals.id));
const factsOf = (id: string) =>
  withSpaTx(database, async (tx) =>
    failClosedFacts.deal(tx, (await tx.db.select().from(deals).where(eq(deals.id, id)))[0]!, clock.today()),
  );
const textOf = async (a: { storageKey: string }) => {
  const r = await extractPdf(files.get(a.storageKey)!);
  if (!r.ok) throw new Error("not a text pdf");
  return normalizeWs(r.text);
};
const prepare = (dealId: string) => prepareAgreement(ctx(), { store }, dealId);

/** A primary deal with a plan, in AGREEMENT_DRAFT, with the SPA template approved. */
async function primary(o: Parameters<typeof dealInDraft>[2] = {}) {
  const d = await dealInDraft(ctx(), database, { unitNo: "A-101", ...o });
  await markScreened(database, d.dealId); // legal's approval needs no open compliance flag (S50)
  await setPaymentPlan(ctx(), d.dealId, PLAN, users.officer!);
  return d;
}

describe.skipIf(!url)("spa-prepare: the agreement (C19, S51)", () => {
  beforeEach(async () => {
    rulebook = () => RB;
    files.clear();
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  describe("a primary deal", () => {
    test("fills the approved template, stores the PDF and its hash, and sends it to legal", async () => {
      const tv = await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary({ buyers: ["Buyer One", "Buyer Two"] });
      const r = await prepare(dealId);
      expect(r).toMatchObject({ ok: true, created: true, version: 1, kind: "spa" });
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");

      const [a] = await agreementsOf(dealId);
      expect([a!.kind, a!.version, a!.status, a!.templateVersionId, a!.rulesVersion, a!.policyVersion]).toEqual([
        "spa",
        1,
        "in_review",
        tv,
        RB.version,
        0,
      ]);
      const bytes = files.get(a!.storageKey)!;
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(a!.docHash);

      // Printed: the deal's own values, the template's wording and numbering, a repeat per purchaser, the plan table.
      const text = await textOf(a!);
      for (const s of [
        "OFF-PLAN SALE AND PURCHASE AGREEMENT",
        "1. PARTIES",
        "Fictional Developments LLC",
        "LIC-0001",
        "Buyer One",
        "Buyer Two",
        "A-101",
        "AED 2,000,000",
        "Booking",
        "On handover",
      ])
        expect(text).toContain(s);
      // Every printed party and money value has a source, none of them a value.
      const src = a!.fieldSources;
      expect(src.price).toBe("deal");
      expect(src.unit_no).toBe("deal");
      expect(src.dld_fee).toBe(`rulebook:${RB.version}:registrationFee`);
      expect(src["purchaser.1.purchaser_name"]).toBe(`party:${buyerIds[0]}`);
      expect(src["purchaser.2.purchaser_name"]).toBe(`party:${buyerIds[1]}`);
      expect(src.payment_plan).toBe("deal:plan");
      expect(JSON.stringify(src)).not.toContain("Buyer One");

      // Legal is asked, with the hash it must check.
      const [ap] = await approvalsOf(dealId);
      expect([ap!.status, ap!.approverRole, ap!.proposedBy, ap!.dedupeKey]).toEqual([
        "pending",
        "legal",
        "system:prepare",
        `${a!.id}:agreement_approval`,
      ]);
      expect(ap!.proposal).toMatchObject({ agreementId: a!.id, docHash: a!.docHash });
      expect(a!.approvalId).toBe(ap!.id);

      const [step] = await eventsOf(dealId, "PREPARED");
      expect([step!.actor, step!.fromState, step!.toState, step!.rulesVersion]).toEqual([
        "system:prepare",
        "AGREEMENT_DRAFT",
        "LEGAL_REVIEW",
        RB.version,
      ]);
      const [ev] = await eventsOf(dealId, "AGREEMENT_PREPARED");
      expect(ev!.payload).toMatchObject({ agreementId: a!.id, version: 1, kind: "spa", docHash: a!.docHash });
      expect(JSON.stringify(ev!.payload)).not.toContain("Buyer One");
    });

    test("no model is involved: the function takes no llm", () => {
      expect(prepareAgreement.length).toBeLessThanOrEqual(4);
    });

    test("the same deal and clock give the same document hash", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [v1] = await agreementsOf(dealId);
      // Legal returns it; nothing changed; preparing again gives version 2 with the same bytes.
      await decideApproval(ctx(), v1!.approvalId!, users.legal!, { decision: "reject", note: "again" });
      await prepare(dealId);
      const all = await agreementsOf(dealId);
      expect(all.map((x) => [x.version, x.status])).toEqual([
        [1, "superseded"],
        [2, "in_review"],
      ]);
      expect(all[1]!.docHash).toBe(v1!.docHash);
      expect(all[1]!.valuesHash).toBe(v1!.valuesHash);
    });

    test("preparing twice leaves one agreement, one approval and one event (safe to run twice)", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      const a = await prepare(dealId);
      const b = await prepare(dealId);
      expect(a).toMatchObject({ ok: true, created: true });
      expect(b).toMatchObject({ ok: true, created: false, version: 1 });
      expect(await agreementsOf(dealId)).toHaveLength(1);
      expect(await approvalsOf(dealId)).toHaveLength(1);
      expect(await eventsOf(dealId, "AGREEMENT_PREPARED")).toHaveLength(1);
    });

    test("a deal that is not in AGREEMENT_DRAFT is refused", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
      expect(await fails(prepare(dealId))).toEqual({ status: 409, code: "not_in_agreement_draft" });
      expect(await fails(prepare(newId()))).toMatchObject({ status: 404 });
    });
  });

  describe("preparation stops, and says why, without values", () => {
    const expectStopped = async (
      dealId: string,
      r: Awaited<ReturnType<typeof prepare>>,
      keys: string[],
      secrets: string[] = [],
    ) => {
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.keys.toSorted()).toEqual(keys.toSorted());
      expect(await agreementsOf(dealId)).toHaveLength(0);
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      expect(await approvalsOf(dealId)).toHaveLength(0);
      const [run] = await runsOf(dealId);
      expect([run!.helper, run!.status, run!.visibility, run!.entityKind, run!.modelTag]).toEqual([
        "spa_prepare",
        "needs_human",
        "staff",
        "deal",
        null,
      ]);
      expect(run!.reasons.length).toBeGreaterThan(0);
      const [ev] = await eventsOf(dealId, "PREPARE_STOPPED");
      expect(ev!.payload).toMatchObject({ keys: expect.any(Array) });
      for (const blob of [JSON.stringify(ev!.payload), JSON.stringify(run!.reasons), JSON.stringify(run!.result)])
        for (const s of secrets) expect(blob).not.toContain(s);
    };

    test("no approved template for the deal type", async () => {
      const { dealId } = await primary();
      const r = await prepare(dealId);
      await expectStopped(dealId, r, []);
      expect((await runsOf(dealId))[0]!.reasons.join(" ")).toContain("No approved template");
    });

    test("a draft or retired template doesn't count (only an approved version)", async () => {
      const t = await createTemplate(ctx(), { name: "Draft only", documentKind: "spa" }, users.admin!);
      await addTemplateVersion(
        ctx(),
        { templateId: t.id, docId: "d", docHash: "a".repeat(64), data: toData(spaTpl()) },
        users.admin!,
      );
      const { dealId } = await primary();
      await expectStopped(dealId, await prepare(dealId), []);
    });

    test("an empty seller name", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, sellerIds } = await primary();
      await database.db.update(parties).set({ fullNameEn: "" }).where(eq(parties.id, sellerIds[0]!));
      await expectStopped(dealId, await prepare(dealId), ["seller_name"]);
    });

    test("an empty purchaser name", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary({ buyers: ["Buyer One", "Buyer Two"] });
      await database.db.update(parties).set({ fullNameEn: "" }).where(eq(parties.id, buyerIds[1]!));
      await expectStopped(dealId, await prepare(dealId), ["purchaser_name"], ["Buyer One"]);
    });

    test("no unit number", async () => {
      await approvedTemplate(mouTpl(), "mou");
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await expectStopped(dealId, await prepare(dealId), ["unit_no"]);
    });

    test("a primary deal's unit number falls back to its unit code, and an empty code stops", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await dealInDraft(ctx(), database);
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      const [d] = await database.db.select().from(deals).where(eq(deals.id, dealId));
      await database.db.update(units).set({ code: "" }).where(eq(units.id, d!.unitId!));
      await expectStopped(dealId, await prepare(dealId), ["unit_no"]);
    });

    test("no payment plan on a primary deal; a resale needs none", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await dealInDraft(ctx(), database, { unitNo: "A-101" });
      await expectStopped(dealId, await prepare(dealId), ["payment_plan"]);
      // The same template on a resale with no plan: the plan line prints empty and the deal moves on.
      await approvedTemplate(mouTpl(), "mou");
      const resale = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "B-7" });
      expect((await prepare(resale.dealId)).ok).toBe(true);
    });

    test("a rulebook that isn't available stops; a core money value it hasn't confirmed (the fee) stops with its reason", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      rulebook = () => null;
      await expectStopped(dealId, await prepare(dealId), []);
      expect((await runsOf(dealId))[0]!.reasons.join(" ")).toContain("isn't available");
      rulebook = (v) => (v === RB.version ? ({ ...RB, pending: ["registrationFeePayer"] } as never) : null);
      const again = await prepare(dealId);
      expect(again.ok).toBe(false);
      if (!again.ok) {
        expect(again.keys).toEqual(["dld_fee"]);
        expect(again.reasons.join(" ")).toContain("awaits legal confirmation");
      }
      expect(await agreementsOf(dealId)).toHaveLength(0);
    });

    test("stopping twice for the same reasons records it once (safe to run twice)", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await dealInDraft(ctx(), database, { unitNo: "A-101" });
      await prepare(dealId);
      await prepare(dealId);
      expect(await runsOf(dealId)).toHaveLength(1);
      expect(await eventsOf(dealId, "PREPARE_STOPPED")).toHaveLength(1);
      // Fixing it and preparing works; a new stop after a different problem is recorded again.
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      expect((await prepare(dealId)).ok).toBe(true);
    });

    test("three purchasers in a template with two numbered slots", async () => {
      const slotted: Tpl = {
        title: "AGREEMENT",
        sections: [
          {
            id: "s1",
            number: "ARTICLE 1",
            heading: "PARTIES",
            paragraphs: [
              "SELLER",
              "Name: {{b1}}",
              "PURCHASER 1",
              "Name: {{b2}}",
              "PURCHASER 2",
              "Name: {{b3}}",
              "Unit no: {{b4}}",
              "The price is {{b5}}.",
            ],
          },
          { id: "s2", number: "ARTICLE 2", heading: "SIGN", paragraphs: ["Seller: {{b6}}", "Purchaser: {{b7}}"] },
        ],
        blanks: [
          blank("b1", "Name", "seller_name"),
          blank("b2", "Name", "purchaser_name_1"),
          blank("b3", "Name", "purchaser_name_2"),
          blank("b4", "Unit no", "unit_no"),
          blank("b5", "Price", "price"),
          sign("b6", "Seller"),
          sign("b7", "Purchaser"),
        ],
      };
      await approvedTemplate(slotted, "mou");
      const { dealId } = await dealInDraft(ctx(), database, {
        type: "resale_ready",
        unitNo: "B-7",
        buyers: ["Buyer One", "Buyer Two", "Buyer Three"],
      });
      const r = await prepare(dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.join(" ")).toContain("3 purchasers, template has 2 slots");
      expect(await agreementsOf(dealId)).toHaveLength(0);
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
    });

    test("two brokers on the deal and a template with one broker block", async () => {
      const tpl = withExtra(spaTpl(), "Broker: {{b20}}");
      tpl.blanks.push(blank("b20", "Broker", "broker_agency"));
      await approvedTemplate(tpl, "spa");
      const { dealId } = await primary();
      await broker(database, dealId, "seller", "Sample Realty");
      expect((await prepare(dealId)).ok).toBe(true);
      const second = await primary();
      await broker(database, second.dealId, "seller", "Sample Realty");
      await broker(database, second.dealId, "buyer", "Other Realty");
      const r = await prepare(second.dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.join(" ")).toContain("two brokers");
    });
  });

  describe("prepare checks", () => {
    test("an email in the template's wording that isn't this deal's stops preparation", async () => {
      await forceApprovedTemplate(withExtra(spaTpl(), "Questions: other.deal@example.test"), "spa");
      const { dealId } = await primary();
      const r = await prepare(dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reasons.join(" ")).toContain("email");
        expect(r.reasons.join(" ")).not.toContain("other.deal");
      }
      expect(await agreementsOf(dealId)).toHaveLength(0);
      expect(JSON.stringify((await eventsOf(dealId, "PREPARE_STOPPED"))[0]!.payload)).not.toContain("other.deal");
    });

    test("an AED amount in the wording that isn't this deal's stops preparation; this deal's own price is fine", async () => {
      await forceApprovedTemplate(withExtra(spaTpl(), "A reservation fee of AED 1,250,000 applies."), "spa");
      const { dealId } = await primary();
      const r = await prepare(dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reasons.join(" ")).toContain("amount");
        expect(r.reasons.join(" ")).not.toContain("1,250,000");
      }
      // The same sentence with this deal's own price (AED 2,000,000) is this deal's value.
      await forceApprovedTemplate(withExtra(mouTpl(), "A fee of AED 2,000,000 applies."), "mou");
      const resale = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "B-7" });
      expect((await prepare(resale.dealId)).ok).toBe(true);
    });

    test("an Emirates ID or passport number in the wording stops preparation", async () => {
      await forceApprovedTemplate(withExtra(spaTpl(), "Holder 784-1990-1234567-1."), "spa");
      const a = await primary();
      expect((await prepare(a.dealId)).ok).toBe(false);
      await forceApprovedTemplate(withExtra(mouTpl(), "Passport AB1234567."), "mou");
      const b = await dealInDraft(ctx(), database, { type: "resale_ready", unitNo: "B-7" });
      expect((await prepare(b.dealId)).ok).toBe(false);
    });

    test("a template approved under rulebook A stops on a deal pinned to rulebook B with a different fee %", async () => {
      const fee = withExtra(spaTpl(), "The DLD registration fee of 4% is paid by the buyer.");
      await approvedTemplate(fee, "spa");
      const { dealId } = await primary();
      rulebook = () => RB_B;
      const r = await prepare(dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.join(" ")).toMatch(/registration fee of 4%/);
      expect(await agreementsOf(dealId)).toHaveLength(0);
      // The deal's own rulebook says 4%: the same template prepares.
      rulebook = () => RB;
      const ok = await prepare(dealId);
      expect(ok.ok).toBe(true);
    });

    test("a pending fee rate can't be checked, so it stops", async () => {
      const fee = withExtra(spaTpl(), "The DLD registration fee of 4% is paid by the buyer.");
      await approvedTemplate(fee, "spa");
      const { dealId } = await primary();
      rulebook = (v) => (v === RB.version ? { ...RB, pending: ["registrationFeeBps"] } : null);
      const r = await prepare(dealId);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.reasons.join(" ")).toContain("awaits legal confirmation");
    });
  });

  describe("review mode (C24, S59)", () => {
    const reviews = (id: string) =>
      database.db
        .select()
        .from(spaApprovals)
        .where(and(eq(spaApprovals.entityId, id), eq(spaApprovals.gate, "helper_review")));

    test("the agreement is prepared and stored but PREPARED is held: no legal gate, the deal stays in AGREEMENT_DRAFT, agreementPrepared is false", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      expect(await prepare(dealId)).toMatchObject({ ok: true, created: true, version: 1 });
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      const [a] = await agreementsOf(dealId);
      expect(a!.status).toBe("prepared");
      expect(a!.approvalId).toBeNull();
      expect(await approvalsOf(dealId)).toHaveLength(0);
      expect((await factsOf(dealId)).agreementPrepared).toBe(false);
      const g = await reviews(dealId);
      expect(g).toHaveLength(1);
      expect([g[0]!.status, g[0]!.proposedBy, g[0]!.approverRole]).toEqual([
        "pending",
        "system:spa_prepare",
        "sales_officer",
      ]);
      // Preparing the same values again: the same agreement, no second review, no second legal gate.
      expect(await prepare(dealId)).toMatchObject({ ok: true, created: false, agreementId: a!.id });
      expect(await agreementsOf(dealId)).toHaveLength(1);
      expect(await reviews(dealId)).toHaveLength(1);
    });

    test("a sales officer's approval sends it to legal: PREPARED, the agreement_approval and agreementPrepared true", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [g] = await reviews(dealId);
      await decideApproval(ctx(), g!.id, users.officer!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");
      const [a] = await agreementsOf(dealId);
      expect(a!.status).toBe("in_review");
      const [ap] = await approvalsOf(dealId);
      expect([ap!.status, ap!.approverRole, ap!.proposedBy]).toEqual(["pending", "legal", "system:prepare"]);
      expect(a!.approvalId).toBe(ap!.id);
      expect(await eventsOf(dealId, "PREPARED")).toHaveLength(1);
      expect((await factsOf(dealId)).agreementPrepared).toBe(true);
    });

    test("a rejected result stays held: the deal does not move and the agent gets one task", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [g] = await reviews(dealId);
      await decideApproval(ctx(), g!.id, users.manager!, { decision: "reject", note: "Wrong unit printed" });
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      expect((await factsOf(dealId)).agreementPrepared).toBe(false);
      const tasks = await database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId));
      expect(tasks.map((t) => t.kind)).toEqual(["helper_rejected"]);
    });

    test("a deal that changed after preparing: approving the old review does not send a stale agreement to legal", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary();
      await prepare(dealId);
      const [g] = await reviews(dealId);
      await database.db.update(parties).set({ fullNameEn: "Buyer Renamed" }).where(eq(parties.id, buyerIds[0]!));
      await decideApproval(ctx(), g!.id, users.officer!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      expect(await approvalsOf(dealId)).toHaveLength(0);
    });
  });

  describe("legal's decision and a changed deal", () => {
    test("agreementPrepared is real: false before, true after, false again once a value changes", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary();
      expect((await factsOf(dealId)).agreementPrepared).toBe(false);
      await prepare(dealId);
      expect((await factsOf(dealId)).agreementPrepared).toBe(true);
      await database.db.update(parties).set({ fullNameEn: "Buyer Renamed" }).where(eq(parties.id, buyerIds[0]!));
      expect((await factsOf(dealId)).agreementPrepared).toBe(false);
      expect(Object.keys(await factsOf(dealId)).toSorted()).toEqual([...DEAL_FACT_KEYS].toSorted());
    });

    test("approving moves the deal to SIGNING, marks the agreement approved and consumes the approval", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [ap] = await approvalsOf(dealId);
      expect(await fails(decideApproval(ctx(), ap!.id, users.manager!, { decision: "approve" }))).toMatchObject({
        status: 403,
      });
      expect(await fails(decideApproval(ctx(), ap!.id, users.admin!, { decision: "approve" }))).toMatchObject({
        status: 403,
      });
      expect(
        await fails(decideApproval(ctx(), ap!.id, users.legal!, { decision: "edit", proposal: { a: 1 } })),
      ).toEqual({ status: 422, code: "edit_not_allowed" });
      await decideApproval(ctx(), ap!.id, users.legal!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("SIGNING");
      const [a] = await agreementsOf(dealId);
      expect(a!.status).toBe("approved");
      const [done] = await approvalsOf(dealId);
      expect(done!.consumedByEventId).not.toBeNull();
    });

    test("a deal value that changed after preparing makes approval impossible (agreement_stale), nothing changes", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary();
      await prepare(dealId);
      const [ap] = await approvalsOf(dealId);
      await database.db.update(parties).set({ fullNameEn: "Buyer Renamed" }).where(eq(parties.id, buyerIds[0]!));
      expect(await fails(decideApproval(ctx(), ap!.id, users.legal!, { decision: "approve" }))).toEqual({
        status: 422,
        code: "agreement_stale",
      });
      expect((await approvalsOf(dealId))[0]!.status).toBe("pending");
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");
      expect((await agreementsOf(dealId))[0]!.status).toBe("in_review");
    });

    test("the same is true of a changed payment plan row, price-free: the hash covers the plan", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [ap] = await approvalsOf(dealId);
      // The trigger fixes the rows; a person can't change them through the Manager either.
      expect(await fails(setPaymentPlan(ctx(), dealId, PLAN, users.officer!))).toEqual({
        status: 409,
        code: "plan_fixed",
      });
      expect(
        await database.db
          .update(paymentPlanRows)
          .set({ label: "x" })
          .where(eq(paymentPlanRows.dealId, dealId))
          .then(
            () => "changed",
            () => "refused",
          ),
      ).toBe("refused");
      await decideApproval(ctx(), ap!.id, users.legal!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("SIGNING");
    });

    test("an agreement_approval with no prepared agreement behind it can't be approved (fail closed)", async () => {
      const { dealId } = await primary();
      await database.db.update(deals).set({ state: "LEGAL_REVIEW" }).where(eq(deals.id, dealId));
      const p = await proposeApproval(ctx(), {
        gate: "agreement_approval",
        entity: { kind: "deal", id: dealId },
        dedupeKey: `${dealId}:orphan`,
        title: "x",
        proposal: {},
        proposedBy: `user:${users.officer!.id}`,
      });
      expect(await fails(decideApproval(ctx(), p.id, users.legal!, { decision: "approve" }))).toEqual({
        status: 422,
        code: "agreement_stale",
      });
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");
    });

    test("a rejection returns the deal; preparing again makes version 2 and the first stays superseded", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId, buyerIds } = await primary();
      await prepare(dealId);
      const [ap1] = await approvalsOf(dealId);
      await decideApproval(ctx(), ap1!.id, users.legal!, { decision: "reject", note: "wrong buyer name" });
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      expect((await agreementsOf(dealId))[0]!.status).toBe("superseded");
      expect((await eventsOf(dealId, "RETURNED"))[0]!.toState).toBe("AGREEMENT_DRAFT");
      // Sales fixes the name and the plan (free again), and prepares again.
      await database.db.update(parties).set({ fullNameEn: "Buyer Corrected" }).where(eq(parties.id, buyerIds[0]!));
      await setPaymentPlan(ctx(), dealId, PLAN, users.officer!);
      const r = await prepare(dealId);
      expect(r).toMatchObject({ ok: true, version: 2, created: true });
      const all = await agreementsOf(dealId);
      expect(all.map((x) => [x.version, x.status])).toEqual([
        [1, "superseded"],
        [2, "in_review"],
      ]);
      expect(all[1]!.valuesHash).not.toBe(all[0]!.valuesHash);
      expect(await textOf(all[1]!)).toContain("Buyer Corrected");
      const aps = await approvalsOf(dealId);
      expect(aps.map((x) => x.status)).toEqual(["rejected", "pending"]);
      await decideApproval(ctx(), aps[1]!.id, users.legal!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("SIGNING");
    });
    test("LEGAL_REVIEW, then a compliance hold and clear, then back to AGREEMENT_DRAFT: preparing again advances with the same agreement and approval (review 7)", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary({ buyers: [FAKE_SANCTIONS[0]!.name] });
      await prepare(dealId);
      const [ag1] = await agreementsOf(dealId);
      const [ap1] = await approvalsOf(dealId);
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");
      // A screening flags the buyer: the deal goes on hold, the agreement stays in review with its pending approval.
      const screened = await screenDeal(
        ctx(),
        { screening: new FakeScreening(), llm: null },
        { dealId, trigger: "before_agreement" },
      );
      expect(screened.flagged).toBe(true);
      expect(await stateOf(dealId)).toBe("AML_HOLD");
      // Compliance clears it and signs off the high-risk buyer; the deal returns to its checks.
      await decideApproval(ctx(), screened.approvalId!, users.compliance!, { decision: "aml", outcome: "clear" });
      expect(await stateOf(dealId)).toBe("PARTY_CHECK");
      const edd = await database.db
        .select()
        .from(spaApprovals)
        .where(
          and(
            eq(spaApprovals.entityId, dealId),
            eq(spaApprovals.gate, "edd_signoff"),
            eq(spaApprovals.status, "pending"),
          ),
        );
      for (const e of edd) await decideApproval(ctx(), e.id, users.compliance!, { decision: "approve" });
      // KYC and the company check are other chunks' facts: switched on by hand, the AML facts stay real.
      const checked: SpaContext = {
        ...ctx(),
        facts: {
          deal: async (tx, row, today, env) => ({
            ...(await failClosedFacts.deal(tx, row, today, env)),
            documentsRequested: true,
            kycOk: true,
            companyChecksOk: true,
          }),
          listing: failClosedFacts.listing,
        },
      };
      await advance(checked, { kind: "deal", id: dealId }, "CHECKS_PASSED", { actor: "system" });
      expect(await stateOf(dealId)).toBe("AGREEMENT_DRAFT");
      // Nothing changed in the deal: the same agreement goes back to legal, with the approval it already has.
      const r = await prepare(dealId);
      expect(r).toMatchObject({ ok: true, created: false, agreementId: ag1!.id, version: 1 });
      expect(await stateOf(dealId)).toBe("LEGAL_REVIEW");
      expect((await agreementsOf(dealId)).map((a) => [a.id, a.status, a.approvalId])).toEqual([
        [ag1!.id, "in_review", ap1!.id],
      ]);
      expect((await approvalsOf(dealId)).map((a) => [a.id, a.status])).toEqual([[ap1!.id, "pending"]]);
      expect((await eventsOf(dealId, "PREPARED")).length).toBe(2);
      // Preparing once more in LEGAL_REVIEW is still a no-op, and legal can approve it.
      expect(await prepare(dealId)).toMatchObject({ created: false });
      expect((await eventsOf(dealId, "PREPARED")).length).toBe(2);
      await decideApproval(ctx(), ap1!.id, users.legal!, { decision: "approve" });
      expect(await stateOf(dealId)).toBe("SIGNING");
    });
    test("the database lets an agreement become approved only through its own approved agreement_approval for the same deal (review 12)", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const [ag] = await agreementsOf(dealId);
      const q = (sql: string, params: unknown[] = []) => database.pool.query(sql, params);
      const mk = async (o: { gate: string; entityId?: string }) => {
        const a = newId();
        await database.db.insert(spaApprovals).values({
          id: a,
          gate: o.gate as never,
          entityKind: "deal",
          entityId: o.entityId ?? dealId,
          dedupeKey: `k:${a}`,
          title: "x",
          proposal: {},
          approverRole: "legal",
          proposedBy: "system",
          status: "approved",
          decidedBy: users.legal!.id,
          decidedAt: new Date("2026-11-19T06:00:00Z"),
          createdAt: new Date("2026-11-19T06:00:00Z"),
        });
        return a;
      };
      const relink = async (approvalId: string) => {
        await q(`alter table agreements disable trigger user`);
        await q(`update agreements set approval_id = $2 where id = $1`, [ag!.id, approvalId]);
        await q(`alter table agreements enable trigger user`);
      };
      const approve = () => q(`update agreements set status = 'approved' where id = $1`, [ag!.id]);
      await expect(approve()).rejects.toThrow(/agreements/); // its own approval is pending
      await relink(await mk({ gate: "settlement_approval" }));
      await expect(approve()).rejects.toThrow(/agreement_approval/);
      await relink(await mk({ gate: "agreement_approval", entityId: newId() }));
      await expect(approve()).rejects.toThrow(/agreement_approval/);
      await relink(await mk({ gate: "agreement_approval" }));
      await approve();
      expect((await agreementsOf(dealId))[0]!.status).toBe("approved");
    });
    test("a cancelled deal's pending agreement approval is cancelled and its agreement superseded (C20, closes S51 gap)", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await prepare(dealId);
      const c = await proposeApproval(ctx(), {
        gate: "cancellation",
        entity: { kind: "deal", id: dealId },
        dedupeKey: `${dealId}:cancellation`,
        title: "cancel",
        proposal: {},
        proposedBy: `user:${users.officer!.id}`,
      });
      await decideApproval(ctx(), c.id, users.manager!, { decision: "approve" });
      await advance(ctx(), { kind: "deal", id: dealId }, "CANCEL", {
        actor: `user:${users.manager!.id}`,
        approvalId: c.id,
      });
      expect(await stateOf(dealId)).toBe("CANCELLED");
      expect((await approvalsOf(dealId)).map((a) => a.status)).toEqual(["cancelled"]);
      expect((await agreementsOf(dealId)).map((a) => a.status)).toEqual(["superseded"]);
      expect((await eventsOf(dealId, "AGREEMENT_SUPERSEDED"))[0]?.payload).toMatchObject({ reason: "deal cancelled" });
      expect(
        await fails(decideApproval(ctx(), (await approvalsOf(dealId))[0]!.id, users.legal!, { decision: "approve" })),
      ).not.toBeNull();
    });
  });

  describe("the three fictional templates", () => {
    test("a primary SPA with a repeating purchaser block, a ready-resale MOU and an off-plan resale assignment", async () => {
      await approvedTemplate(spaTpl(), "spa");
      await approvedTemplate(mouTpl(), "mou");
      await approvedTemplate(assignmentTpl(), "assignment");

      const p = await primary({ buyers: ["Alma Example", "Bram Sample"] });
      const rp = await prepare(p.dealId);
      expect(rp).toMatchObject({ ok: true, kind: "spa" });
      const [ap] = await agreementsOf(p.dealId);
      const tp = await textOf(ap!);
      expect(tp).toContain("Alma Example");
      expect(tp).toContain("Bram Sample");
      expect(tp.indexOf("1. PARTIES")).toBeLessThan(tp.indexOf("2. PROPERTY AND PRICE"));
      expect(tp.indexOf("2. PROPERTY AND PRICE")).toBeLessThan(tp.indexOf("3. SIGNATURES"));

      // A ready resale with two co-owner sellers and two buyers: both blocks repeat.
      const m = await dealInDraft(ctx(), database, {
        type: "resale_ready",
        unitNo: "B-7",
        sellers: ["Seller Alpha", "Seller Beta"],
        buyers: ["Buyer Gamma", "Buyer Delta"],
        price: 150_000_000,
      });
      await database.db.update(deals).set({ targetTransferOn: "2027-02-01" }).where(eq(deals.id, m.dealId));
      expect(await prepare(m.dealId)).toMatchObject({ ok: true, kind: "mou" });
      const [am] = await agreementsOf(m.dealId);
      const tm = await textOf(am!);
      for (const s of [
        "MEMORANDUM OF UNDERSTANDING",
        "ARTICLE 1 PARTIES",
        "Seller Alpha",
        "Seller Beta",
        "Buyer Gamma",
        "Buyer Delta",
        "TD-FICT-1",
        "AED 1,500,000",
        "1 February 2027",
      ])
        expect(tm).toContain(s);
      expect(tm).not.toContain("Alma Example");

      // An off-plan resale uses the assignment template.
      const x = await dealInDraft(ctx(), database, { type: "resale_offplan", unitNo: "C-3" });
      expect(await prepare(x.dealId)).toMatchObject({ ok: true, kind: "assignment" });
      const [ax] = await agreementsOf(x.dealId);
      const tx = await textOf(ax!);
      expect(tx).toContain("ASSIGNMENT OF SALE AND PURCHASE AGREEMENT");
      expect(tx).not.toContain("Bram Sample");
      expect(tx).not.toContain("Seller Alpha");
    });
  });

  describe("the queue and the routes", () => {
    test("one job per deal and set of values; the handler prepares and a second run changes nothing", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      const seen: unknown[] = [];
      const jobs = await startJobs(createBoss(url!), clock, {
        prepare: async (data) => void seen.push(data),
      });
      try {
        const a = await enqueuePrepare(ctx(), jobs.boss, dealId, users.officer!);
        const b = await enqueuePrepare(ctx(), jobs.boss, dealId, users.officer!);
        expect(a.key).toBe(b.key);
        expect(a.key).toBe(await prepareJobKey(ctx(), dealId));
        expect(a.key).toMatch(new RegExp(`^${dealId}:prepare:[0-9a-f]{64}$`));
        for (let i = 0; i < 50 && seen.length === 0; i++) await Bun.sleep(100);
        expect(seen).toEqual([{ dealId }]);
        expect(AGREEMENT_PREPARE_JOB).toBe("spa.prepare");
        // A change of a value is a different key.
        await database.db.update(deals).set({ unitNo: "A-102" }).where(eq(deals.id, dealId));
        expect(await prepareJobKey(ctx(), dealId)).not.toBe(a.key);
      } finally {
        await jobs.stop();
      }
      expect(await runPrepareJob(ctx(), { store }, { dealId })).toMatchObject({ ok: true, created: true });
      expect(await runPrepareJob(ctx(), { store }, { dealId })).toMatchObject({ ok: true, created: false });
      expect(await agreementsOf(dealId)).toHaveLength(1);
    });

    test("the job swallows a deal that is no longer in AGREEMENT_DRAFT and one that doesn't exist", async () => {
      await approvedTemplate(spaTpl(), "spa");
      const { dealId } = await primary();
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
      expect(await runPrepareJob(ctx(), { store }, { dealId })).toMatchObject({ ok: false });
      expect(await runPrepareJob(ctx(), { store }, { dealId: newId() })).toMatchObject({ ok: false });
    });

    test("enqueue: only sales roles and admin; the deal must be in AGREEMENT_DRAFT", async () => {
      const { dealId } = await primary();
      const boss = { send: async () => "job-1" };
      expect(await fails(enqueuePrepare(ctx(), boss, dealId, users.legal!))).toMatchObject({ status: 403 });
      expect(await fails(enqueuePrepare(ctx(), boss, newId(), users.officer!))).toMatchObject({ status: 404 });
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
      expect(await fails(enqueuePrepare(ctx(), boss, dealId, users.officer!))).toEqual({
        status: 409,
        code: "not_in_agreement_draft",
      });
    });
  });
});

describe.skipIf(!url)("spa-prepare routes (C19)", () => {
  const SECRET = "s".repeat(40);
  const NOW = Date.now();
  const sent: { name: string; data: unknown; opts: { singletonKey?: string } }[] = [];
  const app = () =>
    createApp({
      database,
      jobs: {
        boss: {
          send: async (name: string, data: unknown, opts: { singletonKey?: string }) => (
            sent.push({ name, data, opts }),
            "job-1"
          ),
        } as never,
        lastHeartbeat: () => null,
      },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
      rulebook: () => RB,
    });
  const as = (u: { id: string } | null): Record<string, string> =>
    u ? { authorization: `Bearer ${issueToken(SECRET, u.id, NOW)}` } : {};
  const send = (method: string, u: { id: string } | null, body: unknown = {}) => ({
    method,
    headers: { "content-type": "application/json", ...as(u) },
    body: JSON.stringify(body),
  });
  const routeCtx = (): SpaContext => ({
    database,
    clock: new SpaDemoClock(database, false),
    facts: failClosedFacts,
    rulebook: () => RB,
  });
  beforeEach(async () => {
    sent.length = 0;
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  test("both routes need a signed-in user", async () => {
    const id = newId();
    expect((await app().request(`/api/deals/${id}/prepare`, send("POST", null))).status).toBe(401);
    expect((await app().request(`/api/deals/${id}/payment-plan`, send("PUT", null, PLAN))).status).toBe(401);
  });

  test("PUT payment-plan stores the rows; legal can't; a bad plan is 422; a bad id is 404", async () => {
    const { dealId } = await dealInDraft(routeCtx(), database, { unitNo: "A-101" });
    const ok = await app().request(`/api/deals/${dealId}/payment-plan`, send("PUT", users.officer!, PLAN));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toEqual({ rows: 2 });
    expect(await database.db.select().from(paymentPlanRows).where(eq(paymentPlanRows.dealId, dealId))).toHaveLength(2);
    expect((await app().request(`/api/deals/${dealId}/payment-plan`, send("PUT", users.legal!, PLAN))).status).toBe(
      403,
    );
    const bad = await app().request(
      `/api/deals/${dealId}/payment-plan`,
      send("PUT", users.officer!, { instalments: [{ label: "Part", shareBps: 5000, dueOn: "2026-12-01" }] }),
    );
    expect(bad.status).toBe(422);
    expect(((await bad.json()) as { code: string }).code).toBe("invalid_plan");
    expect((await app().request(`/api/deals/not-an-id/payment-plan`, send("PUT", users.officer!, PLAN))).status).toBe(
      404,
    );
  });

  test("POST prepare queues one job keyed by the deal's values and says nothing else", async () => {
    const { dealId } = await dealInDraft(routeCtx(), database, { unitNo: "A-101" });
    const res = await app().request(`/api/deals/${dealId}/prepare`, send("POST", users.officer!));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ queued: true });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ name: AGREEMENT_PREPARE_JOB, data: { dealId } });
    expect(sent[0]!.opts.singletonKey).toMatch(new RegExp(`^${dealId}:prepare:[0-9a-f]{64}$`));
    expect((await app().request(`/api/deals/${dealId}/prepare`, send("POST", users.finance!))).status).toBe(403);
    expect((await app().request(`/api/deals/not-an-id/prepare`, send("POST", users.officer!))).status).toBe(404);
    await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
    expect((await app().request(`/api/deals/${dealId}/prepare`, send("POST", users.officer!))).status).toBe(409);
  });
});
