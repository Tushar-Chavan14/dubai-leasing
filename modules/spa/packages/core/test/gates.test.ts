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

describe("combined roles (M5c, S83)", () => {
  const karim = { id: "k", role: "sales_manager", roles: ["sales_manager", "compliance_officer", "mlro"] } as const;
  const omar = { id: "o", role: "legal", roles: ["legal", "finance"] } as const;
  const adam = { id: "a", role: "admin", roles: ["admin", "sales_admin"] } as const;
  const rania = { id: "r", role: "sales_officer", roles: ["sales_officer"] } as const;
  const by = "user:someone-else";
  const decides = (gate: SpaGateId, u: Parameters<typeof mayDecide>[1]) => mayDecide({ gate, proposedBy: by }, u).ok;

  test("a user decides a gate through any one of their roles", () => {
    expect(decides("aml_flag", karim)).toBe(true);
    expect(decides("aml_report", karim)).toBe(true);
    expect(decides("kyc_review", karim)).toBe(true);
    expect(decides("agreement_approval", omar)).toBe(true);
    expect(decides("settlement_approval", omar)).toBe(true);
    expect(decides("noc_review", adam)).toBe(true);
    expect(decides("oqood_submission", adam)).toBe(true);
    expect(decides("transfer_submission", adam)).toBe(true);
  });
  test("a gate keeps its one approver role: other roles still refuse", () => {
    expect(decides("settlement_approval", karim)).toBe(false);
    expect(decides("cancellation", omar)).toBe(false);
    expect(decides("kyc_review", adam)).toBe(false);
    expect(decides("agreement_approval", rania)).toBe(false);
  });
  test("admin alone approves nothing; with sales_admin only sales_admin gates", () => {
    const only = { id: "x", role: "admin" } as const;
    for (const g of SpaGateId.options) expect(decides(g, only)).toBe(false);
    expect(decides("settlement_approval", adam)).toBe(false);
  });
  test("maker-checker holds for combined roles", () => {
    expect(mayDecide({ gate: "settlement_approval", proposedBy: "user:o" }, omar)).toEqual({
      ok: false,
      reason: "you can't approve your own proposal",
    });
    expect(mayDecide({ gate: "cancellation", proposedBy: "copilot:k" }, karim).ok).toBe(false);
  });
  test("gates by the four demo users", () => {
    const expected: Record<string, SpaGateId[]> = {
      r: ["helper_review"],
      k: ["seller_verification", "price_out_of_range", "kyc_review", "aml_flag", "aml_report", "cancellation", "deposit_release", "edd_signoff", "helper_review"],
      o: ["template_approval", "agreement_approval", "settlement_approval", "refund"],
      a: ["noc_review", "oqood_submission", "transfer_submission"],
    };
    for (const u of [rania, karim, omar, adam])
      expect(SpaGateId.options.filter((g) => decides(g, u)).toSorted()).toEqual(expected[u.id]!.toSorted());
  });
});
