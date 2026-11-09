import { describe, expect, test } from "bun:test";
import { nextThreadFor, type DockThread } from "../lib/copilot/thread-context";

const A = { kind: "lease", id: "a" } as const;
const B = { kind: "lease", id: "b" } as const;
const t = (id: string | null, context: DockThread["context"]): DockThread => ({ id, context });

describe("nextThreadFor", () => {
  test("new always starts fresh about the page", () => {
    expect(nextThreadFor(t("x", A), B, "new")).toEqual({ action: "new", context: B });
    expect(nextThreadFor(t("x", A), undefined, "new")).toEqual({ action: "new", context: null });
    expect(nextThreadFor(t(null, null), A, "new")).toEqual({ action: "new", context: A });
  });
  test("navigate always keeps the thread", () => {
    expect(nextThreadFor(t("x", A), B, "navigate")).toEqual({ action: "keep", context: A });
    expect(nextThreadFor(t("x", A), undefined, "navigate")).toEqual({ action: "keep", context: A });
    expect(nextThreadFor(t("x", null), B, "navigate")).toEqual({ action: "keep", context: null });
  });
  test("ask without a page keeps the thread", () => {
    expect(nextThreadFor(t("x", A), undefined, "ask")).toEqual({ action: "keep", context: A });
    expect(nextThreadFor(t(null, null), undefined, "ask")).toEqual({ action: "keep", context: null });
  });
  test("ask on the same record keeps the thread", () => {
    expect(nextThreadFor(t("x", A), { ...A }, "ask")).toEqual({ action: "keep", context: A });
  });
  test("ask on another record starts a thread about it", () => {
    expect(nextThreadFor(t("x", A), B, "ask")).toEqual({ action: "new", context: B });
    expect(nextThreadFor(t("x", A), { kind: "unit", id: "a" }, "ask")).toEqual({
      action: "new",
      context: { kind: "unit", id: "a" },
    });
    expect(nextThreadFor(t("x", null), B, "ask")).toEqual({ action: "new", context: B });
  });
  test("ask in an unsent new chat about the same record keeps it", () => {
    expect(nextThreadFor(t(null, A), { ...A }, "ask")).toEqual({ action: "keep", context: A });
  });
});
