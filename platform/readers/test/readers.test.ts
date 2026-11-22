import { describe, expect, test } from "bun:test";
import { inferBlankType } from "../src/structure/blanks.ts";
import { fitsBlank } from "../src/structure/mapping.ts";
import type { TemplateProfile } from "../src/structure/profile.ts";

describe("inferBlankType: numbered instalments (S44)", () => {
  test("an instalment's amount or due date, not a count", () => {
    expect(inferBlankType("Instalment 3 amount", "", "")).toBe("money_fils");
    expect(inferBlankType("2nd instalment due date", "", "")).toBe("date");
    expect(inferBlankType("Second instalment date", "", "")).toBe("date");
    expect(inferBlankType("Number of instalments", "", "")).toBe("int");
  });
});

describe("keyFitsParty hook", () => {
  const sheet = {
    isKey: (k: string) => k === "a_name" || k === "b_name",
    keyNames: ["a_name", "b_name"],
    keyInfo: (k: string) => (k === "a_name" || k === "b_name" ? { type: "text" as const, label: k } : null),
    forPrompt: () => "",
  };
  const base = { sheet } as unknown as TemplateProfile;
  const withHook = { ...base, keyFitsParty: (k: string, p: string | null) => p === null || k.startsWith(p) };
  test("absent: any party fits", () => {
    expect(fitsBlank("a_name", "Name", { before: "", after: "", party: "b" }, base)).toBe(true);
  });
  test("present: a key of another party never fits", () => {
    expect(fitsBlank("a_name", "Name", { before: "", after: "", party: "b" }, withHook)).toBe(false);
    expect(fitsBlank("b_name", "Name", { before: "", after: "", party: "b" }, withHook)).toBe(true);
    expect(fitsBlank("a_name", "Name", { before: "", after: "", party: null }, withHook)).toBe(true);
  });
});
