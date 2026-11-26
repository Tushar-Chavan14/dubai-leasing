import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";
import { ProjectForm, ProjectTable, ProjectView } from "../components/projects";
import { ProjectRecord, ProjectsList } from "../lib/contracts";
import config from "../next.config";

const ID = (n: number) => `0198a1b2-0000-7000-8000-${String(n).padStart(12, "0")}`;
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const noop = async () => {};

const record = (over: Record<string, unknown> = {}) =>
  ProjectRecord.parse({
    id: ID(9),
    code: "MV-01",
    name: "Marina Vista",
    emirate: "dubai",
    anticipatedCompletionOn: "2028-06-30",
    community: "Marina Bay",
    location: "Waterfront district",
    description: "A fictional waterfront project.",
    media: [{ id: ID(60), caption: "Podium", sort: 0 }],
    activity: [
      { id: ID(70), label: "Details changed", at: "2026-11-20T06:00:00.000Z", actor: "Admin", changed: ["community"] },
    ],
    templateKind: "spa",
    template: { name: "Primary SPA", version: 2 },
    escrow: { bankName: "[BANK]", accountMasked: "•••• 3456" },
    buildings: [{ id: ID(20), code: "A", name: "Tower A", units: 2 }],
    units: [],
    priceLists: [
      { id: ID(50), version: 1, status: "published", publishedAt: "2026-11-01T06:00:00.000Z", prices: 2, inUse: true },
    ],
    ...over,
  });

describe("S75: the project page", () => {
  test("sections read in record order: Overview, Photos, Buildings, Units, Price lists, Activity", () => {
    const html = render(<ProjectView project={record()} viewer="admin" units={<p>the units</p>} />);
    const at = (id: string) => html.indexOf(`id="${id}"`);
    const order = ["facts", "photos", "buildings", "units", "price-lists", "activity"].map(at);
    expect(order.every((i) => i > -1)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
  });

  test("overview shows community, location, handover and description; photos come from the media route", () => {
    const html = render(<ProjectView project={record()} viewer="sales_officer" units={<p>the units</p>} />);
    const t = text(html);
    for (const s of [
      "Marina Bay",
      "Waterfront district",
      "30 Jun 2028",
      "A fictional waterfront project.",
      "Primary SPA",
      "Podium",
    ])
      expect(t, s).toContain(s);
    expect(html).toContain(`src="/media/${ID(60)}"`);
    expect(t).toContain("•••• 3456");
  });

  test("the table has the cover tile, the community, counts and links to the project under /inventory/projects", () => {
    const list = ProjectsList.parse({
      unplacedUnits: 0,
      items: [
        {
          id: ID(9),
          code: "MV-01",
          name: "Marina Vista",
          emirate: "dubai",
          anticipatedCompletionOn: "2028-06-30",
          community: "Marina Bay",
          coverMediaId: ID(60),
          buildings: 2,
          units: 9,
          byState: { AVAILABLE: 9, HELD: 0, SOLD: 0, REGISTERED: 0, HANDED_OVER: 0 },
          priceListVersion: 1,
        },
      ],
    });
    const html = render(<ProjectTable projects={list.items} unplaced={0} />);
    expect(html).toContain(`href="/inventory/projects/${ID(9)}"`);
    expect(html).toContain(`src="/media/${ID(60)}"`);
    expect(text(html)).toContain("Marina Bay");
    expect(text(html)).toContain("9 available");
  });

  test("an old link /inventory/<id> redirects to /inventory/projects/<id>; other paths are left alone", async () => {
    const rules = await config.redirects!();
    const rule = rules.find((r) => r.destination === "/inventory/projects/:id")!;
    expect(rule.permanent).toBe(true);
    const pattern = /\(([^)]+)\)$/.exec(rule.source)![1]!;
    const re = new RegExp(`^${pattern}$`);
    expect(re.test(ID(9))).toBe(true);
    for (const other of ["units", "projects", "new"]) expect(re.test(other)).toBe(false);
  });

  test("the form: New asks for the code and template; Edit is pre-filled and has neither", () => {
    const create = render(<ProjectForm action={noop} />);
    expect(create).toContain('name="code"');
    expect(create).toContain('name="templateKind"');
    expect(text(create)).toContain("Add the project");
    const edit = render(<ProjectForm action={noop} project={record()} />);
    expect(edit).not.toContain('name="code"');
    expect(edit).not.toContain('name="templateKind"');
    expect(edit).toContain('value="Marina Bay"');
    expect(edit).toContain(`name="id" value="${ID(9)}"`);
    expect(text(edit)).toContain("A fictional waterfront project.");
  });
});
