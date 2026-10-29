import { describe, expect, test } from "bun:test";
import { customerPills, STAFF_PILLS } from "../components/chat-ui/quick-actions.ts";

describe("quick-action pills", () => {
  test("public chat: the five code-driven pills, in order, each a fixed button the engine handles", () => {
    const pills = customerPills(false);
    expect(pills.map((p) => p.label)).toEqual([
      "Find properties",
      "Book a viewing",
      "Apply now",
      "Check my applications",
      "Use a different email",
    ]);
    expect(pills.every((p) => p.action.kind === "press")).toBe(true);
    expect(pills.map((p) => (p.action.kind === "press" ? p.action.data : null))).toEqual([
      "units",
      "chat:book",
      "chat:apply",
      "status:start",
      "contact:change",
    ]);
    expect(new Set(pills.map((p) => p.key)).size).toBe(pills.length);
  });

  test("public chat: Arabic labels keep the same actions", () => {
    const en = customerPills(false).map((p) => p.action);
    const ar = customerPills(true);
    expect(ar.map((p) => p.action)).toEqual(en);
    expect(ar.every((p) => /[؀-ۿ]/.test(p.label))).toBe(true);
  });

  test("staff copilot: six pills that each send a prompt", () => {
    expect(STAFF_PILLS.map((p) => p.label)).toEqual([
      "Pipeline summary",
      "My tasks",
      "Enquiries",
      "Available units",
      "Pending approvals",
      "Contract status",
    ]);
    for (const p of STAFF_PILLS) {
      expect(p.action.kind).toBe("send");
      expect(p.action.kind === "send" && p.action.text.length > 10).toBe(true);
    }
  });

  test("no pill asks the model to approve, send or change anything", () => {
    const text = STAFF_PILLS.map((p) => (p.action.kind === "send" ? p.action.text : "")).join(" ");
    expect(text).not.toMatch(/\b(approve|send|submit|change|record)\b/i);
  });
});
