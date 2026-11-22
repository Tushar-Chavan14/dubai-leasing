import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { HomeView } from "../components/home-view";
import { WorkFilters } from "../components/work-filters";
import { parseWorkSearch } from "../lib/work";

describe("C31: the inbox is reached from Work and from Home", () => {
  test("Work has an Inbox tab with the count of gates the role decides", () => {
    const html = render(
      <WorkFilters search={parseWorkSearch({ tab: "inbox" })} counts={{ deals: 4, tasks: 2, inbox: 3 }} />,
    );
    expect(html).toContain("Inbox");
    expect(html).toContain('href="/work?tab=inbox"');
    expect(html).toMatch(/aria-current="page"[^>]*>Inbox/);
    expect(html).not.toContain("Deal type");
  });
  test("Home links each waiting gate to the inbox of the role's own screen", () => {
    const summary = {
      role: "sales_manager",
      inbox: { open: 1 },
      tasks: { open: 0 },
      deals: { open: 0, mine: 0, onHold: 0, inDefault: 0, byStage: {} },
    } as never;
    const gate = {
      id: "g1",
      title: "Passport is unreadable",
      gateLabel: "KYC review",
      createdAt: "2026-11-15T06:00:00.000Z",
      entityRef: "D-1",
      entityId: "d1",
    };
    expect(render(<HomeView summary={summary} tasks={[]} gates={[gate]} />)).toContain('href="/work?tab=inbox"');
    expect(
      render(<HomeView summary={summary} tasks={[]} gates={[gate]} canWork={false} inboxHref="/compliance#inbox" />),
    ).toContain('href="/compliance#inbox"');
    const none = render(<HomeView summary={summary} tasks={[]} gates={[gate]} canWork={false} />);
    expect(none).not.toContain("/work");
  });
});
