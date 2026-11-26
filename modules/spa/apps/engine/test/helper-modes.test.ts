import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { FixedClock, newId } from "@platform/kernel";
import {
  dealEvents,
  deals,
  helperReviewHolds,
  helperRuns,
  type SpaDatabase,
  spaApprovals,
  spaHelperSettings,
  spaTasks,
  withSpaTx,
} from "@spa/db";
import { mayDecide } from "@spa/core";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { and, eq } from "drizzle-orm";
import { createHash } from "node:crypto";
import { decideApproval } from "../src/manager/approvals.ts";
import { driveDeal } from "../src/manager/drive.ts";
import { runCompanyCheck } from "../src/manager/company-check.ts";
import { runKyc } from "../src/manager/kyc.ts";
import { uploadDocument } from "../src/manager/noc.ts";
import { runOwnershipCheck } from "../src/manager/ownership-check.ts";
import { prepareAgreement } from "../src/manager/prepare.ts";
import { ApprovalsQuery, getApproval, listApprovals } from "../src/manager/reads.ts";
import { readDocument } from "../src/manager/readers.ts";
import type { SpaContext } from "../src/manager/context.ts";
import { failClosedFacts } from "../src/manager/facts.ts";
import {
  afterHelperResult,
  getHelperSettings,
  heldRunIds,
  helperMode,
  setHelperMode,
} from "../src/manager/helper-modes.ts";
import { dealInDraft, RB, seedUsers, type U } from "./prepare-fixtures.ts";

const url = spaTestDatabaseUrl();
let database: SpaDatabase;
let users: Record<string, U> = {};
const clock = new FixedClock(new Date("2026-11-19T06:00:00Z"));
const ctx = (): SpaContext => ({ database, clock, facts: failClosedFacts, rulebook: () => RB });
const fails = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: { status?: number; code?: string }) => ({ status: e.status, code: e.code }),
  );

/** A helper run row with the given status, on a fresh resale deal. */
async function runOn(
  dealId: string,
  helper = "spa_kyc",
  status: "ok" | "needs_human" = "ok",
  reasons: string[] = [],
  visibility: "staff" | "compliance" = "staff",
) {
  const id = newId();
  await database.db.insert(helperRuns).values({
    id,
    helper,
    dealId,
    entityKind: "deal",
    entityId: dealId,
    status,
    result: {},
    reasons,
    visibility,
    rulesVersion: "r",
    createdAt: clock.now(),
  });
  return id;
}
const after = (dealId: string, runId: string, helper = "spa_kyc", status: "ok" | "needs_human" = "ok", scope = "*") =>
  withSpaTx(database, (tx) => afterHelperResult(ctx(), tx, { helper: helper as never, scope, dealId, runId, status }));
const held = (dealId: string) => withSpaTx(database, (tx) => heldRunIds(tx, dealId));
const holdRows = (dealId: string) =>
  database.db.select().from(helperReviewHolds).where(eq(helperReviewHolds.dealId, dealId));
const reviewGates = (dealId: string) =>
  database.db
    .select()
    .from(spaApprovals)
    .where(and(eq(spaApprovals.entityId, dealId), eq(spaApprovals.gate, "helper_review")));
const events = (type: string) => database.db.select().from(dealEvents).where(eq(dealEvents.type, type));

describe.skipIf(!url)("helper modes (C24, S59)", () => {
  beforeEach(async () => {
    await database?.close();
    database = await freshSpaDatabase(url!);
    users = await seedUsers(database);
  });
  afterAll(async () => {
    await database?.close();
    database = undefined as never;
  });

  describe("reader scopes that can be reviewed (S59 amendment)", () => {
    test("review is refused for a kind whose read feeds no held record; noc, letters and receipts accept it", async () => {
      for (const scope of ["title_deed", "trade_licence", "memorandum", "poa", "board_resolution", "oqood"])
        expect(
          await fails(setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", scope, mode: "review" })),
        ).toEqual({ status: 422, code: "review_not_available" });
      for (const scope of [
        "noc",
        "liability_letter",
        "release_letter",
        "pre_approval",
        "final_offer",
        "payment_receipt",
      ])
        expect(
          await setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", scope, mode: "review" }),
        ).toMatchObject({ changed: true });
      expect(
        await setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", scope: "title_deed", mode: "off" }),
      ).toMatchObject({ changed: true });
      const reader = (await getHelperSettings(ctx(), users.admin!, {})).helpers.find(
        (h) => h.helper === "spa_document_reader",
      )!;
      expect(reader.reviewScopes).toContain("payment_receipt");
      expect(reader.reviewScopes).not.toContain("title_deed");
    });
  });

  describe("setting a mode", () => {
    test("default is auto; the latest version for a helper and scope is in force; a document kind overrides *", async () => {
      const db = database.db;
      expect(await helperMode(db, "spa_kyc")).toBe("auto");
      expect(await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "review" })).toMatchObject({
        version: 1,
        mode: "review",
      });
      expect(await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "off" })).toMatchObject({
        version: 2,
      });
      expect(await helperMode(db, "spa_kyc")).toBe("off");
      await setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", mode: "review" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", scope: "noc", mode: "off" });
      expect(await helperMode(db, "spa_document_reader", "noc")).toBe("off");
      expect(await helperMode(db, "spa_document_reader", "title_deed")).toBe("review");
      expect(await helperMode(db, "spa_document_reader")).toBe("review");
    });

    test("every change adds a version row and one event; the same mode again adds neither", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "review" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_prepare", mode: "auto" });
      const rows = await database.db
        .select()
        .from(spaHelperSettings)
        .where(eq(spaHelperSettings.helper, "spa_prepare"));
      expect(rows.map((r) => [r.version, r.mode, r.setBy])).toEqual([
        [1, "review", `user:${users.admin!.id}`],
        [2, "auto", `user:${users.admin!.id}`],
      ]);
      const ev = (await events("HELPER_MODE_SET")).filter((e) => e.payload.helper === "spa_prepare");
      expect(ev.map((e) => [e.payload.mode, e.payload.version, e.payload.previous])).toEqual([
        ["review", 1, "auto"],
        ["auto", 2, "review"],
      ]);
      expect(ev[0]!.entityKind).toBe("settings");
    });

    test("only an admin sets a mode (even a sales manager and a compliance officer are refused)", async () => {
      for (const u of ["manager", "officer", "compliance", "finance", "legal"] as const)
        expect(await fails(setHelperMode(ctx(), users[u]!, { helper: "spa_kyc", mode: "off" }))).toEqual({
          status: 403,
          code: "forbidden",
        });
      expect(await database.db.select().from(spaHelperSettings)).toHaveLength(0);
    });

    test("a helper that is not switchable is refused with 422, whatever the role", async () => {
      for (const helper of ["aml_screening", "settlement", "chaser", "collections", "agreement_approval"])
        expect(await fails(setHelperMode(ctx(), users.admin!, { helper, mode: "off" }))).toEqual({
          status: 422,
          code: "not_switchable",
        });
      expect(await fails(setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "maybe" }))).toEqual({
        status: 422,
        code: "invalid_helper_setting",
      });
      expect(await fails(setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", scope: "noc", mode: "off" }))).toEqual(
        { status: 422, code: "invalid_helper_setting" },
      );
    });

    test("a model or prompt field is refused: models are read-only here (S25)", async () => {
      for (const extra of [{ model: "x:1b" }, { modelTag: "x" }, { visionModel: "y" }, { prompt: "z" }])
        expect(
          await fails(setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "review", ...extra })),
        ).toEqual({ status: 422, code: "model_read_only" });
      expect(await database.db.select().from(spaHelperSettings)).toHaveLength(0);
    });

    test("the settings list shows every switchable helper with its mode; the models come from the env tags, read-only", async () => {
      await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "review" });
      const out = await getHelperSettings(ctx(), users.manager!, { vision: "v:1", chat: "c:1", decision: "d:1" });
      expect(out.helpers.map((h) => h.helper)).toEqual([
        "spa_ownership_check",
        "spa_kyc",
        "spa_company_check",
        "spa_document_reader",
        "spa_prepare",
        "registry",
        "spa_agreement_review",
      ]);
      const by = Object.fromEntries(out.helpers.map((h) => [h.helper, h]));
      expect(by.spa_kyc!.settings).toEqual([expect.objectContaining({ scope: "*", mode: "review", version: 1 })]);
      expect(by.spa_ownership_check!.settings).toEqual([expect.objectContaining({ scope: "*", mode: "auto" })]);
      expect(by.spa_kyc!.model).toBe("v:1");
      expect(by.registry!.model).toBe("d:1");
      expect(by.spa_agreement_review!.model).toBe("c:1");
      expect(by.spa_prepare!.model).toBeNull();
      expect(out.canEdit).toBe(false);
      expect((await getHelperSettings(ctx(), users.admin!, {})).canEdit).toBe(true);
      expect(await fails(getHelperSettings(ctx(), users.officer!, {}))).toEqual({ status: 403, code: "forbidden" });
    });
  });

  describe("afterHelperResult", () => {
    test("auto and off hold nothing; review holds an ok result only", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      const r1 = await runOn(dealId);
      expect(await after(dealId, r1)).toEqual({ held: false });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "off" });
      expect(await after(dealId, await runOn(dealId))).toEqual({ held: false });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "review" });
      const hr = await runOn(dealId, "spa_kyc", "needs_human");
      expect(await after(dealId, hr, "spa_kyc", "needs_human")).toEqual({ held: false });
      expect(await holdRows(dealId)).toHaveLength(0);
      const r2 = await runOn(dealId);
      expect(await after(dealId, r2)).toEqual({ held: true });
      const [h] = await holdRows(dealId);
      expect([h!.runId, h!.status, h!.decidedAt]).toEqual([r2, "pending", null]);
      expect(await held(dealId)).toEqual(new Set([r2]));
    });

    test("a held result opens one helper_review for a sales officer, proposed by the helper, and an event", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_company_check", mode: "review" });
      const run = await runOn(dealId, "spa_company_check");
      await after(dealId, run, "spa_company_check");
      await after(dealId, run, "spa_company_check");
      const gates = await reviewGates(dealId);
      expect(gates).toHaveLength(1);
      expect([gates[0]!.status, gates[0]!.approverRole, gates[0]!.proposedBy]).toEqual([
        "pending",
        "sales_officer",
        "system:spa_company_check",
      ]);
      expect(gates[0]!.proposal).toMatchObject({ helper: "spa_company_check", runId: run });
      expect(await holdRows(dealId)).toHaveLength(1);
      expect((await events("HELPER_REVIEW_HELD")).filter((e) => e.payload.runId === run)).toHaveLength(1);
    });

    test("the helper_review card carries the held result's reasons, masked, on both approval routes (S63)", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_company_check", mode: "review" });
      const run = await runOn(dealId, "spa_company_check", "ok", [
        "Licence valid until 2027-03-01",
        "Call the owner on +971 50 123 4567",
      ]);
      await after(dealId, run, "spa_company_check");
      const [gate] = await reviewGates(dealId);
      const card = (await getApproval(ctx(), users.officer!, gate!.id)) as unknown as {
        heldResult: { helper: string; label: string; status: string; reasons: string[] };
      };
      expect(card.heldResult).toMatchObject({ helper: "spa_company_check", status: "ok" });
      expect(card.heldResult.label).toBeTruthy();
      expect(card.heldResult.reasons[0]).toBe("Licence valid until 2027-03-01");
      expect(JSON.stringify(card)).not.toContain("123 4567");
      const inbox = await listApprovals(ctx(), users.officer!, ApprovalsQuery.parse({ scope: "inbox" }));
      const item = inbox.items.find((i) => i.id === gate!.id) as unknown as { heldResult?: { reasons: string[] } };
      expect(item.heldResult?.reasons).toHaveLength(2);
    });

    test("a held result whose run is marked for compliance is not put on the card", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_company_check", mode: "review" });
      const run = await runOn(dealId, "spa_company_check", "ok", ["hidden"], "compliance");
      await after(dealId, run, "spa_company_check");
      const [gate] = await reviewGates(dealId);
      const card = (await getApproval(ctx(), users.officer!, gate!.id)) as unknown as { heldResult?: unknown };
      expect(card.heldResult).toBeUndefined();
    });

    test("the document reader's scope picks the mode: review for a NOC does not hold a title deed", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_document_reader", scope: "noc", mode: "review" });
      expect(
        await after(dealId, await runOn(dealId, "spa_document_reader"), "spa_document_reader", "ok", "title_deed"),
      ).toEqual({
        held: false,
      });
      expect(
        await after(dealId, await runOn(dealId, "spa_document_reader"), "spa_document_reader", "ok", "noc"),
      ).toEqual({
        held: true,
      });
    });
  });

  describe("deciding the review", () => {
    async function heldRun() {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      await setHelperMode(ctx(), users.admin!, { helper: "spa_kyc", mode: "review" });
      const run = await runOn(dealId);
      await after(dealId, run);
      const [gate] = await reviewGates(dealId);
      return { dealId, run, approvalId: gate!.id };
    }
    const status = async (run: string) =>
      (await database.db.select().from(helperReviewHolds).where(eq(helperReviewHolds.runId, run)))[0]!;

    test("a sales officer's approval releases the hold; the held set no longer names the run", async () => {
      const { dealId, run, approvalId } = await heldRun();
      expect(await decideApproval(ctx(), approvalId, users.officer!, { decision: "approve" })).toEqual({
        status: "approved",
      });
      const h = await status(run);
      expect([h.status, h.decidedAt !== null]).toEqual(["released", true]);
      expect((await held(dealId)).size).toBe(0);
      expect((await events("HELPER_REVIEW_RELEASED")).filter((e) => e.payload.runId === run)).toHaveLength(1);
    });

    test("a sales manager stands in; admin, finance and legal cannot decide", async () => {
      const a = await heldRun();
      for (const u of ["admin", "finance", "legal", "salesadmin", "compliance"] as const)
        expect(await fails(decideApproval(ctx(), a.approvalId, users[u]!, { decision: "approve" }))).toMatchObject({
          status: 403,
        });
      expect((await status(a.run)).status).toBe("pending");
      await decideApproval(ctx(), a.approvalId, users.manager!, { decision: "approve" });
      expect((await status(a.run)).status).toBe("released");
    });

    test("the proposer can't decide it: a copilot or user proposal is refused for its own author", async () => {
      for (const by of [`user:${users.officer!.id}`, `copilot:${users.officer!.id}`])
        expect(mayDecide({ gate: "helper_review", proposedBy: by }, users.officer!).ok).toBe(false);
      expect(mayDecide({ gate: "helper_review", proposedBy: "system:spa_kyc" }, users.officer!).ok).toBe(true);
      expect(mayDecide({ gate: "helper_review", proposedBy: "system:spa_kyc" }, users.admin!).ok).toBe(false);
    });

    test("a rejection needs a note, marks the hold rejected (the result stays held) and opens one task for the agent", async () => {
      const { dealId, run, approvalId } = await heldRun();
      expect(await fails(decideApproval(ctx(), approvalId, users.officer!, { decision: "reject" }))).toMatchObject({
        status: 422,
      });
      await decideApproval(ctx(), approvalId, users.officer!, { decision: "reject", note: "Names don't match" });
      expect((await status(run)).status).toBe("rejected");
      expect(await held(dealId)).toEqual(new Set([run]));
      const tasks = await database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId));
      expect(tasks).toHaveLength(1);
      expect([tasks[0]!.kind, tasks[0]!.role, tasks[0]!.status]).toEqual(["helper_rejected", "sales_officer", "open"]);
      expect(tasks[0]!.title).not.toMatch(/aml|sanction|pep|screening/i);
      expect((await events("HELPER_REVIEW_REJECTED")).filter((e) => e.payload.runId === run)).toHaveLength(1);
    });

    test("editing a review is refused: it is approved or rejected", async () => {
      const { approvalId } = await heldRun();
      expect(
        await fails(decideApproval(ctx(), approvalId, users.officer!, { decision: "edit", proposal: { a: 1 } })),
      ).toEqual({ status: 422, code: "edit_not_allowed" });
    });

    test("a decided review is final", async () => {
      const { approvalId } = await heldRun();
      await decideApproval(ctx(), approvalId, users.officer!, { decision: "approve" });
      expect(await fails(decideApproval(ctx(), approvalId, users.manager!, { decision: "reject", note: "x" }))).toEqual(
        {
          status: 409,
          code: "not_pending",
        },
      );
    });
  });

  describe("off at the job (a job queued before the switch is not run either)", () => {
    const store = {
      async put(bytes: Uint8Array, ext: string) {
        const sha256 = createHash("sha256").update(bytes).digest("hex");
        return { sha256, path: `${sha256.slice(0, 2)}/${sha256}.${ext}`, bytes: bytes.byteLength };
      },
    };
    const off = (helper: string, scope?: string) =>
      setHelperMode(ctx(), users.admin!, { helper, mode: "off", ...(scope ? { scope } : {}) });
    const taskKinds = async (dealId: string) =>
      (await database.db.select().from(spaTasks).where(eq(spaTasks.dealId, dealId))).map((t) => t.kind);
    const noRuns = async (dealId: string) =>
      expect(await database.db.select().from(helperRuns).where(eq(helperRuns.dealId, dealId))).toHaveLength(0);

    test("the KYC, company, ownership and prepare jobs answer 409 helper_off, write no run and open one task", async () => {
      const primary = await dealInDraft(ctx(), database, { type: "primary_offplan", unitNo: "A-1" });
      const resale = await dealInDraft(ctx(), database, { type: "resale_ready" });
      for (const h of ["spa_kyc", "spa_company_check", "spa_ownership_check", "spa_prepare"]) await off(h);
      const llm = {} as never;
      const deps = { llm, readFile: async () => new Uint8Array() };
      const refused = { status: 409, code: "helper_off" };
      expect(
        await fails(runKyc(ctx(), deps as never, { dealId: resale.dealId, partyId: resale.buyerIds[0]! })),
      ).toEqual(refused);
      expect(
        await fails(runCompanyCheck(ctx(), deps, { dealId: primary.dealId, partyId: primary.sellerIds[0]! })),
      ).toEqual(refused);
      expect(await fails(runOwnershipCheck(ctx(), deps, { dealId: resale.dealId }))).toEqual(refused);
      expect(await fails(prepareAgreement(ctx(), { store }, primary.dealId))).toEqual(refused);
      // Twice: still one task each.
      expect(await fails(prepareAgreement(ctx(), { store }, primary.dealId))).toEqual(refused);
      await noRuns(primary.dealId);
      await noRuns(resale.dealId);
      expect((await taskKinds(primary.dealId)).toSorted()).toEqual(["helper_off", "helper_off"]);
      expect((await taskKinds(resale.dealId)).toSorted()).toEqual(["helper_off", "helper_off"]);
      for (const t of await database.db.select().from(spaTasks))
        expect(t.title).not.toMatch(/aml|sanction|screening|\bpep\b/i);
    });

    test("a document read is off per kind, at the job too", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "resale_ready" });
      const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1]);
      const noc = await uploadDocument(
        ctx(),
        store,
        dealId,
        { kind: "noc", fileName: "n.png", bytes: png },
        users.officer!,
      );
      await off("spa_document_reader", "noc");
      const deps = { llm: {} as never, readFile: async () => png };
      expect(await fails(readDocument(ctx(), deps, { documentId: noc.id }))).toEqual({
        status: 409,
        code: "helper_off",
      });
      await noRuns(dealId);
    });

    test("off never lets a deal pass: with the KYC helper off the fact stays false and the driver moves nothing", async () => {
      const { dealId } = await dealInDraft(ctx(), database, { type: "primary_offplan", unitNo: "A-1" });
      await database.db.update(deals).set({ state: "PARTY_CHECK" }).where(eq(deals.id, dealId));
      await off("spa_kyc");
      const f = await withSpaTx(database, async (tx) => {
        const [d] = await tx.db.select().from(deals).where(eq(deals.id, dealId));
        return failClosedFacts.deal(tx, d!, clock.today());
      });
      expect([f.kycOk, f.companyChecksOk]).toEqual([false, false]);
      expect(await driveDeal(ctx(), dealId)).toEqual({ moved: [] });
      expect((await database.db.select().from(deals).where(eq(deals.id, dealId)))[0]!.state).toBe("PARTY_CHECK");
    });
  });
});
