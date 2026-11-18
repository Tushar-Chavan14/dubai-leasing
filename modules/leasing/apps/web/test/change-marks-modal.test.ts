import { describe, expect, test } from "bun:test";
import type { ChangeMark } from "@leasing/core";
import {
  canApprove,
  defaultDecisions,
  diffSides,
  legacyMarks,
  markStatus,
  needsManager,
  OWN_CHANGE_HINT,
  STATUS_PILL,
  termRows,
} from "../lib/change-marks";

const rw = { target: "paragraph", key: "s1:1", before: "a b", after: "a c", summary: "s", author: "ai" } as const;
const ok = { n: 1, rewrite: rw, problems: [] };
const bad = { n: 2, rewrite: null, problems: ["90 days is the rulebook notice"] };

describe("markStatus", () => {
  test("passed with a rewrite and no problems", () => {
    expect(markStatus(ok)).toBe("passed");
    expect(STATUS_PILL.passed).toBe("Checks passed");
  });
  test("broken with problems or no rewrite", () => {
    expect(markStatus(bad)).toBe("broken");
    expect(markStatus({ rewrite: rw, problems: ["x"] })).toBe("broken");
    expect(STATUS_PILL.broken).toBe("Breaks a rule");
  });
});

describe("canApprove", () => {
  test("every mark decided, apply marks pass", () => {
    expect(canApprove([ok, bad], { 1: "apply", 2: "keep" })).toBe(true);
  });
  test("an undecided mark blocks", () => {
    expect(canApprove([ok, bad], { 1: "apply" })).toBe(false);
  });
  test("apply on a broken mark blocks", () => {
    expect(canApprove([ok, bad], { 1: "apply", 2: "apply" })).toBe(false);
  });
  test("no marks blocks", () => {
    expect(canApprove([], {})).toBe(false);
  });
  test("defaultDecisions applies only passing marks", () => {
    expect(defaultDecisions([ok, bad])).toEqual({ 1: "apply" });
  });
});

test("diffSides splits the word diff", () => {
  const s = diffSides([
    { op: "same", text: "a " },
    { op: "del", text: "b" },
    { op: "add", text: "c" },
  ]);
  expect(s.now.map((p) => p.text).join("")).toBe("a b");
  expect(s.ai.map((p) => p.text).join("")).toBe("a c");
});

describe("legacyMarks", () => {
  const analysis = {
    summary: "Softened",
    blocked: null,
    proposal: { clauses: [], freeText: "new" },
    diff: [
      { op: "del", text: "old" },
      { op: "add", text: "new" },
    ] as const,
  };
  test("one mark from the D67 draft", () => {
    const [m, ...rest] = legacyMarks(
      { text: "please", target: "free_text", analysis: { ...analysis, diff: [...analysis.diff] } },
      "Additional terms",
    ) as ChangeMark[];
    expect(rest).toHaveLength(0);
    expect(m!.quote).toBe("");
    expect(m!.anchor).toEqual({ kind: "fixed", label: "Additional terms" });
    expect(m!.rewrite?.after).toBe("new");
    expect(m!.rewrite?.before).toBe("old");
    expect(markStatus(m!)).toBe("passed");
  });
  test("no draft is a broken mark", () => {
    const [m] = legacyMarks({ text: "q", target: "other", analysis: null }, "Something else");
    expect(markStatus(m!)).toBe("broken");
    expect(m!.problems.length).toBe(1);
  });
});

describe("term changes (D72)", () => {
  const terms = (problems: string[] = []) =>
    ({
      target: "terms",
      key: "terms",
      before: "",
      after: "",
      summary: "s",
      author: "officer",
      terms: {
        change: { annualRentFils: 4_800_000 },
        from: { annualRentFils: 5_000_000, depositFils: 250_000, moveInOn: "2026-12-01" },
        to: { annualRentFils: 4_800_000, depositFils: 240_000, cheques: 6, moveInOn: "2026-12-15" },
        problems,
      },
    }) as const;

  test("rows show only what changes, money as AED", () => {
    expect(termRows(terms())).toEqual([
      { label: "Rent", from: "AED 50,000.00", to: "AED 48,000.00" },
      { label: "Deposit", from: "AED 2,500.00", to: "AED 2,400.00" },
      { label: "Cheques", from: "—", to: "6" },
      { label: "Move-in", from: "2026-12-01", to: "2026-12-15" },
    ]);
  });

  test("no rows for a wording change or no rewrite", () => {
    expect(termRows({})).toEqual([]);
    expect(termRows(null)).toEqual([]);
  });

  test("needs a manager when the plan has problems", () => {
    expect(needsManager(terms())).toBe(false);
    expect(needsManager(terms(["Rent AED 48,000 is below the lowest allowed AED 50,000."]))).toBe(true);
    expect(needsManager(null)).toBe(false);
  });

  test("a terms mark with a passing plan is approvable", () => {
    expect(canApprove([{ n: 1, rewrite: terms(["x"]), problems: [] }], { 1: "apply" })).toBe(true);
  });

  test("the hint says amounts and dates update the lease and the law's periods can't change", () => {
    expect(OWN_CHANGE_HINT).toContain("Amounts and dates update the lease");
    expect(OWN_CHANGE_HINT).toContain("notice periods can't be changed");
  });
});
