import { describe, expect, test } from "bun:test";
import { noToggles } from "./no-toggles.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { DealRecord } from "../components/deal-record";
import { DealTable } from "../components/deal-table";
import { HomeView } from "../components/home-view";
import { TaskList } from "../components/task-list";
import { WorkFilters } from "../components/work-filters";
import { readSections } from "../lib/contracts";
import { parseWorkSearch } from "../lib/work";
import { COMPLIANCE_WORDS, dealRow, event, header, partyView, SINCE, stepsOf, task } from "./fixtures";

const noop = async () => {};
const approval = (over = {}) => ({
  id: "a1",
  gate: "agreement_approval",
  gateLabel: "Agreement approval",
  title: "Approve the agreement",
  status: "pending",
  approverRole: "legal",
  proposedBy: { kind: "system", label: "System" },
  createdAt: SINCE,
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
  reasons: [],
  mayDecide: { ok: false, reason: "no" },
  proposal: { secret: "do not show" },
  ...over,
});

function record(
  type: "primary_offplan" | "resale_ready" | "resale_offplan",
  state: "SIGNING" | "NOC" | "OFFER_AGREED",
  extra: Record<string, unknown> = {},
  flags = {},
) {
  const h = header(type, state, { stage: state, stageLabel: state, ...flags });
  const sections: Record<string, unknown> = {
    parties: [
      partyView(),
      partyView({ partyId: "p2", role: "seller", name: "Sample Owner One", kind: "person", shareBps: 5000 }),
    ],
    steps: stepsOf(type, state, flags),
    compliance: { label: "Compliance review", status: "none" },
    approvals: [approval()],
    tasks: [task()],
    helper_runs: [],
    ...(type === "primary_offplan" || h.planTakenOver
      ? {
          payment_plan: [
            { seq: 1, label: "Booking", dueOn: "2026-12-01", milestone: null, amountFils: 15_000_000 },
            { seq: 2, label: "On handover", dueOn: null, milestone: "Handover", amountFils: 135_000_000 },
          ],
        }
      : {}),
    ...extra,
  };
  return { deal: h, waitingFor: h.waitingFor, sections };
}
const show = (r: ReturnType<typeof record>, viewer = "sales_officer" as const, events = [event()]) =>
  render(
    <DealRecord
      record={{ deal: r.deal, waitingFor: r.waitingFor, sections: readSections(r.sections) }}
      events={events}
      nextEvents={null}
      viewer={viewer}
    />,
  );

describe("DealRecord: each deal type shows its own steps and sections", () => {
  test("a primary deal: Oqood and payments, no NOC", () => {
    const html = show(record("primary_offplan", "SIGNING"));
    expect(html).toContain("Oqood registration");
    expect(html).toContain("Payment plan");
    expect(html).toContain("Booking");
    expect(html).toContain("AED 150,000");
    expect(html).toContain("AED 1,350,000");
    expect(html).not.toContain("Developer NOC");
    expect(html).not.toContain("Settlement");
  });
  test("a ready resale: NOC, settlement and transfer; no Oqood, no payments", () => {
    const html = show(record("resale_ready", "NOC"));
    expect(html).toContain("Developer NOC");
    expect(html).toContain("Settlement statement");
    expect(html).not.toContain("Oqood");
    expect(html).not.toContain("Payment plan");
  });
  test("an off-plan resale with a taken-over plan also shows payments", () => {
    const html = show(record("resale_offplan", "NOC"));
    expect(html).toContain("Payment plan");
    expect(html).toContain("Developer NOC");
    expect(html).not.toContain("Oqood");
  });
  test("sections the engine did not send are absent, never empty", () => {
    const r = record("resale_ready", "NOC");
    const html = show({ ...r, sections: { parties: r.sections.parties, steps: r.sections.steps } });
    expect(html).toContain("Parties");
    expect(html).not.toContain("Approvals");
    expect(html).not.toContain("Tasks");
    expect(html).not.toContain("Payment plan");
  });
  test("header: ref, property, type, parties, price and state; in default is a danger pill", () => {
    const r = record("resale_ready", "NOC");
    const html = show({
      ...r,
      deal: { ...r.deal, inDefault: true, inDefaultReason: "overdue", inDefaultSince: "2026-11-10" },
    });
    expect(html).toContain("D-0001 · U-101");
    expect(html).toContain("Ready resale");
    expect(html).toContain("Sample Owner One");
    expect(html).toContain("Sample Buyer One");
    expect(html).toContain("In default");
    expect(html).toContain("text-danger");
    expect(html).toContain("Work");
  });
  test("an unconfirmed plan amount is flagged 'Read, not confirmed'", () => {
    const r = record("primary_offplan", "SIGNING");
    const html = show({
      ...r,
      sections: {
        ...r.sections,
        payment_plan: [
          { seq: 1, label: "Booking", dueOn: "2026-12-01", milestone: null, amountFils: 15_000_000, confirmed: false },
        ],
      },
    });
    expect(html).toContain("Read, not confirmed");
  });
});

describe("DealRecord: read only, role-safe, masked", () => {
  test("no form, button or input anywhere on a record, even with a pending gate", () => {
    const html = show(record("primary_offplan", "SIGNING"));
    expect(noToggles(html)).not.toMatch(/<(form|button|input|select|textarea)\b/);
    expect(html).not.toMatch(/Approve and|Decide|Reject/);
    expect(html).toContain("Waiting for");
    expect(html).toContain("Legal");
  });
  test("a pending gate shows only the approver role, never its proposal", () => {
    const html = show(record("primary_offplan", "SIGNING"));
    expect(html).toContain("Agreement approval");
    expect(html).toContain("Waiting for Legal");
    expect(html).not.toContain("do not show");
  });
  test("a sales officer's page for a deal with an open compliance review reads 'Compliance review' and no compliance word", () => {
    const r = record("resale_ready", "NOC", {
      compliance: { label: "Compliance review", status: "open" },
      approvals: [
        {
          id: "n1",
          gate: "compliance_review",
          title: "Compliance review",
          status: "open",
          entity: { kind: "deal", id: "x" },
        },
      ],
      parties: [partyView({ compliance: { label: "Compliance review", status: "open" }, kyc: { status: "review" } })],
    });
    const html = show({
      ...r,
      deal: {
        ...r.deal,
        stage: "ON_HOLD",
        stageLabel: "On hold · review open",
        onHold: true,
        waitingFor: { role: null, label: "Compliance review", since: SINCE, waitedDays: 3 },
      },
      waitingFor: { role: null, label: "Compliance review", since: SINCE, waitedDays: 3 },
    });
    expect(html).toContain("Compliance review");
    expect(html).toContain("On hold · review open");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
  test("a response that carries compliance-only fields renders none of them", () => {
    const r = record("resale_ready", "NOC", {
      approvals: [
        approval({
          gate: "aml_flag",
          gateLabel: "AML flag",
          title: "Sanctions match",
          proposal: { rule: "sanctions" },
          reasons: ["sanctions match on the buyer"],
        }),
      ],
    });
    // The engine never sends this to a sales role; if it did, the page still shows only a title and the approver role.
    const html = show(r);
    expect(html).not.toContain("sanctions match on the buyer");
    expect(html).not.toContain('"rule"');
  });
  test("masked values stay masked and no personal number is added", () => {
    const html = show(
      record("primary_offplan", "SIGNING", { approvals: [approval({ title: "Passport ****567 is unreadable" })] }),
    );
    expect(html).toContain("Passport ****567 is unreadable");
    expect(html).not.toMatch(/N1234567|784-1990/);
  });
  test("tasks on the record are listed read only", () => {
    const html = show(record("primary_offplan", "SIGNING"));
    expect(html).toContain("Confirm the bank amount");
    expect(html).not.toContain("<form");
  });
});

describe("DealTable (the Work list)", () => {
  const rows = [
    dealRow(),
    dealRow({
      id: "0198a1b2-0000-7000-8000-000000000002",
      ref: "D-0002",
      type: "resale_ready",
      typeLabel: "Ready resale",
      stage: "ON_HOLD",
      stageLabel: "On hold · review open",
      onHold: true,
      inDefault: true,
      property: { kind: "listing", label: "2-bed apartment, [BUILDING]" },
      sellers: ["Sample Owner One", "Sample Owner Two"],
      buyers: ["Sample Buyer Two"],
      waitingFor: { role: null, label: "Compliance review", since: SINCE, waitedDays: 2 },
      ageDays: 1,
    }),
  ];
  test("ref links the record; property, parties, type, stage, waiting for, owner and age", () => {
    const html = render(<DealTable deals={rows} next={null} viewer="sales_officer" />);
    expect(html).toContain('href="/work/deals/0198a1b2-0000-7000-8000-000000000001"');
    expect(html).toContain("D-0001");
    expect(html).toContain("U-101");
    expect(html).toContain("Fictional Developments LLC → Sample Buyer One");
    expect(html).toContain("Sample Owner One, Sample Owner Two → Sample Buyer Two");
    expect(html).toContain("Primary off-plan");
    expect(html).toContain("Signing");
    expect(html).toContain("Rania Officer");
    expect(html).toContain("18 days");
    expect(html).toContain("AED 1,500,000");
    expect(html).toContain("<th");
    expect(html).toContain('scope="col"');
  });
  test("stage chips use the role's words, in default is flagged, a hold is a warning", () => {
    const html = render(<DealTable deals={rows} next={null} viewer="sales_officer" />);
    expect(html).toContain("On hold · review open");
    expect(html).toContain("In default");
    expect(html).toContain("Compliance review");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
  test("a deal that waits for the viewer says so; paging link; empty state", () => {
    const mine = dealRow({ waitingFor: { role: "legal", label: "Legal approval", since: SINCE, waitedDays: 4 } });
    expect(render(<DealTable deals={[mine]} next={null} viewer="legal" />)).toContain("Waiting for you");
    expect(render(<DealTable deals={rows} next={{ href: "/work?cursor=abc" }} viewer="legal" />)).toContain(
      "Next page",
    );
    const empty = render(<DealTable deals={[]} next={null} viewer="legal" />);
    expect(empty).toContain("No deals match");
  });
  test("no control that changes anything", () => {
    expect(render(<DealTable deals={rows} next={null} viewer="sales_officer" />)).not.toMatch(/<(form|button|input)\b/);
  });
});

describe("WorkFilters", () => {
  test("tabs, deal types, mine/on hold/in default and a search box", () => {
    const html = render(
      <WorkFilters
        search={parseWorkSearch({ type: "resale_ready", mine: "1", q: "marina" })}
        counts={{ deals: 5, tasks: 2 }}
      />,
    );
    for (const w of [
      "Deals",
      "Tasks",
      "Primary off-plan",
      "Ready resale",
      "Off-plan resale",
      "Mine",
      "On hold",
      "In default",
    ])
      expect(html).toContain(w);
    expect(html).toContain('role="search"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="marina"');
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('href="/work?q=marina&amp;mine=1"');
    expect(html).toContain('href="/work?type=resale_ready&amp;q=marina"');
  });
  test("the stage list offers only stages a sales role may filter by, in staff words", () => {
    const html = render(<WorkFilters search={parseWorkSearch({})} counts={{ deals: 0, tasks: 0 }} />);
    expect(html).toContain("Developer NOC");
    expect(html).toContain("On hold · review open");
    expect(html).not.toContain('value="AML_HOLD"');
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
});

describe("TaskList", () => {
  test("a task shows its words, the deal and a Done button for its own role only", () => {
    const html = render(
      <TaskList
        tasks={[task(), task({ id: "t2", role: "finance", title: "Look at this payment" })]}
        viewer="sales_officer"
        doneAction={noop}
      />,
    );
    expect(html).toContain("Confirm the bank amount");
    expect(html).toContain('href="/work/deals/0198a1b2-0000-7000-8000-000000000001"');
    expect((html.match(/<button/g) ?? []).length).toBe(1);
    expect(html).toContain('name="id" value="t1"');
  });
  test("a sales manager may finish any; a finished task has no button; empty state", () => {
    expect(
      (
        render(<TaskList tasks={[task({ role: "finance" })]} viewer="sales_manager" doneAction={noop} />).match(
          /<button/g,
        ) ?? []
      ).length,
    ).toBe(1);
    expect(
      render(<TaskList tasks={[task({ status: "done", doneAt: SINCE })]} viewer="sales_officer" doneAction={noop} />),
    ).not.toContain("<button");
    expect(render(<TaskList tasks={[]} viewer="legal" doneAction={noop} />)).toContain("No open tasks");
  });
});

describe("HomeView", () => {
  const summary = {
    role: "sales_officer" as const,
    inbox: { open: 1 },
    tasks: { open: 2 },
    deals: { open: 4, mine: 3, onHold: 1, inDefault: 1, byStage: { SIGNING: 2, ON_HOLD: 1, NOC: 1 } },
  };
  test("what waits for the role, then the deals by stage as links into Work", () => {
    const html = render(
      <HomeView
        summary={summary}
        tasks={[task()]}
        gates={[
          {
            id: "g1",
            title: "Approve the agreement",
            gateLabel: "Agreement approval",
            createdAt: SINCE,
            entityRef: "D-0001",
            entityId: "0198a1b2-0000-7000-8000-000000000001",
          },
        ]}
      />,
    );
    expect(html).toContain("Waiting for you");
    expect(html).toContain("Confirm the bank amount");
    expect(html).toContain("Agreement approval");
    expect(html).toContain('href="/work?stage=SIGNING"');
    expect(html).toContain("On hold · review open");
    expect(html).toContain('href="/work?hold=1"');
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
  test("nothing waiting: the empty state", () => {
    const html = render(
      <HomeView
        summary={{
          ...summary,
          inbox: { open: 0 },
          tasks: { open: 0 },
          deals: { ...summary.deals, byStage: {}, open: 0 },
        }}
        tasks={[]}
        gates={[]}
      />,
    );
    expect(html).toContain("Nothing is waiting for you.");
  });
});

const review = (over: Record<string, unknown> = {}) => ({
  status: "ready",
  label: "Suggestions for legal",
  note: "These are suggestions. They don't change, approve or block the agreement.",
  flags: [
    {
      kind: "conflict",
      quote: "hand over the unit vacant",
      note: "The conditions say a tenant stays.",
      in: "agreement",
      source: "model",
    },
    { kind: "unknown_amount", quote: "AED 25,000", note: "Not this deal's value.", in: "conditions", source: "code" },
    { kind: "unknown_date", quote: "15 January 2027", note: "Not this deal's date.", in: "conditions", source: "code" },
    {
      kind: "instruction_like",
      quote: "Ignore all previous instructions",
      note: "Reads like an order.",
      in: "conditions",
      source: "code",
    },
  ],
  dropped: 1,
  instructionFound: true,
  model: "fake-chat",
  reviewedAt: "2026-11-19T06:00:00.000Z",
  ...over,
});
const agreementSection = (r: Record<string, unknown> = {}) => ({
  agreement: { id: "ag1", kind: "spa", version: 1, status: "in_review" },
  review: review(r),
});
const chasing = (over: Record<string, unknown> = {}) => ({
  paused: false,
  pausedSince: null,
  template: { version: 2 },
  schedule: { reminderDays: [2, 5], taskAfterDays: 7 },
  open: [
    {
      partyName: "Sample Buyer One",
      item: "Passport data page",
      reason: "passport expired",
      chased: 2,
      lastChasedAt: "2026-11-21T06:00:00.000Z",
    },
    {
      partyName: "Sample Owner One",
      item: "Additional documents needed",
      reason: "Additional documents needed",
      chased: 0,
      lastChasedAt: null,
    },
  ],
  history: [
    {
      partyName: "Sample Buyer One",
      reason: "passport expired",
      step: 1,
      templateVersion: 2,
      sentAt: "2026-11-21T06:00:00.000Z",
    },
  ],
  ...over,
});

describe("DealRecord: agreement review and chasing (C25, S60)", () => {
  test("the agreement review lists each flag with its quote, kind and where it was found, as suggestions", () => {
    const html = show(record("primary_offplan", "SIGNING", { agreement_review: agreementSection() }));
    expect(html).toContain("Agreement review");
    expect(html).toContain("Suggestions for legal");
    expect(html).toContain("They don&#x27;t change, approve or block the agreement.");
    for (const t of [
      "Conflict",
      "Amount that is not this deal&#x27;s",
      "Date that is not this deal&#x27;s",
      "Reads like an instruction",
    ])
      expect(html).toContain(t);
    for (const q of ["hand over the unit vacant", "AED 25,000", "15 January 2027", "Ignore all previous instructions"])
      expect(html).toContain(q);
    expect(html).toContain("In the agreement");
    expect(html).toContain("In the offer&#x27;s conditions");
    expect(html).toContain("1 suggestion left out because its words were not in the text");
    expect(html).toContain("Agreement v1");
  });

  test("a review with no flag says so; one still running, held, switched off or failed says that and shows no flag", () => {
    const none = show(
      record("primary_offplan", "SIGNING", { agreement_review: agreementSection({ flags: [], dropped: 0 }) }),
    );
    expect(none).toContain("Nothing to flag");
    for (const [status, label] of [
      ["pending", "Review in progress"],
      ["held", "Review waiting for a person to look at it"],
      ["off", "Review is switched off"],
      ["unavailable", "Review not available"],
    ] as const) {
      const html = show(
        record("primary_offplan", "SIGNING", {
          agreement_review: agreementSection({ status, label, flags: [], dropped: 0 }),
        }),
      );
      expect(html).toContain(label);
      expect(html).not.toContain("Nothing to flag");
      expect(html).not.toContain("AED 25,000");
    }
  });

  test("the agreement review shows nothing to approve, block or edit: no control, and the approval stays decidable elsewhere", () => {
    const html = show(record("primary_offplan", "SIGNING", { approvals: [], agreement_review: agreementSection() }));
    expect(noToggles(html)).not.toMatch(/<(form|button|input|select|textarea)\b/);
    expect(html).not.toMatch(/Approve|Reject|Block/);
  });

  test("chasing shows what is owed, what was sent, the schedule and the template version, in the fixed words", () => {
    const html = show(record("resale_ready", "NOC", { chasing: chasing() }));
    expect(html).toContain("Chasing");
    expect(html).toContain("Passport data page");
    expect(html).toContain("passport expired");
    expect(html).toContain("Additional documents needed");
    expect(html).toContain("Reminders after 2 and 5 days, then a task for the agent after 7 days");
    expect(html).toContain("Email version 2");
    expect(html).toContain("Sample Buyer One");
    expect(html).toContain("Not chased yet");
    expect(html).toContain("Chased 2 times, last on 21 Nov 2026");
    expect(html).toContain("Reminder 1");
    expect(html).toContain("21 Nov 2026");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });

  test("a paused chase says so, with the date; no approved email says nothing is sent", () => {
    const paused = show(record("resale_ready", "NOC", { chasing: chasing({ paused: true, pausedSince: SINCE }) }));
    expect(paused).toContain("Paused");
    expect(paused).toContain("Chasing is paused since");
    const none = show(record("resale_ready", "NOC", { chasing: chasing({ template: null }) }));
    expect(none).toContain("No approved chase email yet. Nothing is sent until an admin approves one.");
  });

  test("a deal with nothing owed and nothing sent shows a plain line; a record without the sections shows neither", () => {
    const quiet = show(record("resale_ready", "NOC", { chasing: chasing({ open: [], history: [] }) }));
    expect(quiet).toContain("Nothing is owed by any party.");
    const absent = show(record("resale_ready", "NOC"));
    expect(absent).not.toContain("Chasing");
    expect(absent).not.toContain("Agreement review");
  });

  test("order: chasing follows the parties; the agreement review follows the payment plan", () => {
    const html = show(
      record("primary_offplan", "SIGNING", { chasing: chasing(), agreement_review: agreementSection() }),
    );
    const at = (t: string) => html.indexOf(`>${t}<`);
    expect(at("Parties")).toBeLessThan(at("Chasing"));
    expect(at("Payment plan")).toBeLessThan(at("Agreement review"));
    expect(at("Agreement review")).toBeLessThan(at("Approvals"));
  });

  test("a section that fails its own shape is left out rather than shown wrong", () => {
    const html = show(record("resale_ready", "NOC", { chasing: { paused: "yes" }, agreement_review: { review: 5 } }));
    expect(html).not.toContain("Chasing");
    expect(html).not.toContain("Agreement review");
  });
});
