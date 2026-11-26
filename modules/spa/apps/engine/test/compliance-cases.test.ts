/* oxlint-disable no-explicit-any -- response bodies are read loosely in these tests */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { newId } from "@platform/kernel";
import { issueToken } from "@platform/kernel";
import {
  amlCases,
  amlHits,
  dealEvents,
  documentReads,
  documents,
  parties,
  screenings,
  type SpaDatabase,
} from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { createApp } from "../src/app.ts";
import { SpaDemoClock } from "../src/clock.ts";
import { recordRiskAssessment } from "../src/manager/aml.ts";
import { buildWorld, EID, PASSPORT, PHONE, type World } from "./reads-fixture.ts";

const SECRET = "s".repeat(40);
const NOW = Date.parse("2026-11-19T06:00:00Z");
const url = spaTestDatabaseUrl();

describe.skipIf(!url)("C33: compliance cases (S65)", () => {
  let database: SpaDatabase;
  let w: World;
  let app: ReturnType<typeof createApp>;
  let eddId = "";
  let closedCase = "";
  let modelCase = "";
  const openCase = { id: "" };
  const call = (path: string, as: keyof World["users"]) =>
    app.request(path, { headers: { authorization: `Bearer ${issueToken(SECRET, w.users[as]!.id, NOW)}` } });
  const get = async (path: string, as: keyof World["users"]) => {
    const r = await call(path, as);
    return { status: r.status, text: await r.clone().text(), body: (await r.json()) as any };
  };
  const ROLES = ["officer", "manager", "salesadmin", "legal", "finance", "admin"] as const;
  const COMPLIANCE = ["compliance", "mlro"] as const;

  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
    app = createApp({
      database,
      jobs: { boss: { getQueue: async () => ({}) } as never, lastHeartbeat: () => null },
      clock: new SpaDemoClock(database, false),
      sessionSecret: SECRET,
      demoMode: false,
      nowMs: () => NOW,
    });
    const db = database.db;
    const [open] = await db.select().from(amlCases).where(eq(amlCases.dealId, w.held.dealId));
    openCase.id = open!.id;
    await db
      .update(parties)
      .set({ fullNameEn: `Buyer One ${PASSPORT}` })
      .where(eq(parties.id, w.held.buyer));
    await db.insert(screenings).values({
      id: newId(),
      dealId: w.held.dealId,
      partyId: w.held.buyer,
      subjectKey: `party:${w.held.buyer}`,
      trigger: "offer",
      listVersion: "v1",
      sanctionsScore: 0.97,
      pepScore: 0.2,
      exact: false,
      matches: {
        entries: [{ list: "sanctions", entryId: "S-1", score: 0.97 }],
        hits: [{ rule: "sanctions", severity: "flag", detail: "x", flags: true }],
      },
      screenedAt: new Date(NOW),
    });
    // Model text is untrusted: it can hold markup and a personal number.
    const [doc] = await db
      .insert(documents)
      .values({
        id: newId(),
        dealId: w.held.dealId,
        partyId: w.held.buyer,
        kind: "proof_of_address",
        fileName: "sof.pdf",
        mime: "application/pdf",
        sizeBytes: 10,
        sha256: "a".repeat(64),
        storageKey: "k",
        uploadedBy: "system",
        uploadedAt: new Date(NOW),
      })
      .returning({ id: documents.id });
    const { helperRuns } = await import("@spa/db");
    const [run] = await db
      .insert(helperRuns)
      .values({
        id: newId(),
        helper: "document-reader",
        dealId: w.held.dealId,
        entityKind: "deal",
        entityId: w.held.dealId,
        status: "ok",
        result: {},
        reasons: [],
        rulesVersion: "dubai-sales-2026-01",
        visibility: "compliance",
        createdAt: new Date(NOW),
      })
      .returning({ id: helperRuns.id });
    await db.insert(documentReads).values({
      id: newId(),
      documentId: doc!.id,
      profile: "sof_evidence",
      fields: { source: { value: `Sale of a flat, EID ${EID}`, confidence: 0.9 } },
      promptVersion: "p1",
      runId: run!.id,
      readAt: new Date(NOW),
    });
    // Cases in the other statuses on the plain deal, and an EDD sign-off.
    for (const status of ["info_requested", "reported", "cleared", "stopped"] as const) {
      const id = newId();
      if (status === "cleared") closedCase = id;
      if (status === "info_requested") modelCase = id;
      await db.insert(amlCases).values({
        id,
        dealId: w.plain.dealId,
        status,
        summary: status === "info_requested" ? `<script>alert(1)</script> call ${PHONE}` : `case ${status}`,
        summaryModel: status === "info_requested" ? "tev1" : null,
        instructionLike: false,
        openedAt: new Date(NOW + 1000),
        closedAt: status === "info_requested" ? null : new Date(NOW + 2000),
      });
      await db.insert(amlHits).values({
        id: newId(),
        caseId: id,
        partyId: w.plain.buyer,
        subjectKey: `party:${w.plain.buyer}`,
        rule: "cash",
        severity: "flag",
        detail: "cash",
        listVersion: "v1",
        createdAt: new Date(NOW),
      });
    }
    const risk = await recordRiskAssessment(
      w.ctx,
      {
        dealId: w.plain.dealId,
        partyId: w.plain.buyer,
        partyType: "person",
        paymentMethod: "transfer",
        hits: [
          { rule: "sanctions" },
          { rule: "pep" },
          { rule: "cash" },
          { rule: "high_risk_country" },
          { rule: "missing_source_of_funds" },
        ],
      },
      "system:aml-screening",
    );
    eddId = risk.eddApprovalId ?? "";
  });
  afterAll(async () => {
    await database?.close();
  });

  describe("GET /api/compliance/cases", () => {
    test("every role but the two compliance roles gets 403 and no data, admin and finance included", async () => {
      for (const role of ROLES) {
        for (const q of ["", "?status=open", "?status=bogus"]) {
          const r = await get(`/api/compliance/cases${q}`, role);
          expect(r.status).toBe(403);
          expect(r.text).not.toMatch(/items|Sanctions|sanctions|case /);
        }
      }
    });
    test("a request with no session is 401", async () => {
      expect((await app.request("/api/compliance/cases")).status).toBe(401);
    });
    test("the tabs map onto the case statuses and EDD, for both compliance roles", async () => {
      for (const role of COMPLIANCE) {
        const ids = async (s: string) =>
          (await get(`/api/compliance/cases?status=${s}`, role)).body.items.map((i: any) => i.id);
        expect(await ids("open")).toEqual([openCase.id]);
        const info = (await get("/api/compliance/cases?status=info_requested", role)).body.items;
        expect(info.map((i: any) => i.status)).toEqual(["info_requested"]);
        expect((await get("/api/compliance/cases?status=reported", role)).body.items.map((i: any) => i.status)).toEqual(
          ["reported"],
        );
        expect(
          (await get("/api/compliance/cases?status=closed", role)).body.items.map((i: any) => i.status).toSorted(),
        ).toEqual(["cleared", "stopped"]);
        const edd = (await get("/api/compliance/cases?status=edd", role)).body.items;
        expect(edd.map((i: any) => i.id)).toEqual([eddId]);
        expect(edd[0]).toMatchObject({ kind: "edd", status: "edd" });
      }
    });
    test("the default tab is the open cases; an unknown tab or cursor is 400", async () => {
      expect((await get("/api/compliance/cases", "compliance")).body.items.map((i: any) => i.id)).toEqual([
        openCase.id,
      ]);
      expect((await get("/api/compliance/cases?status=bogus", "compliance")).status).toBe(400);
      expect((await get("/api/compliance/cases?status=closed&cursor=zzz", "compliance")).status).toBe(400);
    });
    test("keyset paging walks the closed tab without a skip or a repeat", async () => {
      const first = (await get("/api/compliance/cases?status=closed&limit=1", "compliance")).body;
      expect(first.items).toHaveLength(1);
      expect(first.nextCursor).toBeTruthy();
      const second = (await get(`/api/compliance/cases?status=closed&limit=1&cursor=${first.nextCursor}`, "mlro")).body;
      expect(second.items).toHaveLength(1);
      expect(second.items[0].id).not.toBe(first.items[0].id);
      expect(second.nextCursor).toBeNull();
    });
    test("a row carries the deal ref, rules and a labelled summary, and no personal number", async () => {
      const r = await get("/api/compliance/cases?status=open", "compliance");
      const item = r.body.items[0];
      expect(item).toMatchObject({ kind: "case", dealRef: expect.any(String), rules: ["sanctions"] });
      expect(item.suggestion).toMatchObject({ label: "Suggestion" });
      const info = await get("/api/compliance/cases?status=info_requested", "compliance");
      expect(info.body.items[0].suggestion.text).not.toContain(PHONE);
      for (const s of [PASSPORT, EID, PHONE]) expect(r.text).not.toContain(s);
    });
  });

  describe("GET /api/compliance/cases/:id", () => {
    test("every other role gets 403 for a real case and for an unknown id", async () => {
      for (const role of ROLES) {
        for (const id of [openCase.id, newId(), "nope"]) {
          const r = await get(`/api/compliance/cases/${id}`, role);
          expect(r.status).toBe(403);
          expect(r.text).not.toMatch(/sanction|Buyer/i);
        }
      }
    });
    test("an unknown or malformed id is 404 for compliance roles", async () => {
      expect((await get(`/api/compliance/cases/${newId()}`, "compliance")).status).toBe(404);
      expect((await get("/api/compliance/cases/nope", "mlro")).status).toBe(404);
    });
    test("the case view holds screening, threshold, hits, evidence, risk, the decision card and the trail", async () => {
      const r = await get(`/api/compliance/cases/${openCase.id}`, "compliance");
      expect(r.status).toBe(200);
      const b = r.body;
      expect(b.case).toMatchObject({ id: openCase.id, status: "open", kind: "case" });
      const buyer = b.subjects.find((s: any) => s.partyId === w.held.buyer);
      expect(buyer.screening.checks).toContainEqual(
        expect.objectContaining({ rule: "sanctions", score: 0.97, threshold: 0.85, over: true, list: "v1" }),
      );
      expect(buyer.screening.checks).toContainEqual(expect.objectContaining({ rule: "pep", score: 0.2, over: false }));
      expect(buyer.screening.date).toBe("2026-11-19");
      expect(buyer.hits.map((h: any) => h.rule)).toEqual(["sanctions"]);
      expect(b.sourceOfFunds).toHaveLength(1);
      expect(b.sourceOfFunds[0]).toMatchObject({ profile: "sof_evidence", fileName: "sof.pdf" });
      expect(b.approval).toMatchObject({ id: w.held.aml, gate: "aml_flag", status: "pending" });
      expect(b.approval.mayDecide.ok).toBe(true);
      expect(b.trail.map((e: any) => e.type)).toContain("COMPLIANCE_REVIEW_RECORDED");
      expect(b.trail.map((e: any) => e.type)).toContain("AML_POLICY_PUBLISHED");
      expect(b.dealRef).toEqual(expect.any(String));
    });
    test("the trail keeps compliance-visibility events only", async () => {
      await database.db.insert(dealEvents).values({
        id: newId(),
        entityKind: "deal",
        entityId: w.held.dealId,
        type: "TASK_DONE",
        actor: "system",
        payload: {},
        at: new Date(NOW),
      });
      const b = (await get(`/api/compliance/cases/${openCase.id}`, "compliance")).body;
      expect(b.trail.map((e: any) => e.type)).not.toContain("TASK_DONE");
    });
    test("the model summary is labelled a suggestion, never a finding, and is masked", async () => {
      const r = await get(`/api/compliance/cases/${modelCase}`, "mlro");
      expect(r.body.suggestion).toMatchObject({ label: "Suggestion", fromModel: true, model: "tev1" });
      expect(r.body.suggestion.text).toContain("<script>");
      expect(r.body.suggestion.text).not.toContain(PHONE);
      expect(r.body.finding).toBeUndefined();
      expect(r.body.case.summary).toBeUndefined();
      // What the case found is the rule hits (code), listed apart from the suggestion.
      expect(r.body.subjects.flatMap((s: any) => s.hits).length).toBeGreaterThan(0);
    });
    test("no ID, passport or phone number anywhere in the case JSON", async () => {
      for (const id of [openCase.id, closedCase, eddId, modelCase]) {
        const r = await get(`/api/compliance/cases/${id}`, "compliance");
        expect(r.status).toBe(200);
        for (const s of [PASSPORT, EID, PHONE]) expect(r.text).not.toContain(s);
      }
    });
    test("an EDD item opens by its approval id: the party's risk level and points, and the sign-off card", async () => {
      const r = await get(`/api/compliance/cases/${eddId}`, "compliance");
      expect(r.status).toBe(200);
      expect(r.body.case).toMatchObject({ kind: "edd", status: "edd" });
      expect(r.body.approval).toMatchObject({ id: eddId, gate: "edd_signoff" });
      const s = r.body.subjects.find((x: any) => x.partyId === w.plain.buyer);
      expect(s.risk).toMatchObject({ level: "high", points: expect.any(Number) });
    });
    test("a closed case shows its decided card with no way to decide", async () => {
      const r = await get(`/api/compliance/cases/${closedCase}`, "compliance");
      expect(r.body.case.status).toBe("cleared");
      expect(r.body.approval).toBeNull();
    });
  });
});
