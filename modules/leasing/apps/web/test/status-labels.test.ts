import { describe, expect, test } from "bun:test";
import { inboundLabel, readingLabel } from "../lib/status-labels.ts";

describe("contract sample reading label", () => {
  test("waiting vs running", () => {
    expect(readingLabel({ phase: "waiting", minutes: 7 })).toBe("Waiting for the model (queued 7 min)\u2026");
    expect(readingLabel({ phase: "running", minutes: 3 })).toBe("Reading clauses (started 3 min ago)\u2026");
  });
  test("template already ready", () => {
    expect(readingLabel({ phase: "running", minutes: 9, templateReady: true })).toContain(
      "Template ready \u2014 clause reading still running",
    );
  });
});

describe("applicant reply label", () => {
  test("applied and held are unchanged", () => {
    expect(inboundLabel("applied")).toBe("Applied");
    expect(inboundLabel("stored_only")).toBe("Held");
  });
  test("a document check: checking while running, didn't finish when stuck or failed", () => {
    expect(inboundLabel("received", "running")).toBe("Checking");
    expect(inboundLabel("received", "stuck")).toBe("Didn\u2019t finish");
    expect(inboundLabel("stored_only", "failed")).toBe("Didn\u2019t finish");
    expect(inboundLabel("received")).toBe("Processing");
  });
});
