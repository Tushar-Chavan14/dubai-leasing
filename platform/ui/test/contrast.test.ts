import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../src/contrast";
import { TOKENS } from "../src/tokens";

describe("contrastRatio", () => {
  test("black on white is 21", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 1);
  });
  test("accent on white is below 1.5 (never a text colour on white)", () => {
    expect(contrastRatio("#e8eefd", "#ffffff")).toBeLessThan(1.5);
  });
});

describe.each(["light", "dark"] as const)("%s palette", (mode) => {
  const p = TOKENS[mode];
  test("text pairs pass 4.5", () => {
    expect(contrastRatio(p.ink, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.ink, p.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.ink, p.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.canvas)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.raised)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.muted, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.onAccent, p.accent)).toBeGreaterThanOrEqual(4.5);
  });
  test("CTA text passes and the CTA stands out", () => {
    expect(contrastRatio(p.onCta, p.cta)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.cta, p.page)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(p.cta, p.canvas)).toBeGreaterThanOrEqual(3);
  });
  test("status text passes 4.5 on page", () => {
    expect(contrastRatio(p.danger, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.warning, p.page)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(p.success, p.page)).toBeGreaterThanOrEqual(4.5);
  });
  test("rail labels and the active tile pass", () => {
    expect(contrastRatio(p.railInk, p.rail)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio("#ffffff", p.railActive)).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(p.onPrimary, p.primary)).toBeGreaterThanOrEqual(4.5);
  });
});

test("brand colours", () => {
  expect(TOKENS.light.primary).toBe("#2f62e3");
  expect(TOKENS.light.rail).toBe("#0f1c4d");
});
