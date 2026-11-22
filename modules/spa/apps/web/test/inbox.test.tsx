/* oxlint-disable no-explicit-any -- items are built loosely in these tests */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { mayDecide, SpaGateId, SpaRole } from "@spa/core";
import { InboxList } from "../components/inbox";
import { InboxItem } from "../lib/contracts";
import { buildDecisionBody, decisionOptions } from "../lib/inbox";
import { COMPLIANCE_WORDS, inboxItem, PERSONAL } from "./fixtures";

const ME = "user-me";
const noop = async () => {};
const ROLES = SpaRole.options;
const COMPLIANCE_GATES = ["aml_flag", "aml_report", "edd_signoff"];
const parse = (o: unknown) => InboxItem.parse(o);

/** The engine's own answer for this viewer (the shared rule), so the page is tested against what the engine says. */
const asEngine = (gate: string, role: SpaRole, proposedBy = "system:helper") =>
  parse(
    inboxItem({
      gate,
      gateLabel: gate,
      title: COMPLIANCE_GATES.includes(gate) ? "Compliance review" : `A ${gate} request`,
      mayDecide: mayDecide({ gate: gate as never, proposedBy }, { id: ME, role }),
    }),
  );
const view = (items: ReturnType<typeof parse>[], viewer: SpaRole) =>
  render(<InboxList items={items} viewer={viewer} decideAction={noop} from="work" />);
const buttons = (html: string) => [...html.matchAll(/<button[^>]*>/g)].map((m) => m[0]);

describe("C31: decide buttons follow the engine, per gate and per role", () => {
  test("every gate and every role: a button only where the engine says the viewer may decide", () => {
    for (const gate of SpaGateId.options)
      for (const role of ROLES) {
        const item = asEngine(gate, role);
        const html = view([item], role);
        const decides = item.mayDecide?.ok === true;
        expect(buttons(html).length > 0).toBe(decides && role !== "admin");
      }
  });

  test("admin has no decide button even if a response said it could", () => {
    const html = view([parse(inboxItem({ mayDecide: { ok: true } }))], "admin");
    expect(buttons(html)).toEqual([]);
    expect(html).not.toContain("<form");
  });

  test("a proposer reads why there is no button, and the card has no form", () => {
    const item = parse(
      inboxItem({
        mayDecide: { ok: false, reason: "you can't approve your own proposal" },
        proposedBy: { kind: "user", label: "Me" },
      }),
    );
    const html = view([item], "sales_manager");
    expect(buttons(html)).toEqual([]);
    expect(html).toContain("You proposed this");
  });

  test("a wrong-role item (the engine says no) has no button", () => {
    const item = parse(inboxItem({ mayDecide: { ok: false, reason: "only legal decides agreement_approval" } }));
    expect(buttons(view([item], "sales_officer"))).toEqual([]);
  });

  test("the options per gate: approve and reject, with the gate's own words", () => {
    expect(decisionOptions("kyc_review")).toEqual([
      { decision: "approve", label: "Approve", tone: "primary" },
      { decision: "reject", label: "Reject", tone: "danger" },
    ]);
    expect(decisionOptions("agreement_approval")[0]!.label).toBe("Approve and send for signing");
    expect(decisionOptions("agreement_approval")[1]!.label).toBe("Return with comment");
    expect(decisionOptions("helper_review").map((o) => o.label)).toEqual(["Looks right", "Doesn't look right"]);
    expect(decisionOptions("aml_flag").map((o) => o.outcome)).toEqual([
      "clear",
      "more_info",
      "stop",
      "stop_and_report",
    ]);
    for (const g of ["aml_report", "edd_signoff"])
      expect(decisionOptions(g).map((o) => o.decision)).toEqual(["approve", "reject"]);
  });

  test("the form posts the decision only: names are decision, outcome, note, id and from", () => {
    const html = view([asEngine("aml_flag", "compliance_officer")], "compliance_officer");
    const names = new Set([...html.matchAll(/ name="([^"]+)"/g)].map((m) => m[1]));
    expect([...names].toSorted()).toEqual(["decision", "from", "id", "note", "outcome"]);
    expect(html).not.toMatch(/name="(role|actor|decidedBy|proposal)"/);
  });
});

describe("C31: compliance gates", () => {
  test("a compliance officer sees the outcomes and a note field; the MLRO sees approve and reject; neither sees the other's gate", () => {
    const flag = view([asEngine("aml_flag", "compliance_officer")], "compliance_officer");
    for (const t of ["Clear", "Ask for more information", "Stop the deal", "Stop and report"])
      expect(flag).toContain(t);
    expect(flag).toContain('value="stop_and_report"');
    expect(flag).toContain('name="outcome"');
    const rep = view([asEngine("aml_report", "mlro")], "mlro");
    expect(rep).toContain('value="approve"');
    expect(rep).toContain('value="reject"');
    expect(rep).not.toContain('name="outcome"');
    expect(buttons(view([asEngine("aml_report", "compliance_officer")], "compliance_officer"))).toEqual([]);
    expect(buttons(view([asEngine("aml_flag", "mlro")], "mlro"))).toEqual([]);
  });

  test("a sales role handed a compliance item (it should never arrive) gets the neutral card: no form, no detail", () => {
    for (const role of ["sales_officer", "sales_manager", "sales_admin", "legal", "finance", "admin"] as const) {
      const html = view(
        [
          parse(
            inboxItem({
              gate: "aml_flag",
              title: "sanctions match for Buyer One",
              reasons: ["sanctions match"],
              mayDecide: { ok: true },
            }),
          ),
        ],
        role,
      );
      expect(html).toContain("Compliance review");
      expect(html).not.toContain("<form");
      expect(buttons(html)).toEqual([]);
      expect(html).not.toMatch(COMPLIANCE_WORDS);
      expect(html).not.toContain("sanctions");
    }
    const neutral = parse({
      id: "x1",
      gate: "compliance_review",
      title: "Compliance review",
      status: "open",
      entity: { kind: "deal", id: "d" },
      entityRef: "D-1",
    });
    const html = view([neutral], "sales_manager");
    expect(html).toContain("Compliance review");
    expect(html).not.toContain("<form");
  });

  test("no compliance word in any non-compliance gate's card, for any role", () => {
    for (const gate of SpaGateId.options.filter((g) => !COMPLIANCE_GATES.includes(g)))
      for (const role of ROLES.filter((r) => r !== "compliance_officer" && r !== "mlro")) {
        const html = view([asEngine(gate, role)], role);
        expect(html).not.toMatch(COMPLIANCE_WORDS);
        expect(html).not.toMatch(/\bAML\b/);
      }
  });
});

describe("C31: the decision body is whitelisted", () => {
  const form = (o: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(o)) f.set(k, v);
    return f;
  };
  test("only decision, note and outcome are sent; a role, an actor or a decidedBy in the form is dropped", () => {
    const r = buildDecisionBody(
      form({ decision: "approve", note: " fine ", role: "admin", actor: "user:x", decidedBy: "x", proposal: "{}" }),
    );
    expect(r).toEqual({ ok: true, body: { decision: "approve", note: "fine" } });
  });
  test("reject needs a note; an outcome other than clear needs a note", () => {
    expect(buildDecisionBody(form({ decision: "reject" }))).toEqual({ ok: false, error: "note" });
    expect(buildDecisionBody(form({ decision: "aml", outcome: "stop" }))).toEqual({ ok: false, error: "note" });
    expect(buildDecisionBody(form({ decision: "aml", outcome: "clear" }))).toEqual({
      ok: true,
      body: { decision: "aml", outcome: "clear" },
    });
    expect(buildDecisionBody(form({ decision: "aml", outcome: "stop", note: "match confirmed" }))).toEqual({
      ok: true,
      body: { decision: "aml", outcome: "stop", note: "match confirmed" },
    });
  });
  test("an unknown decision or outcome is refused", () => {
    expect(buildDecisionBody(form({ decision: "edit" }))).toEqual({ ok: false, error: "decision" });
    expect(buildDecisionBody(form({ decision: "aml", outcome: "nope", note: "x" }))).toEqual({
      ok: false,
      error: "decision",
    });
    expect(buildDecisionBody(form({}))).toEqual({ ok: false, error: "decision" });
  });
});

describe("C31: cards carry what the engine returns", () => {
  test("a helper_review card shows the held result's reasons, masked, in place of the generic title", () => {
    const item = parse(
      inboxItem({
        gate: "helper_review",
        gateLabel: "Helper result in review mode",
        title: "Check the result: Company check",
        approverRole: "sales_officer",
        proposedBy: { kind: "system", label: "Company check" },
        heldResult: {
          helper: "spa_company_check",
          label: "Company check",
          status: "ok",
          reasons: ["Licence valid until 1 Mar 2027", "Signatory matches the licence"],
        },
      }),
    );
    const html = view([item], "sales_officer");
    expect(html).toContain("Held result");
    expect(html).toContain("Company check");
    expect(html).toContain("Licence valid until 1 Mar 2027");
    expect(html).toContain("Signatory matches the licence");
    expect(html).toContain("Looks right");
    expect(html).not.toMatch(PERSONAL);
  });

  test("a helper_review card with no held result says so and still decides", () => {
    const html = view([parse(inboxItem({ gate: "helper_review", approverRole: "sales_officer" }))], "sales_officer");
    expect(html).toContain("The held result is not available here");
    expect(html).toContain("Looks right");
  });

  test("an agreement_approval card shows the review's flags with their quotes, and its status when there are none", () => {
    const review = (over: Record<string, unknown>) => ({
      status: "ready",
      label: "Suggestions for legal",
      note: "Advice only.",
      flags: [
        {
          kind: "unknown_amount",
          quote: "AED 25,000",
          note: "This amount is not in the deal",
          in: "conditions",
          source: "code",
        },
      ],
      dropped: 0,
      instructionFound: false,
      model: null,
      reviewedAt: "2026-11-19T06:00:00.000Z",
      ...over,
    });
    const card = (r: unknown) =>
      parse(
        inboxItem({ gate: "agreement_approval", approverRole: "legal", mayDecide: { ok: true }, agreementReview: r }),
      );
    const html = view([card(review({}))], "legal");
    expect(html).toContain("Suggestions for legal");
    expect(html).toContain("AED 25,000");
    expect(html).toContain("Amount that is not this deal");
    expect(html).toContain("Approve and send for signing");
    const none = view([card(review({ status: "unavailable", label: "Review not available", flags: [] }))], "legal");
    expect(none).toContain("Review not available");
    expect(none).toContain("Approve and send for signing");
  });

  test("a decided card shows the outcome, who, when and the note, and no form", () => {
    const item = parse(
      inboxItem({
        status: "rejected",
        decidedBy: "Omar Manager",
        decidedAt: "2026-11-16T06:00:00.000Z",
        decisionNote: "Name differs",
        mayDecide: { ok: false, reason: "this approval is already rejected" },
      }),
    );
    const html = view([item], "sales_manager");
    expect(html).toContain("Rejected");
    expect(html).toContain("Omar Manager");
    expect(html).toContain("Name differs");
    expect(html).not.toContain("<form");
  });

  test("an empty inbox says so; no controls", () => {
    const html = view([], "sales_officer");
    expect(html).toContain("Nothing is waiting for you");
  });

  test("a failed decision is shown in words, never the engine's text", () => {
    const html = render(<InboxList items={[]} viewer="legal" decideAction={noop} from="work" error="note" />);
    expect(html).toContain("Say why");
    const generic = render(<InboxList items={[]} viewer="legal" decideAction={noop} from="work" error="refused" />);
    expect(generic).toContain("could not be recorded");
    expect(generic).not.toMatch(COMPLIANCE_WORDS);
  });
});
