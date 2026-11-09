import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { askAiEvent, COPILOT_ASK_EVENT, COPILOT_PREFILL_EVENT } from "../lib/copilot/events";

describe("Ask AI only prefills", () => {
  test("the event is the prefill event, never the auto-send one", () => {
    const e = askAiEvent("How many leases are due?");
    expect(e.type).toBe(COPILOT_PREFILL_EVENT);
    expect(e.type).not.toBe(COPILOT_ASK_EVENT);
    expect(e.detail).toEqual({ text: "How many leases are due?" });
  });

  test("a record is passed along when given", () => {
    const page = { kind: "lease", id: "0190e0a0-0000-7000-8000-000000000000" } as const;
    expect(askAiEvent("About this lease", page).detail).toEqual({ text: "About this lease", page });
  });

  test("ask-ai.tsx never refers to the auto-send event", () => {
    const src = readFileSync(join(import.meta.dir, "../components/ask-ai.tsx"), "utf8");
    expect(src).not.toContain("COPILOT_ASK_EVENT");
    expect(src).not.toContain("copilot:ask");
    expect(src).toContain("askAiEvent(");
  });
});
