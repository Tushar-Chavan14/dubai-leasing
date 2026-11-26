import { describe, expect, test } from "bun:test";
import {
  COMPLIANCE_EVENTS,
  COMPLIANCE_GATES,
  COMPLIANCE_ROLES,
  dealMachine,
  dealSteps,
  eventVisibleTo,
  isComplianceGate,
  isComplianceRole,
  listingMachine,
  neutralGate,
  SpaRole,
  STAFF_EVENTS,
  stageKey,
  stageLabel,
  taskVisibleTo,
  unitMachine,
} from "../src/index.ts";

describe("who sees compliance matters (S6, S42, S50, S57)", () => {
  test("only the two compliance roles; admin is not one", () => {
    expect([...COMPLIANCE_ROLES].toSorted()).toEqual(["compliance_officer", "mlro"]);
    for (const r of SpaRole.options) expect(isComplianceRole(r)).toBe(r === "compliance_officer" || r === "mlro");
    expect(isComplianceRole("admin")).toBe(false);
  });
  test("the compliance gates are edd_signoff, aml_flag and aml_report; their name is neutral outside", () => {
    expect([...COMPLIANCE_GATES].toSorted()).toEqual(["aml_flag", "aml_report", "edd_signoff"]);
    expect(isComplianceGate("aml_flag")).toBe(true);
    expect(isComplianceGate("kyc_review")).toBe(false);
    expect(neutralGate("edd_signoff")).toBe("compliance_review");
    expect(neutralGate("agreement_approval")).toBe("agreement_approval");
  });
  test("event allowlists are disjoint; a compliance review shows to everyone; unknown types fail closed", () => {
    for (const t of STAFF_EVENTS) expect(COMPLIANCE_EVENTS.has(t)).toBe(false);
    for (const r of SpaRole.options) expect(eventVisibleTo("COMPLIANCE_REVIEW_RECORDED", r)).toBe(true);
    for (const r of SpaRole.options) {
      expect(eventVisibleTo("AML_POLICY_PUBLISHED", r)).toBe(isComplianceRole(r));
      expect(eventVisibleTo("DEAL_CREATED", r)).toBe(true);
      // Not in either set: hidden from non-compliance roles, shown to compliance (who may look at anything).
      expect(eventVisibleTo("SOMETHING_NEW", r)).toBe(isComplianceRole(r));
    }
  });
  test("every machine event is classified (the AML ones are never written under their own name)", () => {
    const names = [...dealMachine.events, ...unitMachine.events, ...listingMachine.events] as string[];
    for (const e of names) expect(STAFF_EVENTS.has(e) || COMPLIANCE_EVENTS.has(e)).toBe(true);
    for (const e of ["AML_FLAGGED", "AML_CLEARED", "AML_STOPPED"]) expect(STAFF_EVENTS.has(e)).toBe(false);
  });
});

describe("tasks (S55, S57)", () => {
  test("a task shows to its own role and to a sales manager; a compliance role's task only to compliance roles", () => {
    for (const viewer of SpaRole.options) {
      expect(taskVisibleTo("sales_officer", viewer)).toBe(viewer === "sales_officer" || viewer === "sales_manager");
      expect(taskVisibleTo("compliance_officer", viewer)).toBe(isComplianceRole(viewer));
      expect(taskVisibleTo("mlro", viewer)).toBe(isComplianceRole(viewer));
    }
    expect(taskVisibleTo("finance", "finance")).toBe(true);
    expect(taskVisibleTo("finance", "admin")).toBe(false);
  });
});

describe("stages and steps (design §4.3, §6.2)", () => {
  test("a hold reads as On hold for everyone but compliance, with no AML word", () => {
    expect(stageKey("AML_HOLD", "sales_officer")).toBe("ON_HOLD");
    expect(stageKey("AML_HOLD", "admin")).toBe("ON_HOLD");
    expect(stageKey("AML_HOLD", "mlro")).toBe("AML_HOLD");
    expect(stageKey("SIGNING", "sales_officer")).toBe("SIGNING");
    expect(stageLabel("AML_HOLD")).toBe("On hold · review open");
    expect(stageLabel("ON_HOLD")).toBe("On hold · review open");
    expect(stageLabel("PARTY_CHECK")).toBe("Checking parties");
  });
  const base = { sellerMortgage: false, buyerMortgage: false, planTakenOver: false };
  test("a primary deal: no NOC, banks or settlement; Oqood registration; instalments", () => {
    const keys = dealSteps({ ...base, dealType: "primary_offplan", state: "SIGNING" }, []).map((s) => s.key);
    expect(keys).toEqual(["offer", "parties", "agreement", "legal", "signing", "registration", "instalments"]);
  });
  test("a ready resale: NOC, settlement and transfer; banks only with a mortgage", () => {
    const k = (m: Partial<typeof base>) =>
      dealSteps({ ...base, ...m, dealType: "resale_ready", state: "NOC" }, []).map((s) => s.key);
    expect(k({})).toEqual(["offer", "parties", "agreement", "legal", "signing", "noc", "settlement", "transfer"]);
    expect(k({ buyerMortgage: true })).toContain("finance");
    expect(k({ sellerMortgage: true })).toContain("finance");
  });
  test("an off-plan resale gets instalments only when the plan was taken over", () => {
    const k = (planTakenOver: boolean) =>
      dealSteps({ ...base, planTakenOver, dealType: "resale_offplan", state: "NOC" }, []).map((s) => s.key);
    expect(k(false)).not.toContain("instalments");
    expect(k(true)).toContain("instalments");
  });
  test("done, current and upcoming come from the state and the states the deal has been in", () => {
    const s = dealSteps({ ...base, dealType: "primary_offplan", state: "SIGNING" }, [
      "OFFER_AGREED",
      "PARTY_CHECK",
      "AGREEMENT_DRAFT",
      "LEGAL_REVIEW",
      "SIGNING",
    ]);
    expect(s.map((x) => x.status)).toEqual(["done", "done", "done", "done", "current", "upcoming", "upcoming"]);
    // A hold sits inside the parties step.
    const h = dealSteps({ ...base, dealType: "primary_offplan", state: "AML_HOLD" }, ["OFFER_AGREED", "PARTY_CHECK"]);
    expect(h.find((x) => x.status === "current")?.key).toBe("parties");
    // A finished deal has no current step; a cancelled one keeps what it reached.
    const done = dealSteps({ ...base, dealType: "resale_ready", state: "COMPLETED" }, ["TRANSFER"]);
    expect(done.every((x) => x.status === "done")).toBe(true);
    const cancelled = dealSteps({ ...base, dealType: "primary_offplan", state: "CANCELLED" }, [
      "OFFER_AGREED",
      "PARTY_CHECK",
    ]);
    expect(cancelled.map((step) => step.status)).toEqual([
      "done",
      "done",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });
  test("step labels never use an AML word", () => {
    const all = dealSteps(
      { ...base, dealType: "resale_offplan", planTakenOver: true, buyerMortgage: true, state: "NOC" },
      [],
    );
    expect(JSON.stringify(all)).not.toMatch(/aml|screen|sanction|pep|edd|risk/i);
  });
});
