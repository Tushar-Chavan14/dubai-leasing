import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { ChangeMark, MarkAnchor } from "../src/index.ts";

const mark = {
  n: 1,
  page: 2,
  quote: "tenant pays maintenance",
  note: "Please change",
  anchor: { kind: "paragraph", key: "p4_5", label: "4.5 Maintenance" },
  rewrite: null,
  problems: [],
  decision: null,
  keepReason: null,
  officerNote: null,
};

describe("change marks", () => {
  test("ChangeMark parses a valid mark", () => {
    expect(ChangeMark.parse(mark).n).toBe(1);
  });
  test("ChangeMark rejects 21 marks via z.array(ChangeMark).max(20)", () => {
    const arr = z.array(ChangeMark).max(20);
    expect(arr.safeParse(Array.from({ length: 21 }, () => mark)).success).toBe(false);
  });
  test("MarkAnchor rejects an unknown kind", () => {
    expect(MarkAnchor.safeParse({ kind: "bogus" }).success).toBe(false);
  });
});
