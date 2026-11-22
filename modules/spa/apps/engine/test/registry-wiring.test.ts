import { describe, expect, test } from "bun:test";
import { HttpOqoodAdapter } from "@spa/helpers";
import { registryAdapterFor } from "../src/registry-adapter.ts";

describe("which registry adapter the engine registers (S53)", () => {
  test("the simulated registry only in demo mode, at REGISTRY_MOCK_URL", () => {
    const warnings: string[] = [];
    const a = registryAdapterFor({ SPA_DEMO_MODE: true, REGISTRY_MOCK_URL: "http://localhost:4101" }, (m) =>
      warnings.push(m),
    );
    expect(a).toBeInstanceOf(HttpOqoodAdapter);
    expect(warnings).toEqual([]);
  });
  test("outside demo mode nothing is registered, and a warning says registration will not run", () => {
    const warnings: string[] = [];
    expect(
      registryAdapterFor({ SPA_DEMO_MODE: false, REGISTRY_MOCK_URL: "http://localhost:4101" }, (m) => warnings.push(m)),
    ).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(/no registry/i);
  });
});
