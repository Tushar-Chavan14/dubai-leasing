import { describe, expect, test } from "bun:test";
import {
  type Actor,
  allow,
  checkAnswers,
  defineGates,
  defineKycForm,
  defineMachine,
  deny,
  eventsFrom,
  findTransition,
  FixedClock,
  fils,
  helperActor,
  LOCKED_SEVERITY,
  maskPii,
  newId,
  PROTECTED_TRAIT,
  SafePattern,
  userActor,
  runHelper,
} from "../src/index.ts";
import { z } from "zod";

describe("defineGates", () => {
  type G = "approve_a" | "approve_b";
  type R = "officer" | "manager" | "admin";
  const set = defineGates<G, R>(
    {
      approve_a: { id: "approve_a", label: "A", when: "always", approver: "officer" },
      approve_b: { id: "approve_b", label: "B", when: "conditional", approver: "manager" },
    },
    { standIn: { officer: ["manager"] } },
  );
  test("the named approver and its stand-ins decide; nobody else, admin included", () => {
    expect(set.canDecide("approve_a", "officer")).toBe(true);
    expect(set.canDecide("approve_a", "manager")).toBe(true);
    expect(set.canDecide("approve_b", "manager")).toBe(true);
    expect(set.canDecide("approve_b", "officer")).toBe(false);
    expect(set.canDecide("approve_a", "admin")).toBe(false);
    expect(set.canDecide("approve_b", "admin")).toBe(false);
  });
  test("without stand-ins only the approver decides", () => {
    const strict = defineGates<G, R>({
      approve_a: { id: "approve_a", label: "A", when: "always", approver: "officer" },
      approve_b: { id: "approve_b", label: "B", when: "always", approver: "manager" },
    });
    expect(strict.canDecide("approve_a", "manager")).toBe(false);
  });
  test("the table is frozen and each id must equal its key", () => {
    expect(Object.isFrozen(set.gates)).toBe(true);
    expect(() =>
      defineGates<G, R>({
        approve_a: { id: "approve_b", label: "A", when: "always", approver: "officer" },
        approve_b: { id: "approve_b", label: "B", when: "always", approver: "officer" },
      }),
    ).toThrow("gate approve_a: id is approve_b");
  });
});

describe("defineMachine", () => {
  const m = defineMachine<"DRAFT" | "SIGNED", "SIGN", { ok: boolean }, "agreement_approval">({
    entity: "deal",
    states: ["DRAFT", "SIGNED"],
    events: ["SIGN"],
    initial: "DRAFT",
    terminal: ["SIGNED"],
    transitions: [
      {
        from: "DRAFT",
        event: "SIGN",
        to: "SIGNED",
        gate: "agreement_approval",
        guard: (c) => (c.ok ? allow : deny("not ok")),
        description: "sign",
      },
    ],
  });
  test("any entity name and gate type; helpers work on it", () => {
    expect(Object.isFrozen(m)).toBe(true);
    expect(findTransition(m, "DRAFT", "SIGN")?.gate).toBe("agreement_approval");
    expect(eventsFrom(m, "DRAFT")).toEqual(["SIGN"]);
    expect(findTransition(m, "DRAFT", "SIGN")?.guard?.({ ok: false })).toEqual({ ok: false, reasons: ["not ok"] });
  });
  test("unknown states, unknown events and duplicate pairs are refused", () => {
    const base = { entity: "deal", states: ["A", "B"] as const, events: ["GO"] as const, initial: "A" as const };
    expect(() =>
      defineMachine({
        ...base,
        terminal: [],
        transitions: [{ from: "A", event: "GO", to: "C" as "B", description: "" }],
      }),
    ).toThrow("unknown state");
    expect(() =>
      defineMachine({
        ...base,
        terminal: [],
        transitions: [{ from: "A", event: "X" as "GO", to: "B", description: "" }],
      }),
    ).toThrow("unknown event");
    expect(() =>
      defineMachine({
        ...base,
        terminal: [],
        transitions: [
          { from: "A", event: "GO", to: "B", description: "" },
          { from: "A", event: "GO", to: "A", description: "" },
        ],
      }),
    ).toThrow("duplicate");
  });
});

describe("Actor", () => {
  test("a module adds its own parties; the base kinds are shared", () => {
    const base: Actor[] = ["system", "system:auto-release", "import", "demo", userActor("u1"), helperActor("kyc")];
    const sales: Actor<`buyer:${string}`>[] = [...base, "buyer:p1", "copilot:u1"];
    expect(sales).toContain("buyer:p1");
    expect(userActor("u1")).toBe("user:u1");
    expect(helperActor("kyc")).toBe("helper:kyc");
  });
});

describe("defineKycForm", () => {
  // A fictional module's document kinds: shows the kinds are a parameter, not leasing's list.
  const form = defineKycForm(["title_deed", "passport"], {
    title_deed: { checks: ["readable", "right_document", "owner_matches"], hasExpiry: false, hasIssueDate: true },
    passport: {
      checks: ["expired", "valid_long_enough", "readable", "right_document"],
      hasExpiry: true,
      hasIssueDate: false,
    },
  });
  const field = (over: Record<string, unknown>) => ({
    key: "doc",
    label: "Document",
    type: "document",
    required: true,
    ...over,
  });
  test("document kinds are the module's plus custom and other, in order", () => {
    expect(form.FormDocumentKind.options).toEqual(["title_deed", "passport", "custom", "other"]);
    expect(form.FormField.safeParse(field({ documentKind: "emirates_id_front" })).success).toBe(false);
    expect(form.FormField.safeParse(field({ documentKind: "title_deed" })).success).toBe(true);
  });
  test("checks, expiry and issue date come from the kind's spec", () => {
    expect(form.checksFor("title_deed")).toEqual(["readable", "right_document", "owner_matches"]);
    expect(form.expiryFor("title_deed")).toBe(false);
    expect(form.issueFor("passport")).toBe(false);
    expect(form.checksFor("custom", { name: "NOC", description: "", hasExpiry: false })).not.toContain("expired");
  });
  test("locked severities hold in every module: expired never passes, a wrong or unreadable document is looked at", () => {
    expect(LOCKED_SEVERITY).toEqual({ expired: ["off", "warning"], right_document: ["off"], readable: ["off"] });
    expect(Object.isFrozen(LOCKED_SEVERITY)).toBe(true);
    const rules = (checks: Record<string, unknown>) => ({ validityDays: 30, minConfidence: 0.8, checks });
    expect(
      form.docRulesIssues("passport", rules({ expired: { severity: "warning", emailApplicant: false } }) as never),
    ).toEqual(["checks.expired: can't be warning"]);
    expect(
      form.docRulesIssues("title_deed", {
        minConfidence: 0.8,
        checks: { readable: { severity: "off", emailApplicant: false } },
      }),
    ).toEqual(["checks.readable: can't be off"]);
    expect(
      form.docRulesIssues("title_deed", {
        minConfidence: 0.8,
        checks: { mrz: { severity: "warning", emailApplicant: false } },
      }),
    ).toEqual(["checks.mrz: not a check for this document"]);
    expect(form.docRulesIssues("passport", rules({}) as never)).toEqual([]);
    expect(form.docRulesIssues("passport", { minConfidence: 0.8, checks: {} })).toEqual(["validityDays: required"]);
  });
  test("a document form needs unique keys, one name field and each ID document once", () => {
    const ok = form.DocumentForm.safeParse([field({ documentKind: "passport" })]);
    expect(ok.success).toBe(true);
    const twice = form.DocumentForm.safeParse([
      field({ key: "a", documentKind: "passport" }),
      field({ key: "b", documentKind: "passport" }),
    ]);
    expect(twice.error?.issues.map((i) => i.message)).toContain("each ID document can be on the form once");
  });
  test("protected traits and unsafe patterns are refused", () => {
    expect(PROTECTED_TRAIT.test("only Nationals of X")).toBe(true);
    expect(PROTECTED_TRAIT.test("licence starts with CN-")).toBe(false);
    expect(SafePattern.safeParse("^CN-\\d+$").success).toBe(true);
    expect(SafePattern.safeParse("(a+)+").success).toBe(false);
    expect(SafePattern.safeParse("(a)\\1").success).toBe(false);
  });
  test("typed answers are checked against the form", () => {
    const f = [
      { key: "email", label: "Email", type: "email" as const, required: true, appliesTo: "both" as const, options: [] },
      {
        key: "co",
        label: "Company",
        type: "text" as const,
        required: true,
        appliesTo: "company" as const,
        options: [],
      },
    ];
    expect(checkAnswers(f, "individual", { email: "x" })).toEqual(["email: enter an email address"]);
    expect(checkAnswers(f, "company", { email: "a@b.co" })).toEqual(["co: Company is required"]);
  });
});

describe("moved building blocks", () => {
  test("clock, money, ids and maskPii behave as before", () => {
    const c = new FixedClock(new Date("2026-11-17T21:30:00Z"));
    expect(c.today()).toBe("2026-11-18" as never);
    expect(() => fils(1.5)).toThrow();
    expect(newId()).toMatch(/^[0-9a-f-]{36}$/);
    const masked = maskPii("784-1990-1234567-1");
    expect(masked).toEndWith("67-1");
    expect(masked).not.toContain("1234567");
    expect(maskPii("call +971 50 123 4567")).not.toContain("123 4567");
  });
});

describe("helper runner", () => {
  test("runHelper is part of the kernel", async () => {
    const helper = {
      name: "one",
      run: async () => ({ status: "ok" as const, data: 1, reasons: [], sourceDocIds: [] }),
    };
    const input = {
      runId: "r",
      entity: { kind: "deal", id: "d" },
      step: "s",
      context: {},
      rulesVersion: "v",
      now: "2026-11-18T00:00:00Z",
    };
    const r = await runHelper(helper, input, { context: z.object({}), data: z.number() }, () => 0);
    expect(r.result.status).toBe("ok");
    expect(r.attempts).toBe(1);
  });
});

describe("portalKeyOk (S69)", () => {
  test("true only for the same configured key", async () => {
    const { portalKeyOk } = await import("../src/portal-key.ts");
    expect(portalKeyOk("k".repeat(32), "k".repeat(32))).toBe(true);
    expect(portalKeyOk("k".repeat(31), "k".repeat(32))).toBe(false);
    expect(portalKeyOk("x", "k".repeat(32))).toBe(false);
    expect(portalKeyOk(undefined, "k".repeat(32))).toBe(false);
    expect(portalKeyOk("", "")).toBe(false);
    expect(portalKeyOk("anything", undefined)).toBe(false);
  });
});
