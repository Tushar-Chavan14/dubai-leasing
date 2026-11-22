import { describe, expect, test } from "bun:test";
import { canDecideSpaGate, mayDecide, parseDecisionFor, SpaGateId, spaGates, SpaRole } from "../src/index.ts";

const APPROVER: Record<SpaGateId, SpaRole> = {
  seller_verification: "sales_manager",
  price_out_of_range: "sales_manager",
  kyc_review: "sales_manager",
  aml_flag: "compliance_officer",
  aml_report: "mlro",
  template_approval: "legal",
  agreement_approval: "legal",
  noc_review: "sales_admin",
  settlement_approval: "finance",
  oqood_submission: "sales_admin",
  transfer_submission: "sales_admin",
  cancellation: "sales_manager",
  deposit_release: "sales_manager",
  edd_signoff: "compliance_officer",
  helper_review: "sales_officer",
  refund: "finance",
};

describe("SPA gates (architecture §5)", () => {
  test("each gate's approver matches the spec", () => {
    expect([...SpaGateId.options] as string[]).toEqual(Object.keys(APPROVER));
    for (const g of SpaGateId.options) expect(spaGates[g].approver).toBe(APPROVER[g]);
    expect(Object.isFrozen(spaGates)).toBe(true);
  });
  test("every role × gate decision", () => {
    for (const g of SpaGateId.options) {
      const allowed = SpaRole.options.filter((r) => canDecideSpaGate(g, r));
      expect(allowed).toEqual(g === "helper_review" ? ["sales_officer", "sales_manager"] : [APPROVER[g]]);
      expect(canDecideSpaGate(g, "admin")).toBe(false);
    }
  });
  test("nobody approves their own proposal; admin approves nothing", () => {
    expect(mayDecide({ gate: "agreement_approval", proposedBy: "user:u1" }, { id: "u1", role: "legal" })).toEqual({
      ok: false,
      reason: "you can't approve your own proposal",
    });
    expect(mayDecide({ gate: "agreement_approval", proposedBy: "copilot:u1" }, { id: "u1", role: "legal" }).ok).toBe(
      false,
    );
    expect(mayDecide({ gate: "agreement_approval", proposedBy: "user:u2" }, { id: "u1", role: "legal" }).ok).toBe(true);
    expect(mayDecide({ gate: "agreement_approval", proposedBy: "user:u2" }, { id: "u1", role: "finance" })).toEqual({
      ok: false,
      reason: "only legal decides agreement_approval",
    });
    expect(mayDecide({ gate: "refund", proposedBy: "system" }, { id: "a", role: "admin" })).toEqual({
      ok: false,
      reason: "admin approves nothing",
    });
  });
  test("aml_flag takes an outcome; other gates don't", () => {
    expect(() => parseDecisionFor("aml_flag", { decision: "aml", outcome: "stop" })).toThrow();
    expect(parseDecisionFor("aml_flag", { decision: "aml", outcome: "stop", note: "match on list" })).toMatchObject({
      outcome: "stop",
    });
    expect(parseDecisionFor("aml_flag", { decision: "aml", outcome: "clear" })).toMatchObject({ outcome: "clear" });
    expect(() => parseDecisionFor("agreement_approval", { decision: "aml", outcome: "clear" })).toThrow();
    expect(() => parseDecisionFor("aml_flag", { decision: "approve" })).toThrow();
    expect(() => parseDecisionFor("agreement_approval", { decision: "reject" })).toThrow();
    expect(parseDecisionFor("agreement_approval", { decision: "reject", note: "clause 4" })).toMatchObject({
      decision: "reject",
    });
  });
});
