import { describe, expect, test } from "bun:test";
import { askPrompts } from "../lib/ask-ai/prompts";

const all = {
  queueRow: askPrompts.queueRow("Sara Khan", "final contract"),
  homeEmpty: askPrompts.homeEmpty(),
  workList: askPrompts.workList("applications"),
  application: askPrompts.application("Sara Khan"),
  lease: askPrompts.lease("L-1042"),
  gate: askPrompts.gate("final contract", "Sara Khan"),
  logEntry: askPrompts.logEntry("KYC helper flagged the passport"),
  identity: askPrompts.identity("Sara Khan"),
  offer: askPrompts.offer("Sara Khan"),
  contractEjari: askPrompts.contractEjari("L-1042"),
  unitsList: askPrompts.unitsList(),
  unit: askPrompts.unit("B-204"),
  settingsHub: askPrompts.settingsHub(),
  settingsPage: askPrompts.settingsPage("Rent rules"),
  newApplication: askPrompts.newApplication(),
};

describe("askPrompts", () => {
  test("every builder returns items with label and prompt", () => {
    for (const items of Object.values(all)) {
      expect(items.length).toBeGreaterThan(0);
      for (const i of items) {
        expect(i.label.length).toBeGreaterThan(0);
        expect(i.prompt.length).toBeGreaterThan(0);
      }
    }
  });
  test("home empty prompt is exact", () => {
    expect(all.homeEmpty[0]!.prompt).toBe("What should I look at today?");
  });
  test("arguments appear in prompts", () => {
    expect(all.queueRow[0]!.prompt).toContain("Sara Khan");
    expect(all.application.some((i) => i.prompt.includes("Sara Khan"))).toBe(true);
    expect(all.lease[0]!.prompt).toContain("L-1042");
    expect(all.gate[0]!.prompt).toContain("final contract");
    expect(all.gate[0]!.prompt).toContain("Sara Khan");
    expect(all.logEntry[0]!.prompt).toContain("KYC helper flagged");
    expect(all.identity[0]!.prompt).toContain("Sara Khan");
    expect(all.offer[0]!.prompt).toContain("Sara Khan");
    expect(all.contractEjari[0]!.prompt).toContain("L-1042");
    expect(all.unit[0]!.prompt).toContain("B-204");
    expect(all.settingsPage.some((i) => i.prompt.includes("Rent rules"))).toBe(true);
  });
  test("no dashes in labels or prompts", () => {
    for (const items of Object.values(all)) for (const i of items) expect(`${i.label} ${i.prompt}`).not.toMatch(/[—–]/);
  });
  test("phone-like names are masked", () => {
    const out = [
      ...askPrompts.queueRow("+971501234567", "task"),
      ...askPrompts.application("+971501234567"),
      ...askPrompts.gate("final contract", "+971501234567"),
    ];
    for (const i of out) expect(i.prompt).not.toContain("971501234567");
  });
});

describe("application prompts name the application ref", () => {
  test("with a ref, every application prompt is about that application only", () => {
    const all = [
      ...askPrompts.application("Tushar", "A-BZVJ2V"),
      ...askPrompts.identity("Tushar", "A-BZVJ2V"),
      ...askPrompts.offer("Tushar", "A-BZVJ2V"),
    ];
    for (const p of all) expect(p.prompt).toContain("application A-BZVJ2V (Tushar)");
    expect(askPrompts.application("Tushar", "A-BZVJ2V")[1]!.prompt).toBe(
      "What is missing before the offer on application A-BZVJ2V (Tushar)?",
    );
  });
  test("without a ref, falls back to the name", () => {
    expect(askPrompts.application("Tushar", null)[0]!.prompt).toBe("Summarise Tushar's application");
  });
  test("queue rows name the record ref when given", () => {
    expect(askPrompts.queueRow("Tushar", "Viewing", "application A-BZVJ2V")[0]!.prompt).toContain(
      "application A-BZVJ2V",
    );
  });
});
