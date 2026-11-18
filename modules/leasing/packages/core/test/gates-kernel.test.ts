import { describe, expect, test } from "bun:test";
import { approvalGates, canDecideGate, defineMachine, GateId, StaffRole } from "../src/index.ts";

// P1 (S4): leasing's gates are built on the kernel's defineGates. Who may decide each gate is exactly what it was
// before the move (table recorded from the code before the change).
const BEFORE: Record<GateId, StaffRole[]> = {
  price_out_of_range: ["leasing_manager"],
  offer_out_of_limits: ["leasing_manager"],
  final_contract: ["leasing_officer", "leasing_manager"],
  ejari_submission: ["leasing_officer", "leasing_manager"],
  formal_reminder: ["leasing_manager"],
  renewal_notice: ["leasing_manager"],
  vacate_notice: ["leasing_manager"],
  refund: ["finance"],
  kyc_review: ["leasing_officer", "leasing_manager"],
  ejari_rejected_twice: ["leasing_officer", "leasing_manager"],
  safety_complaint: ["leasing_officer", "leasing_manager"],
};

describe("leasing gates on the kernel", () => {
  test("every gate × role decision is unchanged; admin decides none", () => {
    for (const g of GateId.options) {
      expect(StaffRole.options.filter((r) => canDecideGate(g, r))).toEqual(BEFORE[g]);
      expect(canDecideGate(g, "admin")).toBe(false);
    }
  });
  test("the table is frozen and keyed by id", () => {
    expect(Object.isFrozen(approvalGates)).toBe(true);
    for (const g of GateId.options) expect(approvalGates[g].id).toBe(g);
  });
  test("leasing machines still only take leasing entities and gates", () => {
    const m = defineMachine<"A" | "B", "GO", null>({
      entity: "lease",
      states: ["A", "B"],
      events: ["GO"],
      initial: "A",
      terminal: ["B"],
      transitions: [{ from: "A", event: "GO", to: "B", gate: "final_contract", description: "go" }],
    });
    expect(Object.isFrozen(m)).toBe(true);
    // @ts-expect-error: a gate leasing doesn't have
    const bad: Parameters<typeof defineMachine>[0]["transitions"][number]["gate"] = "agreement_approval";
    // @ts-expect-error: an entity leasing doesn't have
    const badEntity: Parameters<typeof defineMachine>[0]["entity"] = "deal";
    expect([bad, badEntity]).toHaveLength(2);
  });
});
