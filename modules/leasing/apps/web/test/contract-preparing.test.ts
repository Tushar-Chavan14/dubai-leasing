import { describe, expect, test } from "bun:test";
import { elapsedLabel, isPreparingLive, preparingStatusLine } from "../lib/contract-preparing";

describe("elapsedLabel", () => {
  test("seconds, minutes and hours", () => {
    expect(elapsedLabel(0)).toBe("0s");
    expect(elapsedLabel(59_999)).toBe("59s");
    expect(elapsedLabel(134_000)).toBe("2m 14s");
    expect(elapsedLabel(3_600_000 + 5 * 60_000)).toBe("1h 5m");
  });
  test("never negative (clock skew)", () => {
    expect(elapsedLabel(-5000)).toBe("0s");
  });
});

describe("preparingStatusLine", () => {
  const since = "2026-11-14T10:00:00.000Z";
  test("each state", () => {
    expect(preparingStatusLine({ state: "queued", since, attempt: 1 })).toBe("Queued");
    expect(preparingStatusLine({ state: "running", since, attempt: 1 })).toBe("Reading records and the template");
    expect(preparingStatusLine({ state: "retrying", since, attempt: 2 })).toBe("Retrying (attempt 2)");
    expect(preparingStatusLine({ state: "failed", since, attempt: 1, reason: "no template" })).toBe(
      "Couldn't prepare: no template",
    );
    expect(preparingStatusLine({ state: "failed", since, attempt: 1 })).toBe("Couldn't prepare");
  });
  test("a running preparation shows the engine's step", () => {
    expect(
      preparingStatusLine({ state: "running", since, attempt: 1, step: "Reading the records and the template" }),
    ).toBe("Reading the records and the template");
  });
  test("only queued, running and retrying refresh live", () => {
    expect(isPreparingLive("queued")).toBe(true);
    expect(isPreparingLive("running")).toBe(true);
    expect(isPreparingLive("retrying")).toBe(true);
    expect(isPreparingLive("failed")).toBe(false);
  });
});
