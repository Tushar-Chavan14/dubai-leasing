/* oxlint-disable no-explicit-any -- elements and parsed bodies are read loosely in these tests */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup as render } from "react-dom/server";

const redirects: string[] = [];
mock.module("next/navigation", () => ({
  usePathname: () => "/work",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push() {}, refresh() {} }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (to: string) => {
    redirects.push(to);
    throw new Error("NEXT_REDIRECT");
  },
}));
mock.module("../lib/env", () => ({
  engineUrl: () => "http://engine.test",
  sessionCookie: () => "spa_session",
  webEnv: () => ({ SPA_TRUSTED_PROXY: true }),
}));
mock.module("next/cache", () => ({ revalidatePath() {} }));

const { EnquiryForm } = await import("../components/public/enquiry-form");
const { PropertyView } = await import("../components/public/property-view");
const { sendEnquiry } = await import("../lib/enquiry-submit");
const { default: CancelPage } = await import("../app/(site)/v/[token]/cancel/page");
const { LeadsTable } = await import("../components/leads-table");
const { ViewingsList } = await import("../components/viewings-list");
const { LeadView } = await import("../components/lead-view");
const { ViewingsForm } = await import("../components/settings-pages");
const { WorkFilters } = await import("../components/work-filters");
const { groupSlotsByDay, viewingTimeLabel } = await import("../lib/viewing-slots");
const { policyRequest } = await import("../lib/settings-forms");
const { projectUpdateRequest } = await import("../lib/catalogue");
const { parseWorkSearch, waitingCount, workHref } = await import("../lib/work");
const { LeadRecord, LeadsPage, ViewingsPage } = await import("../lib/contracts");

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ENUMS = /viewing_booked|not_interested|no_show|listing_chat|sales_officer|needsOutcome/;
// 2026-11-26 is a Thursday; Dubai is UTC+4.
const SLOTS = ["2026-11-26T10:00:00.000Z", "2026-11-26T10:30:00.000Z", "2026-11-27T06:00:00.000Z"];

const detail = (over: Record<string, unknown> = {}) => ({
  ref: "L-0007",
  source: "listing" as const,
  title: "2-bed apartment, Marina Vista",
  community: "Dubai Marina",
  projectName: null,
  developerName: null,
  unitType: "apartment",
  unitTypeLabel: "Apartment",
  bedrooms: 2,
  bathrooms: 2,
  sizeSqft: 1200,
  priceFils: 175_000_000,
  permitNo: "123456",
  coverPhotoId: null,
  photoCount: 0,
  handover: null,
  description: "Bright flat.",
  floor: 12,
  view: "Marina",
  parkingSpaces: 1,
  furnishedLabel: null,
  photoIds: [],
  agent: { name: "Rania Agent" },
  chat: true,
  ...over,
});

describe("M5: the public form", () => {
  test("times are grouped by Dubai day and read as Dubai wall time", () => {
    const days = groupSlotsByDay(SLOTS);
    expect(days.map((d) => d.label)).toEqual(["Thursday 26 Nov", "Friday 27 Nov"]);
    expect(days[0]!.times.map((t) => t.label)).toEqual(["14:00", "14:30"]);
    expect(days[1]!.times.map((t) => t.label)).toEqual(["10:00"]);
    expect(viewingTimeLabel(SLOTS[0]!)).toBe("Thu 26 Nov 2026, 14:00 (Dubai)");
    // A late-evening UTC instant is already the next Dubai day.
    expect(groupSlotsByDay(["2026-11-26T21:00:00.000Z"])[0]!.day).toBe("2026-11-27");
    expect(groupSlotsByDay(["nope"])).toEqual([]);
  });

  test("both tabs, the times by day, the contact fields and the consent box", () => {
    const html = render(<EnquiryForm homeRef="L-0007" slots={SLOTS} />);
    const t = text(html);
    expect(t).toContain("Book a viewing");
    expect(t).toContain("Ask a question");
    expect(t).toContain("Thursday 26 Nov");
    expect(t).toContain("Friday 27 Nov");
    expect(t).toContain("14:30");
    for (const name of ["name", "email", "phone", "message", "consent"]) expect(html).toContain(`name="${name}"`);
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('name="ref" value="L-0007"');
    expect(t).toContain("I agree to be contacted");
    expect(html).toContain('role="tablist"');
    expect(html).not.toMatch(ENUMS);
  });

  test("with no free times the booking tab says so and can't submit", () => {
    const html = render(<EnquiryForm homeRef="L-0007" slots={[]} />);
    expect(text(html)).toContain("no free viewing times");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  test("the form is in the aside of a listing (with the chat) and of a unit (without); the old placeholder is gone", () => {
    const listing = render(<PropertyView p={detail() as any} slots={SLOTS} />);
    expect(listing).toContain('name="consent"');
    expect(text(listing)).toContain("Chat with the assistant");
    const unit = render(
      <PropertyView
        p={
          detail({
            ref: "U-MV-01-U-101",
            source: "developer",
            chat: false,
            permitNo: null,
            agent: null,
            developerName: "Dev Co",
          }) as any
        }
        slots={SLOTS}
      />,
    );
    expect(unit).toContain('name="consent"');
    expect(text(unit)).not.toContain("Chat with the assistant");
    expect(text(unit)).not.toContain("open soon");
  });
});

describe("M5: the public form's server action", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const form = (o: Record<string, string>) => {
    const d = new FormData();
    for (const [k, v] of Object.entries({
      ref: "L-0007",
      mode: "book",
      name: "Sara Khan",
      email: "Sara@Example.test",
      slot: SLOTS[0]!,
      consent: "on",
      ...o,
    }))
      d.set(k, v);
    return d;
  };
  const submit = (f: FormData) => sendEnquiry(f, new Headers({ "x-forwarded-for": "203.0.113.5" }));
  const engine = (status: number, body: unknown) => {
    const calls: { url: string; init: any }[] = [];
    globalThis.fetch = (async (url: string, init: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status });
    }) as any;
    return calls;
  };

  test("a booking posts the visitor's own details to the viewings route with the proxy bucket, lower-cased email", async () => {
    const calls = engine(201, { ok: true, startsAt: SLOTS[0] });
    const r = await submit(form({ phone: "+971 50 123 4567", message: "Parking?" }));
    expect(r).toEqual({ done: "booked", startsAt: SLOTS[0] });
    expect(calls[0]!.url).toBe("http://engine.test/public/catalogue/L-0007/viewings");
    expect(calls[0]!.init.headers["x-forwarded-for"]).toBe("203.0.113.5");
    expect(JSON.parse(calls[0]!.init.body)).toEqual({
      name: "Sara Khan",
      email: "sara@example.test",
      phone: "+971 50 123 4567",
      message: "Parking?",
      slot: SLOTS[0],
      consent: true,
    });
  });

  test("a question posts to the enquiries route and needs words", async () => {
    const calls = engine(201, { ok: true });
    expect(await submit(form({ mode: "ask", slot: "" }))).toMatchObject({
      fields: { message: "Write your question." },
    });
    expect(calls).toHaveLength(0);
    const r = await submit(form({ mode: "ask", slot: "", message: "Is it available?" }));
    expect(r).toEqual({ done: "asked" });
    expect(calls[0]!.url).toBe("http://engine.test/public/catalogue/L-0007/enquiries");
    expect(JSON.parse(calls[0]!.init.body).slot).toBeUndefined();
  });

  test("missing consent, a bad email and no time are field errors and nothing is sent", async () => {
    const calls = engine(201, { ok: true });
    const r = await submit(form({ consent: "", email: "nope", slot: "" }));
    expect(Object.keys(r.fields ?? {}).toSorted()).toEqual(["consent", "email", "slot"]);
    expect(calls).toHaveLength(0);
  });

  test("a taken time clears the choice and asks for a refresh; other refusals have fixed words", async () => {
    engine(409, { code: "slot_taken", error: "internal words" });
    expect(await submit(form({}))).toEqual({
      error: "Someone just took that time. Choose another.",
      slotTaken: true,
    });
    engine(404, { code: "not_found" });
    expect((await submit(form({}))).error).toContain("no longer available");
    engine(429, { code: "rate_limited" });
    expect((await submit(form({}))).error).toContain("Too many requests");
    engine(500, {});
    expect((await submit(form({}))).error).not.toContain("internal");
  });
});

describe("M5: the cancel page", () => {
  const token = "a".repeat(43);
  test("it asks before it cancels: a button, nothing done yet", async () => {
    const html = render(await CancelPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({}) }));
    expect(text(html)).toContain("Cancel your viewing?");
    expect(html).toContain('type="submit"');
    expect(html).toContain(`name="token" value="${token}"`);
    expect(text(html)).not.toContain("is cancelled");
  });
  test("each result has its own fixed words, and a second click reads 'Already cancelled'", async () => {
    const show = async (result: string) =>
      text(render(await CancelPage({ params: Promise.resolve({ token }), searchParams: Promise.resolve({ result }) })));
    expect(await show("cancelled")).toContain("Your viewing is cancelled");
    expect(await show("already_cancelled")).toContain("Already cancelled");
    expect(await show("not_found")).toContain("no longer valid");
    expect(await show("anything-else")).toContain("cancel it");
  });
});

const lead = (over: Record<string, unknown> = {}) =>
  LeadRecord.parse({
    id: "0198a1b2-0000-7000-8000-000000000001",
    ref: "LD-0001",
    name: "Sara Khan",
    email: "sara@example.test",
    phone: "+971 50 123 4567",
    status: "new",
    statusLabel: "New",
    source: "form",
    sourceLabel: "Property page form",
    consentAt: "2026-11-25T06:00:00.000Z",
    createdAt: "2026-11-25T06:00:00.000Z",
    dealId: null,
    property: { kind: "listing", ref: "L-0007", title: "2BR Marina", id: "0198a1b2-0000-7000-8000-000000000009" },
    agent: { id: "0198a1b2-0000-7000-8000-000000000002", name: "Rania Agent" },
    messages: [{ seq: 1, body: "<script>alert(1)</script> Is it available?", createdAt: "2026-11-25T06:00:00.000Z" }],
    viewings: [],
    activity: [{ id: "e1", label: "Lead created", at: "2026-11-25T06:00:00.000Z", actor: "Visitor", note: null }],
    ...over,
  });
const booked = (over: Record<string, unknown> = {}) => ({
  id: "0198a1b2-0000-7000-8000-000000000050",
  startsAt: "2026-11-26T10:00:00.000Z",
  endsAt: "2026-11-26T10:30:00.000Z",
  status: "booked",
  statusLabel: "Booked",
  outcomeNote: null,
  cancelReason: null,
  needsOutcome: false,
  ...over,
});

describe("M5: Work -> Leads and Viewings", () => {
  const leadsPage = (canSeeAll: boolean) =>
    LeadsPage.parse({
      mineOnly: !canSeeAll,
      canSeeAll,
      items: [
        {
          id: "0198a1b2-0000-7000-8000-000000000001",
          ref: "LD-0001",
          name: "Sara Khan",
          email: "sara@example.test",
          status: "viewing_booked",
          statusLabel: "Viewing booked",
          source: "listing_chat",
          sourceLabel: "Listing chat",
          propertyRef: "L-0007",
          propertyTitle: "2BR Marina",
          lastMessage: "Is it available?",
          agentName: "Rania Agent",
          createdAt: "2026-11-25T06:00:00.000Z",
        },
      ],
    });

  test("the leads table has the filters and the eight columns, with labels only", () => {
    const html = render(
      <LeadsTable
        data={leadsPage(true)}
        filters={{}}
        mineHref="/work?tab=leads&scope=mine"
        allHref="/work?tab=leads&scope=all"
      />,
    );
    const t = text(html);
    for (const c of ["Ref", "Name", "Home", "Source", "Status", "Last message", "Agent", "Created"])
      expect(t).toContain(c);
    for (const f of ["Status", "Source", "Home"]) expect(html).toContain(`>${f}`);
    expect(html).toContain('name="status"');
    expect(html).toContain('name="source"');
    expect(html).toContain('name="property"');
    expect(t).toContain("Mine");
    expect(t).toContain("Viewing booked");
    expect(t).toContain("Listing chat");
    expect(t).toContain("25 Nov");
    // The select's option values are codes the engine reads; no code is shown as text.
    expect(text(html.replace(/<option[^>]*>[^<]*<\/option>/g, ""))).not.toMatch(ENUMS);
  });

  test("an officer has no Mine/All switch", () => {
    const html = render(<LeadsTable data={leadsPage(false)} filters={{}} mineHref="/a" allHref="/b" />);
    expect(text(html)).not.toContain("Whose leads");
  });

  const viewingsPage = (when: "today" | "upcoming" | "past", rows: Record<string, unknown>[]) =>
    ViewingsPage.parse({
      when,
      mineOnly: false,
      canSeeAll: true,
      items: rows.map((r, i) => ({
        id: `0198a1b2-0000-7000-8000-0000000001${i}0`,
        leadId: "0198a1b2-0000-7000-8000-000000000001",
        leadRef: "LD-0001",
        visitorName: "Sara Khan",
        startsAt: "2026-11-26T10:00:00.000Z",
        endsAt: "2026-11-26T10:30:00.000Z",
        status: "booked",
        statusLabel: "Booked",
        outcomeNote: null,
        cancelReason: null,
        propertyRef: "L-0007",
        propertyTitle: "2BR Marina",
        propertyKind: "listing",
        propertyId: "0198a1b2-0000-7000-8000-000000000009",
        agentName: "Rania Agent",
        needsOutcome: false,
        canChange: true,
        ...r,
      })),
    });
  const base = (p: { when?: string; scope?: string }) =>
    `/work?tab=viewings&when=${p.when ?? "today"}&scope=${p.scope ?? "all"}`;

  test("Today / Upcoming / Past; times in Dubai; a started viewing with no outcome says so and offers 'Record the outcome'", () => {
    const html = render(<ViewingsList data={viewingsPage("past", [{ needsOutcome: true }])} base={base} />);
    const t = text(html);
    for (const w of ["Today", "Upcoming", "Past"]) expect(t).toContain(w);
    expect(t).toContain("Thu 26 Nov 2026, 14:00");
    expect(t).toContain("Needs an outcome");
    expect(t).toContain("Record the outcome");
    expect(html).toContain('href="/leads/0198a1b2-0000-7000-8000-000000000001"');
    expect(html).toContain('href="/listings/0198a1b2-0000-7000-8000-000000000009"');
    expect(html).not.toMatch(ENUMS);
  });

  test("a future viewing has no outcome button; cancelling opens a reason box first (no textarea yet)", () => {
    const html = render(<ViewingsList data={viewingsPage("upcoming", [{}])} base={base} />);
    expect(text(html)).not.toContain("Record the outcome");
    expect(text(html)).toContain("Cancel viewing");
    expect(text(html)).toContain("Reschedule");
    expect(html).not.toContain("<textarea");
    expect(text(html)).not.toContain("Cancel the viewing");
  });

  test("a cancelled or finished viewing has no actions", () => {
    const html = render(
      <ViewingsList
        data={viewingsPage("past", [
          { status: "cancelled", statusLabel: "Cancelled", canChange: false, cancelReason: "Agent unwell" },
          { status: "attended", statusLabel: "Attended", canChange: false, outcomeNote: "Liked it" },
        ])}
        base={base}
      />,
    );
    expect(text(html)).not.toMatch(/Reschedule|Cancel viewing|Record the outcome/);
    expect(text(html)).toContain("Agent unwell");
    expect(text(html)).toContain("Liked it");
  });

  test("the Work tabs: Leads and Viewings only for a role that gets the counts; the address round-trips", () => {
    const withTabs = render(
      <WorkFilters search={parseWorkSearch({})} counts={{ deals: 1, tasks: 2, inbox: 0, leads: 3, viewings: 4 }} />,
    );
    expect(withTabs).toContain('href="/work?tab=leads"');
    expect(withTabs).toContain('href="/work?tab=viewings"');
    const without = render(<WorkFilters search={parseWorkSearch({})} counts={{ deals: 1, tasks: 2, inbox: 0 }} />);
    expect(without).not.toContain("tab=leads");
    expect(parseWorkSearch({ tab: "leads" }).tab).toBe("leads");
    expect(parseWorkSearch({ tab: "viewings" }).tab).toBe("viewings");
    expect(parseWorkSearch({ tab: "nonsense" }).tab).toBe("deals");
    expect(workHref(parseWorkSearch({ tab: "viewings" }), {})).toBe("/work?tab=viewings");
    expect(waitingCount({ inbox: { open: 2 }, tasks: { open: 3 }, leads: { viewings: 1, newLeads: 4 } })).toBe(10);
  });
});

describe("M5: a lead's page", () => {
  test("it reads top to bottom: Next step, Overview, Messages, Viewings, Activity; breadcrumbs back to Leads", () => {
    const html = render(<LeadView lead={lead()} />);
    const at = (id: string) => html.indexOf(`id="${id}"`);
    const order = ["next-step", "overview", "messages", "viewings", "activity"].map(at);
    expect(order.every((i) => i >= 0)).toBe(true);
    expect(order).toEqual(order.toSorted((a, b) => a - b));
    expect(html).toContain('href="/work?tab=leads"');
    expect(text(html)).toContain("Contact Sara Khan");
    expect(text(html)).toContain("Mark contacted");
    expect(text(html)).toContain("Book a viewing");
  });

  test("what the visitor wrote is plain text, never markup", () => {
    const html = render(<LeadView lead={lead()} />);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  test("the Next step follows the status", () => {
    const step = (over: Record<string, unknown>) => text(render(<LeadView lead={lead(over)} />));
    expect(step({ status: "contacted", statusLabel: "Contacted" })).toContain(
      "Book a viewing, or record their interest",
    );
    expect(step({ status: "viewing_booked", statusLabel: "Viewing booked", viewings: [booked()] })).toContain(
      "Viewing on Thu 26 Nov 2026, 14:00 (Dubai)",
    );
    expect(
      step({ status: "viewing_booked", statusLabel: "Viewing booked", viewings: [booked({ needsOutcome: true })] }),
    ).toContain("Record how the viewing went");
    const after = step({
      status: "viewing_booked",
      statusLabel: "Viewing booked",
      viewings: [booked({ status: "attended", statusLabel: "Attended" })],
    });
    expect(after).toContain("Was Sara Khan interested?");
    const none = render(<LeadView lead={lead({ status: "not_interested", statusLabel: "Not interested" })} />);
    expect(none).not.toContain('id="next-step"');
    const closed = render(<LeadView lead={lead({ status: "closed", statusLabel: "Closed" })} />);
    expect(closed).not.toContain('id="next-step"');
  });

  test("Interested: a unit lead gets a Start deal link that opens the deal form with the lead; a listing lead makes an offer", () => {
    const unitLead = render(
      <LeadView
        lead={lead({
          status: "interested",
          statusLabel: "Interested",
          property: { kind: "unit", ref: "U-1", title: "Unit 101", id: "0198a000-0000-7000-8000-000000000002" },
        })}
      />,
    );
    expect(text(unitLead)).not.toContain("Deal creation comes next");
    expect(text(unitLead)).toContain("Start deal");
    expect(unitLead).toContain('href="/deals/new?lead=');
    const listingLead = render(
      <LeadView
        lead={lead({
          status: "interested",
          statusLabel: "Interested",
          property: {
            kind: "listing",
            ref: "L-0001",
            title: "Marina flat",
            id: "0198a000-0000-7000-8000-000000000001",
          },
        })}
      />,
    );
    expect(listingLead).toContain('href="/listings/0198a000-0000-7000-8000-000000000001/offer?lead=');
    expect(text(listingLead)).toContain("Make an offer");
  });

  test("closing a lead opens a reason box first", () => {
    const html = render(<LeadView lead={lead()} />);
    expect(text(html)).toContain("Close this lead");
    expect(html).not.toContain("<textarea");
  });

  test("no raw codes on the page", () => {
    const html = render(
      <LeadView
        lead={lead({
          status: "viewing_booked",
          statusLabel: "Viewing booked",
          source: "listing_chat",
          sourceLabel: "Listing chat",
          viewings: [booked()],
        })}
      />,
    );
    expect(text(html)).not.toMatch(ENUMS);
  });
});

describe("M5: Settings -> Viewings and the project's sales agent", () => {
  const view = {
    page: "viewings" as const,
    version: 4,
    values: {
      viewings: {
        viewingDays: [1, 2, 3, 4, 5, 6],
        viewingStartHour: 10,
        viewingEndHour: 18,
        viewingSlotMinutes: 30,
        viewingLeadHours: 4,
        viewingHorizonDays: 14,
      },
      leads: { perEmailPerDay: 5 },
    },
  };
  test("an admin gets the form with Monday to Saturday ticked; anyone else reads it disabled with no save bar", () => {
    const admin = render(<ViewingsForm data={view} canEdit action={async () => {}} />);
    expect(admin).toContain('name="baseVersion" value="4"');
    expect(admin).toMatch(/name="day_1"[^>]*checked/);
    expect(admin).not.toMatch(/name="day_0"[^>]*checked/);
    for (const n of ["startHour", "endHour", "slotMinutes", "leadHours", "horizonDays", "perEmailPerDay"])
      expect(admin).toContain(`name="${n}"`);
    expect(text(admin)).toContain("Save viewing settings");
    const reader = render(<ViewingsForm data={view} canEdit={false} action={async () => {}} />);
    expect(text(reader)).not.toContain("Save viewing settings");
    expect(reader).toContain("disabled");
  });

  const f = (o: Record<string, string>) => {
    const d = new FormData();
    for (const [k, v] of Object.entries({
      baseVersion: "4",
      day_1: "on",
      day_2: "on",
      startHour: "9",
      endHour: "17",
      slotMinutes: "45",
      leadHours: "2",
      horizonDays: "21",
      perEmailPerDay: "3",
      ...o,
    }))
      d.set(k, v);
    return d;
  };
  test("the request carries the page's keys and nothing else; invalid values send nothing", () => {
    expect(policyRequest("viewings", f({}))).toEqual({
      method: "PUT",
      path: "/api/settings/policy/viewings",
      body: {
        baseVersion: 4,
        values: {
          viewings: {
            viewingDays: [1, 2],
            viewingStartHour: 9,
            viewingEndHour: 17,
            viewingSlotMinutes: 45,
            viewingLeadHours: 2,
            viewingHorizonDays: 21,
          },
          leads: { perEmailPerDay: 3 },
        },
      },
    });
    for (const bad of [
      { startHour: "18" },
      { endHour: "9" },
      { slotMinutes: "10" },
      { slotMinutes: "200" },
      { horizonDays: "0" },
      { horizonDays: "61" },
      { perEmailPerDay: "0" },
      { startHour: "x" },
    ])
      expect(policyRequest("viewings", f(bad)), JSON.stringify(bad)).toBeNull();
    const none = f({});
    none.delete("day_1");
    none.delete("day_2");
    expect(policyRequest("viewings", none)).toBeNull();
  });

  test("the project form offers the sales agent choice, and the update carries it only when the form does", async () => {
    const { ProjectForm } = await import("../components/projects");
    const { ProjectRecord } = await import("../lib/contracts");
    const rec = ProjectRecord.parse({
      id: "0198a1b2-0000-7000-8000-000000000009",
      code: "MV-01",
      name: "Marina Vista",
      emirate: "dubai",
      anticipatedCompletionOn: null,
      templateKind: "spa",
      template: null,
      escrow: null,
      buildings: [],
      units: [],
      priceLists: [],
      salesAgent: { id: "0198a1b2-0000-7000-8000-000000000002", name: "Rania Agent" },
      salesAgentOptions: [
        { id: "0198a1b2-0000-7000-8000-000000000002", name: "Rania Agent" },
        { id: "0198a1b2-0000-7000-8000-000000000003", name: "Omar Agent" },
      ],
    });
    const html = render(<ProjectForm action={async () => {}} project={rec} />);
    expect(html).toContain('name="salesAgentUserId"');
    expect(text(html)).toContain("Omar Agent");
    expect(html).toMatch(/<option value="0198a1b2-0000-7000-8000-000000000002" selected/);
    const d = new FormData();
    d.set("id", rec.id);
    d.set("name", "Marina Vista");
    expect((projectUpdateRequest(d) as any).body.salesAgentUserId).toBeUndefined();
    d.set("salesAgentUserId", "0198a1b2-0000-7000-8000-000000000003");
    expect((projectUpdateRequest(d) as any).body.salesAgentUserId).toBe("0198a1b2-0000-7000-8000-000000000003");
    d.set("salesAgentUserId", "");
    expect((projectUpdateRequest(d) as any).body.salesAgentUserId).toBeNull();
    d.set("salesAgentUserId", "not-an-id");
    expect(projectUpdateRequest(d)).toBeNull();
  });
});
