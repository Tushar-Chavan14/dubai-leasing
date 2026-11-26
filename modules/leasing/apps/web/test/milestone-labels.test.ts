import { describe, expect, test } from "bun:test";
import { milestoneLabel, milestoneScope, timedParts } from "../lib/format";

const ID = "01a1e3c1-7d6b-703d-93b9-45d2c64fe6e6";
const REF = "01a1e3c1-7d8f-78ba-9d05-caf716573ecf";

describe("milestone labels", () => {
  test("timed reminders read as words, never ids", () => {
    expect(milestoneLabel(`timed:${ID}:sign_reminder:${REF}#1`)).toBe("Signing reminder, attempt 1");
    expect(milestoneLabel(`timed:${ID}:docs_chase#2@1`)).toBe("Documents reminder, attempt 2");
    expect(milestoneLabel(`timed:${ID}:new_kind#1`)).not.toContain(ID);
  });
  test("parts of a timed milestone", () => {
    expect(timedParts(`timed:${ID}:docs_chase#1@1`)).toEqual({ kind: "docs_chase", attempt: "1" });
    expect(timedParts("lease_end@2027-12-15")).toBeNull();
  });
  test("plain milestones are unchanged", () => {
    expect(milestoneLabel("lease_end@2027-12-15")).toBe("Lease ends");
    expect(milestoneScope("lease_end@2027-12-15")).toContain("term ending");
  });
  test("a timed milestone has no scope line", () => {
    expect(milestoneScope(`timed:${ID}:docs_chase#1@1`)).toBe("");
  });
});
