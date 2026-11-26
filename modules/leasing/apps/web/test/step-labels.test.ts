import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { stepLabel } from "../lib/copilot/step-labels";

const dir = join(import.meta.dir, "../../../packages/copilot/src/tools");
const names = readdirSync(dir)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts" && f !== "shared.ts")
  .flatMap((f) => [...readFileSync(join(dir, f), "utf8").matchAll(/\bname:\s*"([a-z_]+)"/g)].map((m) => m[1]!));

describe("stepLabel", () => {
  test("finds the tool names", () => {
    expect(names.length).toBeGreaterThan(30);
  });
  test("every tool has its own label", () => {
    for (const n of names) expect([n, stepLabel(n, {}).label]).not.toEqual([n, "Working on it"]);
  });
  test("unknown tool falls back", () => {
    expect(stepLabel("future_tool", {})).toEqual({ label: "Working on it", source: null });
  });
  test("no dashes in labels", () => {
    for (const n of names) {
      const { label, source } = stepLabel(n, {});
      expect(label).not.toMatch(/[—–]/);
      expect(source ?? "").not.toMatch(/[—–]/);
    }
  });
  test("args are never echoed", () => {
    for (const n of [...names, "future_tool"]) {
      const { label } = stepLabel(n, { emiratesId: "784-1990-1234567-1", lease: "L-1" });
      expect(label).not.toContain("784");
      expect(label).not.toContain("L-1");
    }
  });
  test("rulebook, SRI and Ejari sources", () => {
    expect(stepLabel("explain_rule", {}).source).toBe("rulebook");
    expect(stepLabel("compute_renewal_cap", {}).source).toBe("rulebook");
    expect(stepLabel("save_sri_value", {}).source).toBe("Smart Rental Index");
    expect(stepLabel("contract_status", {}).source).toBe("Ejari (simulated)");
  });
});
