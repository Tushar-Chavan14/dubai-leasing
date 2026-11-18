import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import {
  FakeMailer,
  formatDubaiDateTime,
  renderPdf,
  renewalNoticeEmail,
  viewingInvitationEmail,
} from "../src/index.ts";

describe("renderPdf", () => {
  test("renders a valid, deterministic PDF and survives non-WinAnsi characters", async () => {
    const blocks = [
      { kind: "title" as const, text: "Notice of tenancy renewal" },
      { kind: "facts" as const, rows: [["Change", "T−90 — “+5%”"]] as [string, string][] },
      { kind: "para" as const, text: "word ".repeat(2000) },
    ];
    const a = await renderPdf({ title: "N", subject: "S" }, blocks);
    const b = await renderPdf({ title: "N", subject: "S" }, blocks);
    expect(new TextDecoder().decode(a.slice(0, 5))).toBe("%PDF-");
    expect(a).toEqual(b);
    const doc = await PDFDocument.load(a);
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });
});

describe("renewal notice email", () => {
  test("escapes values and includes both links in text and HTML", () => {
    const m = renewalNoticeEmail({
      tenantName: "Sara <b>Khan</b>",
      unitLabel: "MRN-1204",
      leaseEndOn: "29 March 2027",
      currentRent: "AED 85,000.00",
      proposedRent: "AED 89,250.00",
      increase: true,
      reference: "N-1",
      acknowledgeUrl: "https://x/t/ack",
      tenancyUrl: "https://x/t/me",
      demo: false,
    });
    expect(m.text).not.toContain("Demo build");
    expect(m.html).not.toContain("<b>Khan</b>");
    expect(m.html).toContain("&lt;b&gt;");
    expect(m.text).toContain("https://x/t/ack");
    expect(m.html).toContain("https://x/t/me");
    expect(m.subject).toContain("rent change");
  });
});

describe("FakeMailer demo redirect", () => {
  test("delivers to the demo inbox, keeps the intended recipient", async () => {
    const m = new FakeMailer("demo@inbox.example");
    const r = await m.send({ to: "tenant@demo.example", subject: "s", text: "t", html: "h" });
    expect(r.deliveredTo).toBe("demo@inbox.example");
    expect(m.sent[0]?.to).toBe("tenant@demo.example");
  });
});

describe("viewing invitation email", () => {
  const base = {
    applicantName: "Layla",
    unitLabel: "1204, Marina <Tower>",
    address: "Unit 1204, Marina <Tower>, Dubai Marina, Dubai",
    // 20:30 UTC on the 22nd is 00:30 on the 23rd in Dubai.
    viewingAt: new Date("2026-10-22T20:30:00Z"),
    propertyUrl: "https://example.test/t/tok/property",
    statusUrl: "https://example.test/t/tok2",
    reference: "A-TEST",
    demo: true,
  };
  test("formats the time in Dubai across a UTC date boundary", () => {
    expect(formatDubaiDateTime(new Date("2026-10-22T20:30:00Z"))).toBe("Friday 23 October 2026, 12:30 am (Dubai time)");
    expect(formatDubaiDateTime(new Date("2026-10-23T12:30:00Z"))).toBe("Friday 23 October 2026, 4:30 pm (Dubai time)");
    const m = viewingInvitationEmail(base);
    expect(m.text).toContain("Friday 23 October 2026, 12:30 am (Dubai time)");
    expect(m.text).toContain("View the property online: https://example.test/t/tok/property");
  });
  test("tour button only when the unit has a tour URL", () => {
    expect(viewingInvitationEmail(base).html).not.toContain("Virtual tour");
    const m = viewingInvitationEmail({ ...base, virtualTourUrl: "https://tour.example.test/x" });
    expect(m.html).toContain("Virtual tour");
    expect(m.html).toContain('href="https://tour.example.test/x"');
  });
  test("values are HTML-escaped", () => {
    const m = viewingInvitationEmail(base);
    expect(m.html).toContain("Marina &lt;Tower&gt;");
    expect(m.html).not.toContain("<Tower>");
  });
});
