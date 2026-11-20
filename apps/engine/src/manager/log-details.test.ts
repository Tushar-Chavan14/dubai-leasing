import { describe, expect, test } from "bun:test";
import { actorLabel, approvalDetails, emailDetails, eventDetails, milestoneLabel, taskDetails } from "./log-details.ts";

const ID = "01a1e3c1-7c27-735b-95a0-66fd19e13710";

describe("milestoneLabel", () => {
  test("names the step and attempt", () => {
    expect(milestoneLabel(`timed:${ID}:docs_chase#1@1`)).toBe("Docs chase, attempt 1");
  });
  test("skips ids after the step name", () => {
    expect(milestoneLabel(`timed:${ID}:sign_reminder:${ID}#2`)).toBe("Sign reminder, attempt 2");
  });
  test("no attempt", () => {
    expect(milestoneLabel(`timed:${ID}:docs_chase`)).toBe("Docs chase");
  });
  test("unknown shape is returned as is", () => {
    expect(milestoneLabel("123")).toBe("123");
  });
});

test("actorLabel", () => {
  expect(actorLabel("helper:offer")).toBe("Agent (offer)");
  expect(actorLabel("system")).toBe("System");
  expect(actorLabel("copilot:abc")).toBe("Agent (copilot)");
});

describe("eventDetails", () => {
  test("reads named payload fields only", () => {
    const d = eventDetails({
      type: "MILESTONE_FIRED",
      actor: "system",
      fromState: null,
      toState: null,
      rulesVersion: "dubai-2026.1",
      payload: { milestone: `timed:${ID}:docs_chase#1@1`, dueOn: "2026-11-18", emiratesId: "784-1990-1234567-1" },
    });
    expect(d.map((x) => x.label)).toEqual(["Event", "Done by", "Scheduled step", "Due on", "Rules version"]);
    expect(JSON.stringify(d)).not.toContain("784-1990");
  });
  test("stage change and a bad due date", () => {
    const d = eventDetails({
      type: "STATE",
      actor: "helper:offer",
      fromState: "SCREENING",
      toState: "OFFER",
      rulesVersion: null,
      payload: { dueOn: "soon", annualRentFils: 9_000_000 },
    });
    expect(d).toContainEqual({ label: "Stage", value: "Screening → Offer" });
    expect(d).toContainEqual({ label: "Annual rent", value: "9000000", format: "fils" });
    expect(d.some((x) => x.label === "Due on")).toBe(false);
  });
});

test("emailDetails never includes the recipient and shows the error", () => {
  const d = emailDetails({
    subject: "Reminder",
    template: "contract_sign_reminder",
    purpose: "reminder",
    status: "failed",
    error: "SMTP_HOST is not set",
    sentAt: null,
    acknowledgedAt: null,
    // extra columns of the row are ignored
    ...({ to: "tenant@example.com" } as object),
  } as Parameters<typeof emailDetails>[0]);
  expect(d).toContainEqual({ label: "Error", value: "SMTP_HOST is not set" });
  expect(JSON.stringify(d)).not.toContain("tenant@example.com");
});

test("approvalDetails joins reasons and dates the decision", () => {
  const d = approvalDetails({
    gate: "final_contract",
    title: "Final contract",
    status: "approved",
    approverRole: "leasing_manager",
    reasons: ["Rent above band.", "New tenant."],
    decidedAt: new Date("2026-11-19T09:00:00Z"),
    decisionNote: null,
    rulesVersion: null,
  });
  expect(d).toContainEqual({ label: "Why it needs a person", value: "Rent above band. New tenant." });
  expect(d).toContainEqual({ label: "Decided", value: "2026-11-19T09:00:00.000Z", format: "datetime" });
});

test("taskDetails", () => {
  const d = taskDetails({
    title: "Call",
    kind: "send_offer",
    status: "open",
    assigneeRole: "leasing_officer",
    dueOn: null,
  });
  expect(d.map((x) => x.label)).toEqual(["Task", "Kind", "Assigned to", "Status"]);
});
