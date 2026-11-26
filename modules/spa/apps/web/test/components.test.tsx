import { describe, expect, test } from "bun:test";
import { noToggles } from "./no-toggles.ts";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ActivityLog } from "../components/activity-log";
import { Amount } from "../components/amount";
import { DealStepper } from "../components/deal-stepper";
import { PartyCard } from "../components/party-card";
import { StateBadge } from "../components/state-badge";
import { WaitingBanner } from "../components/waiting-banner";
import { COMPLIANCE_WORDS, event, partyView, SINCE, stepsOf } from "./fixtures";

describe("StateBadge", () => {
  test("a stage is a pill in words, tone by design 6.1", () => {
    expect(render(<StateBadge stage="SIGNING" label="Signing" />)).toContain(">Signing<");
    const hold = render(<StateBadge stage="ON_HOLD" label="On hold · review open" />);
    expect(hold).toContain("On hold · review open");
    expect(hold).toContain("text-warning");
    expect(render(<StateBadge stage="COMPLETED" label="Completed" />)).toContain("bg-accent");
  });
});

describe("DealStepper", () => {
  test("each deal type shows its own steps", () => {
    const primary = render(<DealStepper steps={stepsOf("primary_offplan", "SIGNING")} />);
    expect(primary).toContain("Oqood registration");
    expect(primary).toContain("Instalments");
    expect(primary).not.toContain("Developer NOC");
    expect(primary).not.toContain("Settlement statement");
    const resale = render(<DealStepper steps={stepsOf("resale_ready", "NOC")} />);
    expect(resale).toContain("Developer NOC");
    expect(resale).toContain("Settlement statement");
    expect(resale).toContain("Transfer");
    expect(resale).not.toContain("Oqood");
    expect(resale).not.toContain("Banks");
    expect(render(<DealStepper steps={stepsOf("resale_ready", "NOC", { buyerMortgage: true })} />)).toContain("Banks");
    expect(render(<DealStepper steps={stepsOf("resale_offplan", "NOC")} />)).toContain("Instalments");
  });
  test("done, current and to do are said in words, and the current step is marked", () => {
    const html = render(<DealStepper steps={stepsOf("primary_offplan", "SIGNING")} />);
    expect(html).toContain('aria-current="step"');
    expect(html).toContain('Signing<span class="sr-only"> (current)');
    expect(html).toContain("(done)");
    expect(html).toContain("(to do)");
  });
  test("a finished deal shows every step done; a cancelled one keeps what it reached", () => {
    const done = render(<DealStepper steps={stepsOf("resale_ready", "COMPLETED")} />);
    expect(done).not.toContain("(to do)");
    expect(done).not.toContain("(current)");
    const cancelled = render(<DealStepper steps={stepsOf("primary_offplan", "CANCELLED")} />);
    expect(cancelled).toContain("(to do)");
    expect(cancelled).not.toContain("(current)");
  });
});

describe("WaitingBanner", () => {
  test("says who the deal waits for and since when, with no control to decide", () => {
    const html = render(
      <WaitingBanner
        waiting={{ role: "legal", label: "Legal approval", since: SINCE, waitedDays: 4 }}
        viewer="sales_officer"
      />,
    );
    expect(html).toContain("Legal approval");
    expect(html).toContain("Legal");
    expect(html).toContain("since 15 Nov 2026");
    expect(noToggles(html)).not.toMatch(/<(button|form|input)/);
  });
  test("a deal that waits for the viewer says so", () => {
    const html = render(
      <WaitingBanner
        waiting={{ role: "legal", label: "Legal approval", since: SINCE, waitedDays: 4 }}
        viewer="legal"
      />,
    );
    expect(html).toContain("Waiting for you");
  });
  test("a review is named to nobody, and shows no compliance word beyond the neutral label", () => {
    const html = render(
      <WaitingBanner
        waiting={{ role: null, label: "Compliance review", since: SINCE, waitedDays: 2 }}
        viewer="sales_officer"
      />,
    );
    expect(html).toContain("Compliance review");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
  test("nothing renders for a finished deal", () => {
    expect(render(<WaitingBanner waiting={null} viewer="legal" />)).toBe("");
  });
});

describe("PartyCard", () => {
  test("role, share, KYC result and the neutral compliance line", () => {
    const html = render(<PartyCard party={partyView({ shareBps: 5000, role: "seller" })} />);
    expect(html).toContain("Sample Buyer One");
    expect(html).toContain("Seller");
    expect(html).toContain("50%");
    expect(html).toContain("Passed");
    expect(html).toContain("Compliance review");
    expect(html).toContain("None");
  });
  test("an open review reads 'Review open' as a warning, with no detail", () => {
    const html = render(
      <PartyCard
        party={partyView({ compliance: { label: "Compliance review", status: "open" }, kyc: { status: "review" } })}
      />,
    );
    expect(html).toContain("Review open");
    expect(html).toContain("text-warning");
    expect(html).not.toMatch(COMPLIANCE_WORDS);
  });
  test("a company is labelled and a party without a check is 'Not started'", () => {
    const html = render(<PartyCard party={partyView({ kind: "company", kyc: null })} />);
    expect(html).toContain("Company");
    expect(html).toContain("Not started");
  });
});

describe("Amount", () => {
  test("integer fils as AED; an unconfirmed amount carries the warning pill", () => {
    expect(render(<Amount fils={150_000_000} />)).toContain("AED 1,500,000");
    expect(render(<Amount fils={150_000_000} />)).not.toContain("Read, not confirmed");
    const html = render(<Amount fils={12_345} confirmed={false} />);
    expect(html).toContain("AED 123.45");
    expect(html).toContain("Read, not confirmed");
    expect(html).toContain("text-warning");
  });
});

describe("ActivityLog", () => {
  test("time in UAE time, who, and what", () => {
    const html = render(
      <ActivityLog
        events={[
          event(),
          event({
            id: "e2",
            label: "Approval requested: Legal approval",
            actor: { kind: "system", label: "System" },
            at: "2026-11-02T10:30:00.000Z",
            toState: null,
          }),
        ]}
        next={null}
      />,
    );
    expect(html).toContain("1 Nov 2026, 10:00");
    expect(html).toContain("Rania Officer");
    expect(html).toContain("Deal created");
    expect(html).toContain("2 Nov 2026, 14:30");
    expect(html).toContain("<time");
    expect(html).toContain("Offer accepted");
  });
  test("empty and paged", () => {
    expect(render(<ActivityLog events={[]} next={null} />)).toContain("No activity yet");
    expect(render(<ActivityLog events={[event()]} next={{ href: "/work/deals/x?events=abc" }} />)).toContain(
      "Earlier activity",
    );
  });
  test("helper runs show how it was handled, labelled as a suggestion", () => {
    const html = render(
      <ActivityLog
        events={[]}
        next={null}
        runs={[
          {
            id: "r1",
            helper: "kyc",
            status: "needs_human",
            reasons: ["The passport photo is unreadable"],
            modelTag: "m1",
            createdAt: "2026-11-03T08:00:00.000Z",
          },
        ]}
      />,
    );
    expect(html).toContain("How this was handled");
    expect(html).toContain("kyc");
    expect(html).toContain("Needs a person");
    expect(html).toContain("suggestion");
    expect(html).toContain("The passport photo is unreadable");
  });
});
