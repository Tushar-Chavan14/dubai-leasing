/* oxlint-disable no-explicit-any -- items are built loosely in these tests */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { SpaRole } from "@spa/core";
import { CopilotDock, DockBody, DockView, markUnverified, type DockLine } from "../components/copilot-dock";
import { startersFor } from "../lib/copilot-starters";
import { InboxList } from "../components/inbox";
import { copilotTarget } from "../lib/copilot-proxy";
import { inboxItem } from "./fixtures";

const ID = "0190a000-0000-7000-8000-000000000001";
const AML = /\baml\b|screening|sanction|\bpep\b|\bedd\b|\brisk\b/i;
const you = (text: string): DockLine => ({ who: "you", text });
const bot = (over: Partial<Extract<DockLine, { who: "copilot" }>> = {}): DockLine => ({
  who: "copilot",
  text: "D-1001 is at the signing step.",
  kind: "answer",
  verified: true,
  unverified: [],
  tools: [],
  scope: { offTopic: false, probability: 0.02 },
  proposals: [],
  drafts: [],
  ...over,
});
const view = (lines: DockLine[], role: SpaRole = "sales_officer") => render(<DockView lines={lines} role={role} />);

describe("C36: the copilot dock (S68)", () => {
  test("an empty dock has a labelled question box, a send button, starter chips and says what the agent can and cannot do", () => {
    const html = render(
      <DockBody
        lines={[]}
        role="sales_officer"
        draft=""
        setDraft={() => {}}
        busy={false}
        onSend={() => {}}
        starters={startersFor("sales_officer", "/")}
      />,
    );
    expect(html).toContain("cp-chat");
    expect(html).toContain("What would you like to know?");
    expect(html).toContain('for="copilot-text"');
    expect(html).toContain('placeholder="Ask the agent"');
    expect(html).toContain('aria-label="Send"');
    expect((html.match(/rounded-full border border-line bg-page/g) ?? []).length).toBeLessThanOrEqual(4);
    expect(html).toMatch(/reads, drafts and proposes/i);
    expect(html).toMatch(/never approves, sends, signs or changes anything/i);
    expect(html).not.toMatch(AML);
  });

  test("before the browser has measured the viewport the dock draws nothing (the frame decides)", () => {
    expect(render(<CopilotDock role="sales_officer" />)).toBe("");
  });

  test("your line is a right-hand bubble; the agent's answer is plain text with its handling and proposals", () => {
    const html = view([
      you("Find D-1001"),
      bot({
        proposals: [
          { id: ID, kind: "create_task", status: "proposed", expiresAt: "2026-11-21T10:30:00Z", summary: "x" },
        ],
      }),
    ]);
    expect(html).toContain("rounded-[16px_16px_4px_16px]");
    expect(html).toContain("How this was handled");
    expect(html).toContain('aria-label="Proposal"');
    expect(html).not.toMatch(/rounded-xl border border-line px-3 py-2/);
  });

  test("starters: at most four, compliance roles lead with open cases, deal pages ask about the deal", () => {
    expect(startersFor("compliance_officer", "/")[0]).toBe("Which cases are open?");
    expect(startersFor("compliance_officer", "/").length).toBeLessThanOrEqual(4);
    expect(startersFor("sales_officer", "/deals/abc")[0]).toBe("What is this deal waiting for?");
    expect(startersFor("sales_officer", "/listings")).toEqual(["Which listings are published?"]);
    expect(startersFor("sales_officer", "/")).toHaveLength(4);
  });

  test("messages show who spoke, in a log region", () => {
    const html = view([you("Find D-1001"), bot()]);
    expect(html).toContain('role="log"');
    expect(html).toContain("Find D-1001");
    expect(html).toContain("D-1001 is at the signing step.");
    expect(html.indexOf("Find D-1001")).toBeLessThan(html.indexOf("D-1001 is at the signing step."));
  });

  test("tool chips name what was looked at, and mark a refused call", () => {
    const html = view([
      bot({
        tools: [
          { name: "search_deals", ok: true },
          { name: "get_settlement", ok: false },
        ],
      }),
    ]);
    expect(html).toContain("Searched deals");
    expect(html).toContain("Read the settlement");
    expect(html).toMatch(/Read the settlement[^<]*<[^>]*>[^<]*refused|refused/);
  });

  test("'How this was handled' lists the scope check, the tools, the value check and what the copilot cannot do", () => {
    const html = view([bot({ tools: [{ name: "get_deal", ok: true }] })]);
    expect(html).toContain("<details");
    expect(html).toContain("How this was handled");
    expect(html).toMatch(/on topic/i);
    expect(html).toMatch(/1 tool call/);
    expect(html).toMatch(/every amount, date and rate was checked against a tool result/i);
    expect(html).toMatch(/nothing was sent, approved or changed/i);
  });

  test("an off-topic reply says it was answered by code, and a guarded one says the reply was replaced", () => {
    const off = view([
      bot({ kind: "scope_blocked", text: "I can help with deals.", scope: { offTopic: true, probability: 0.97 } }),
    ]);
    expect(off).toMatch(/off topic/i);
    expect(off).toMatch(/answered by code/i);
    const guarded = view([bot({ kind: "guarded", text: "Compliance review is open." })]);
    expect(guarded).toMatch(/replaced by a fixed line/i);
    expect(guarded).not.toMatch(AML);
  });

  test("an unverified value is marked in the text, and listed", () => {
    const html = view([bot({ text: "The fee is 7% of the price.", verified: false, unverified: ["7%"] })]);
    expect(html).toMatch(/<mark[^>]*>7%<\/mark>/);
    expect(html).toMatch(/not (?:from|confirmed by) a tool/i);
    expect(html).toContain("Unverified");
    expect(markUnverified("A 7% fee and 7% again", ["7%"])).toHaveLength(5);
    expect(markUnverified("Nothing to mark", [])).toEqual(["Nothing to mark"]);
  });

  test("a proposal card shows what will happen, when it expires, and Confirm and Cancel; nothing is done yet", () => {
    const html = view([
      bot({
        text: "Proposed: ask the parties for documents. Nothing has happened yet.",
        proposals: [
          {
            id: ID,
            kind: "request_documents",
            status: "proposed",
            expiresAt: "2026-11-21T10:30:00Z",
            summary: "ask the buyers and sellers of D-1001 for their documents",
          },
        ],
      }),
    ]);
    expect(html).toContain("ask the buyers and sellers of D-1001 for their documents");
    expect(html).toMatch(/>Confirm</);
    expect(html).toMatch(/>Cancel</);
    expect(html).toMatch(/nothing has happened until you confirm/i);
    expect(html).toMatch(/expires/i);
    expect(html).not.toMatch(/>(?:Approve|Send|Sign|Submit)</);
  });

  test("a confirmed or cancelled proposal shows its outcome and no buttons", () => {
    const base = { id: ID, kind: "create_task", expiresAt: "2026-11-21T10:30:00Z", summary: "open a task" };
    const done = view([bot({ proposals: [{ ...base, status: "confirmed" }] })]);
    expect(done).toMatch(/Confirmed/);
    expect(done).not.toMatch(/>Confirm</);
    const gone = view([bot({ proposals: [{ ...base, status: "cancelled" }] })]);
    expect(gone).toMatch(/Cancelled/);
    const exp = view([bot({ proposals: [{ ...base, status: "expired" }] })]);
    expect(exp).toMatch(/expired/i);
    expect(exp).not.toMatch(/>Confirm</);
  });

  test("an email or summary draft is a copy-only card: the text, a Copy button and 'nothing was sent'", () => {
    const html = view([
      bot({
        drafts: [
          {
            id: ID,
            kind: "email",
            dealId: ID,
            body: "To: buyer\nSubject: Your documents\n\nDear buyer, please send them.",
          },
        ],
      }),
    ]);
    expect(html).toContain("Dear buyer, please send them.");
    expect(html).toMatch(/>Copy</);
    expect(html).toMatch(/nothing was sent/i);
    expect(html).toMatch(/Email draft/);
    expect(html).not.toMatch(/mailto:|>Send</);
    const sum = view([bot({ drafts: [{ id: ID, kind: "summary", dealId: null, body: "D-1001 is at signing." }] })]);
    expect(sum).toMatch(/Summary draft/);
    expect(sum).toMatch(/>Copy</);
  });

  test("an approval note draft opens the approvals page with ?draft=<id>, per role", () => {
    const note = {
      id: ID,
      kind: "approval_note" as const,
      dealId: ID,
      body: "Returned: the unit number needs a check.",
    };
    const legal = view([bot({ drafts: [note] })], "legal");
    expect(legal).toContain(`href="/work?tab=inbox&amp;draft=${ID}"`);
    expect(legal).toMatch(/Open in the approvals/);
    const mlro = view([bot({ drafts: [note] })], "mlro");
    expect(mlro).toContain(`href="/compliance?draft=${ID}#inbox"`);
    expect(legal).toMatch(/nothing was decided or sent/i);
  });

  test("the dock holds no control that approves, sends, signs, submits or edits settings", () => {
    const html = view([
      bot({
        proposals: [
          { id: ID, kind: "request_documents", status: "proposed", expiresAt: "2026-11-21T10:30:00Z", summary: "x" },
        ],
        drafts: [{ id: ID, kind: "summary", dealId: null, body: "text" }],
      }),
    ]);
    for (const b of [...html.matchAll(/<button[^>]*>([^<]*)</g)].map((m) => m[1]!))
      expect(b).toMatch(/^(?:Confirm|Cancel|Copy|Send|Sending…)$/);
    expect(html).not.toMatch(/<a [^>]*href="[^"]*(?:decide|approve|send|sign|settings)/i);
  });
});

describe("C36: the same-origin way in", () => {
  test("only the copilot's own routes pass, with the right verb", () => {
    expect(copilotTarget("POST", "/copilot/chat")).toBe("/api/copilot/chat");
    expect(copilotTarget("GET", "/copilot/thread")).toBe("/api/copilot/thread");
    expect(copilotTarget("POST", `/copilot/proposals/${ID}/confirm`)).toBe(`/api/copilot/proposals/${ID}/confirm`);
    expect(copilotTarget("POST", `/copilot/proposals/${ID}/cancel`)).toBe(`/api/copilot/proposals/${ID}/cancel`);
    for (const [m, p] of [
      ["GET", "/copilot/chat"],
      ["POST", "/copilot/thread"],
      ["POST", "/copilot/proposals"],
      ["POST", "/copilot/drafts"],
      ["POST", `/copilot/proposals/${ID}/confirm/extra`],
      ["POST", "/copilot/proposals/not-a-uuid/confirm"],
      ["POST", "/copilot/../api/approvals/x/decide"],
      ["POST", `/copilot/proposals/${ID}/decide`],
      ["DELETE", `/copilot/proposals/${ID}/cancel`],
    ] as const)
      expect(copilotTarget(m, p)).toBeNull();
  });
});

describe("C36: the inbox note box takes a draft", () => {
  const noop = async () => {};
  test("?draft pre-fills the note of the item on the draft's deal, and only that one", () => {
    const a = inboxItem({ id: "a1", entity: { kind: "deal", id: ID }, mayDecide: { ok: true } });
    const b = inboxItem({
      id: "b1",
      entity: { kind: "deal", id: "0190a000-0000-7000-8000-000000000002" },
      mayDecide: { ok: true },
    });
    const html = render(
      <InboxList
        items={[a, b] as any}
        viewer="legal"
        decideAction={noop}
        from="work"
        draft={{ dealId: ID, body: "Returned: please check the unit number." }}
      />,
    );
    expect(html.match(/Returned: please check the unit number\./g)).toHaveLength(1);
    expect(html).toMatch(/Draft from the copilot/i);
    const plain = render(<InboxList items={[a] as any} viewer="legal" decideAction={noop} from="work" />);
    expect(plain).not.toMatch(/Draft from the copilot/i);
  });

  test("the draft text is escaped, never run as markup", () => {
    const a = inboxItem({ id: "a1", entity: { kind: "deal", id: ID }, mayDecide: { ok: true } });
    const html = render(
      <InboxList
        items={[a] as any}
        viewer="legal"
        decideAction={noop}
        from="work"
        draft={{ dealId: ID, body: "<img src=x onerror=alert(1)>" }}
      />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
