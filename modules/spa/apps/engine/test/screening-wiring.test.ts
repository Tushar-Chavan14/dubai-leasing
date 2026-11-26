import { describe, expect, test } from "bun:test";
import { FakeScreening } from "@spa/helpers";
import { screeningAdapterFor } from "../src/screening.ts";

describe("which screening adapter the engine registers (review 3)", () => {
  test("the fictional lists only in demo mode", () => {
    const warnings: string[] = [];
    const a = screeningAdapterFor({ SPA_DEMO_MODE: true }, (m) => warnings.push(m));
    expect(a).toBeInstanceOf(FakeScreening);
    expect(warnings).toEqual([]);
  });
  test("outside demo mode nothing is registered, and a warning says screening will fail closed", () => {
    const warnings: string[] = [];
    expect(screeningAdapterFor({ SPA_DEMO_MODE: false }, (m) => warnings.push(m))).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/not screened/i);
  });
});
