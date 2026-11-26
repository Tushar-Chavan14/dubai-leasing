import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SpaRole } from "@spa/core";
import { dealEvents, deals, helperRuns, spaApprovals, type SpaDatabase } from "@spa/db";
import { freshSpaDatabase, spaTestDatabaseUrl } from "@spa/db/testing";
import { eq } from "drizzle-orm";
import { RECORD_SECTIONS, viewApproval, viewEvent, viewHelperRun } from "../src/manager/views.ts";
import { buildWorld, COMPLIANCE_WORDS, EID, PASSPORT, PHONE, type World } from "./reads-fixture.ts";

const url = spaTestDatabaseUrl();
const ROLES = SpaRole.options;
const isCompliance = (r: string) => r === "compliance_officer" || r === "mlro";
const viewer = (w: World, role: string) => {
  const u = Object.values(w.users).find((x) => x.role === role)!;
  return { id: u.id, role: u.role };
};

describe.skipIf(!url)("C29: role-filtered views (S57)", () => {
  let database: SpaDatabase;
  let w: World;
  beforeAll(async () => {
    database = await freshSpaDatabase(url!);
    w = await buildWorld(database);
  });
  afterAll(async () => {
    await database?.close();
  });

  const events = () => database.db.select().from(dealEvents).where(eq(dealEvents.entityId, w.held.dealId));

  test("events: a compliance review shows to every role as a neutral entry; AML detail and unknown types only to compliance", async () => {
    const rows = await events();
    for (const role of ROLES) {
      const seen = rows.map((r) => viewEvent(r, role)).filter((v) => v !== null);
      const types = seen.map((v) => v!.type);
      expect(types).toContain("COMPLIANCE_REVIEW_RECORDED");
      expect(types).toContain("DEAL_CREATED");
      expect(types.includes("AML_POLICY_PUBLISHED")).toBe(isCompliance(role));
      expect(types.includes("FUTURE_EVENT")).toBe(isCompliance(role));
      const review = seen.find((v) => v!.type === "COMPLIANCE_REVIEW_RECORDED")!;
      expect(review.label).toBe("Compliance review");
      if (!isCompliance(role)) {
        expect(review.toState).toBe("ON_HOLD");
        expect(review.payload).toEqual({});
        expect(review.actor).toEqual({ kind: "system", label: "System" });
        expect(JSON.stringify(seen)).not.toMatch(COMPLIANCE_WORDS);
      } else {
        expect(review.toState).toBe("AML_HOLD");
        expect(review.payload.approvalId).toBe(w.held.aml);
      }
    }
  });
  test("an approval event of a compliance gate loses its approval id for other roles", async () => {
    const rows = await events();
    const proposed = rows.filter((r) => r.type === "APPROVAL_PROPOSED");
    const mine = proposed.map((r) => viewEvent(r, "sales_officer")!);
    expect(mine.map((v) => v.label)).toContain("Approval requested: Compliance review");
    const neutral = mine.find((v) => v.payload.gate === "compliance_review")!;
    expect(neutral.payload.approvalId).toBeUndefined();
    const other = mine.find((v) => v.payload.gate === "kyc_review")!;
    expect(other.payload.approvalId).toBe(w.held.kyc);
  });

  test("approvals: a compliance gate is {id, gate, title, status} for every role but the two compliance roles", async () => {
    const [row] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, w.held.aml));
    for (const role of ROLES) {
      const v = viewApproval(row!, viewer(w, role)) as unknown as Record<string, unknown>;
      if (isCompliance(role)) {
        expect(v.gate).toBe("aml_flag");
        expect(v.proposal).toEqual({ rule: "sanctions", score: 0.97, outcomeHint: "stop_and_report" });
        expect(v.reasons).toEqual(["sanctions match on the buyer"]);
      } else {
        expect(v).toEqual({
          id: w.held.aml,
          gate: "compliance_review",
          title: "Compliance review",
          status: "open",
          entity: { kind: "deal", id: w.held.dealId },
        });
      }
    }
    // Decided: closed, and still nothing about the outcome.
    const decided = {
      ...row!,
      status: "rejected" as const,
      outcome: "stop",
      decisionNote: "sanctions",
      editedProposal: {},
    };
    expect(viewApproval(decided, viewer(w, "admin"))).toMatchObject({ status: "closed", gate: "compliance_review" });
    expect(JSON.stringify(viewApproval(decided, viewer(w, "sales_manager")))).not.toMatch(/stop|sanction|outcome/);
  });
  test("approvals: other gates pass title, reasons and note through the PII mask", async () => {
    const [row] = await database.db.select().from(spaApprovals).where(eq(spaApprovals.id, w.held.kyc));
    const v = viewApproval({ ...row!, decisionNote: `see ${EID}` }, viewer(w, "sales_manager")) as unknown as Record<
      string,
      unknown
    >;
    const text = JSON.stringify(v);
    for (const s of [PASSPORT, EID, PHONE]) expect(text).not.toContain(s);
    expect(v.title).toMatch(/^Passport \*+567 is unreadable$/);
    expect(v.gate).toBe("kyc_review");
    expect(v.mayDecide).toEqual({ ok: true });
    // The proposer sees why not.
    const own = viewApproval({ ...row!, proposedBy: `user:${w.users.manager!.id}` }, viewer(w, "sales_manager")) as {
      mayDecide: { ok: boolean; reason?: string };
    };
    expect(own.mayDecide.ok).toBe(false);
    // Admin approves nothing.
    expect((viewApproval(row!, viewer(w, "admin")) as { mayDecide: { ok: boolean } }).mayDecide.ok).toBe(false);
  });

  test("helper runs: a compliance run is hidden from every role but the two compliance roles", async () => {
    const runs = await database.db.select().from(helperRuns).where(eq(helperRuns.dealId, w.held.dealId));
    expect(runs).toHaveLength(2);
    for (const role of ROLES) {
      const seen = runs.map((r) => viewHelperRun(r, role)).filter((v) => v !== null);
      expect(seen.map((v) => v!.helper).toSorted()).toEqual(isCompliance(role) ? ["aml", "kyc"] : ["kyc"]);
    }
  });

  test("record sections: absent when they do not apply; the same keys, deal type by deal type", async () => {
    const keysFor = async (dealId: string) => {
      const [d] = await database.db.select().from(deals).where(eq(deals.id, dealId));
      return RECORD_SECTIONS.filter((s) => s.appliesTo(d!)).map((s) => s.key);
    };
    const resale = await keysFor(w.held.dealId);
    const primary = await keysFor(w.plain.dealId);
    for (const k of ["parties", "steps", "approvals", "tasks", "helper_runs", "compliance"]) {
      expect(resale).toContain(k);
      expect(primary).toContain(k);
    }
    expect(primary).toContain("payment_plan");
    expect(resale).not.toContain("payment_plan");
    expect(new Set(RECORD_SECTIONS.map((s) => s.key)).size).toBe(RECORD_SECTIONS.length);
  });
  test("record sections for each role: sales roles read 'Compliance review: open' and no AML word or ID number", async () => {
    const [d] = await database.db.select().from(deals).where(eq(deals.id, w.held.dealId));
    for (const role of ROLES) {
      const out: Record<string, unknown> = {};
      for (const s of RECORD_SECTIONS)
        if (s.appliesTo(d!) && (s.visibleTo?.(role) ?? true))
          out[s.key] = await s.load(database, d!, viewer(w, role), w.ctx);
      const text = JSON.stringify(out);
      for (const s of [PASSPORT, EID, PHONE]) expect(text).not.toContain(s);
      expect(out.compliance).toMatchObject({ label: "Compliance review", status: "open" });
      const approvals = out.approvals as { gate: string }[];
      expect(approvals.some((a) => a.gate === "kyc_review")).toBe(true);
      const tasks = out.tasks as { title: string }[];
      expect(tasks.some((t) => t.title === "Confirm the bank amount")).toBe(
        role === "sales_officer" || role === "sales_manager",
      );
      if (isCompliance(role)) {
        expect(approvals.some((a) => a.gate === "aml_flag")).toBe(true);
      } else {
        expect(text).not.toMatch(COMPLIANCE_WORDS);
        expect(tasks.some((t) => t.title === "Look at this payment")).toBe(false);
      }
    }
  });
  test("parties: a buyer in a review reads 'Compliance review: open', a clean party reads 'none'", async () => {
    const [d] = await database.db.select().from(deals).where(eq(deals.id, w.held.dealId));
    const sec = RECORD_SECTIONS.find((s) => s.key === "parties")!;
    const list = (await sec.load(database, d!, viewer(w, "sales_officer"), w.ctx)) as {
      partyId: string;
      role: string;
      name: string;
      kyc: { status: string } | null;
      compliance: { label: string; status: string };
    }[];
    const buyer = list.find((p) => p.partyId === w.held.buyer)!;
    const seller = list.find((p) => p.partyId === w.held.seller)!;
    expect(buyer.compliance).toEqual({ label: "Compliance review", status: "open" });
    expect(seller.compliance).toEqual({ label: "Compliance review", status: "none" });
    expect(buyer.kyc).toEqual({ status: "review" });
    expect(buyer.name).toBe("Buyer One");
    expect(JSON.stringify(list)).not.toMatch(/no hits/i);
  });
});
