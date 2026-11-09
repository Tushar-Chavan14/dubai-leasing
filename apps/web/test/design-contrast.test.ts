import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../lib/design/contrast";
import { TOKENS } from "../lib/design/tokens";

describe("contrastRatio", () => {
  test("black on white is 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  test("accent on white is below 1.5 (never a text colour on white)", () => {
    expect(contrastRatio("#dbe6cf", "#ffffff")).toBeLessThan(1.5);
  });
});

describe.each(["light", "dark"] as const)("%s palette", (mode) => {
  const p = TOKENS[mode];
  test("text pairs pass 4.5", () => {
    expect(contrastRatio(p.ink, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.ink, p.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
  });
  test("status text passes 4.5 on page", () => {
    expect(contrastRatio(p.danger, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.warning, p.page)).toBeGreaterThanOrEqual(4.5);
  });
});

test("brand colours", () => {
  expect(TOKENS.light.accent).toBe("#dbe6cf");
  expect(TOKENS.dark.primary).toBe("#dbe6cf");
});
