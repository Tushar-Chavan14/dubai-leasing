import { describe, expect, test } from "bun:test";
import {
  MAIL_TEMPLATE_VERSIONS,
  instalmentReminderMail,
  offerAnswerLinkMail,
  gateAlertMail,
  documentsRequestMail,
  registeredMail,
  transferBookedMail,
  signedCopyMail,
  signLinkMail,
  signReminderMail,
} from "../src/mail/index.ts";

const link = "https://spa.example.test/b/TOKEN123/sign";
const all = () => [
  offerAnswerLinkMail({
    property: "2-bed apartment",
    priceFils: 195_000_000,
    validUntil: "2026-11-22",
    link: "https://spa.example.test/b/TOKEN123/offer",
  }),
  signLinkMail({ name: "Amal <script>", document: "MOU", property: "Unit 1204", link, expiresOn: "2026-12-03" }),
  signReminderMail({ name: "Amal", document: "MOU", property: "Unit 1204", sentOn: "2026-11-19" }),
  signedCopyMail({ name: "Amal", document: "MOU", property: "Unit 1204" }),
  instalmentReminderMail({
    name: "Amal",
    property: "Unit 1204",
    label: "Second instalment",
    amountFils: 12_345_650,
    dueOn: "2026-12-01",
    phase: "before",
  }),
  instalmentReminderMail({
    name: "Amal",
    property: "Unit 1204",
    label: "Second instalment",
    amountFils: 12_345_650,
    dueOn: "2026-12-01",
    phase: "after",
  }),
];

describe("SPA mail templates (S54)", () => {
  test("subjects read {Action} · {Property}", () => {
    const [offer, sign, remind, copy, before, after] = all();
    expect(offer!.subject).toBe("Answer the offer · 2-bed apartment");
    expect(sign!.subject).toBe("Sign your MOU · Unit 1204");
    expect(remind!.subject).toBe("Reminder: sign your MOU · Unit 1204");
    expect(copy!.subject).toBe("Your signed MOU · Unit 1204");
    expect(before!.subject).toBe("Instalment due 1 December 2026 · Unit 1204");
    expect(after!.subject).toBe("Instalment overdue · Unit 1204");
  });
  test("the instalment reminder is fixed wording with the plan's amount and date, and no link", () => {
    const [before, after] = all().slice(4) as [ReturnType<typeof all>[number], ReturnType<typeof all>[number]];
    expect(before.template).toBe("instalment_reminder");
    expect(before.version).toBe(1);
    expect(before.text).toContain("Second instalment");
    expect(before.text).toContain("AED 123,456.50");
    expect(before.text).toContain("1 December 2026");
    expect(before.text).toMatch(/is due on/);
    expect(after.text).toMatch(/was due on/);
    expect(after.text).toMatch(/not (yet )?recorded/);
    for (const m of [before, after]) {
      expect(m.text).not.toMatch(/https?:\/\//);
      expect(m.html).not.toMatch(/https?:\/\//);
    }
  });
  test("every template has a version and names its template", () => {
    for (const m of all()) expect(MAIL_TEMPLATE_VERSIONS[m.template]).toBe(m.version);
  });
  test("the link is in the text and the html; a name is escaped in the html", () => {
    const sign = all()[1]!;
    expect(sign.text).toContain(link);
    expect(sign.html).toContain(`href="${link}"`);
    expect(sign.html).not.toContain("<script>");
    expect(sign.html).toContain("&lt;script&gt;");
  });
  test("the offer mail shows terms and never a buyer", () => {
    const o = all()[0]!;
    expect(o.text).toContain("AED 1,950,000");
    expect(o.text).toContain("22 November 2026");
  });
  test("the reminder carries no link (the token exists only in the first email)", () => {
    const r = all()[2]!;
    expect(r.text).not.toMatch(/https?:\/\//);
    expect(r.html).not.toMatch(/https?:\/\//);
  });
  test("no template mentions AML, screening or sanctions", () => {
    for (const m of all())
      for (const s of [m.subject, m.text, m.html])
        expect(s).not.toMatch(/\baml\b|launder|sanction|screening|\bpep\b|suspicio/i);
  });
});

describe("the gate alert mail (C23, S62)", () => {
  const m = gateAlertMail({
    text: "Prepared agreement for D-0007 has been waiting 30 hours.",
    dealRef: "D-0007",
    url: "https://spa.example.test/",
  });
  test("says only the alert's own sentence, with the deal ref in the subject and a link to the app", () => {
    expect(m.template).toBe("gate_alert");
    expect(m.version).toBe(MAIL_TEMPLATE_VERSIONS.gate_alert);
    expect(m.subject).toBe("Waiting for you · D-0007");
    expect(m.text).toContain("Prepared agreement for D-0007 has been waiting 30 hours.");
    expect(m.html).toContain('href="https://spa.example.test/"');
  });
  test("without a ref the subject is plain, and no word of a check or review appears", () => {
    const g = gateAlertMail({
      text: "A compliance review has been waiting 12 hours.",
      dealRef: null,
      url: "https://x.test/",
    });
    expect(g.subject).toBe("Waiting for you");
    expect(g.subject).not.toMatch(/aml|screen|sanction|compliance|risk/i);
  });
  test("the text is escaped in html", () => {
    expect(gateAlertMail({ text: "<b>x</b>", dealRef: null, url: "https://x.test/" }).html).not.toContain("<b>x</b>");
  });
});

describe("the buyer portal mails (C35, S67)", () => {
  const docs = documentsRequestMail({
    name: "Amal <b>",
    property: "Unit 1204",
    items: ["Passport", "Emirates ID"],
    link: "https://spa.example.test/b/TOK/documents",
    expiresOn: "2026-12-05",
  });
  const booked = transferBookedMail({
    name: "Amal",
    property: "Unit 1204",
    transferOn: "2026-12-20",
    link: "https://spa.example.test/b/V/status",
  });
  const registered = registeredMail({
    name: "Amal",
    property: "Unit 1204",
    link: "https://spa.example.test/b/V/status",
  });
  const withLink = instalmentReminderMail({
    name: "Amal",
    property: "Unit 1204",
    label: "Second",
    amountFils: 100,
    dueOn: "2026-12-01",
    phase: "before",
    link: "https://spa.example.test/b/V/status",
  });
  test("the documents request names what to upload, the expiry and the link, and escapes the name", () => {
    expect(docs.template).toBe("documents_request");
    expect(docs.subject).toBe("Upload your documents · Unit 1204");
    expect(docs.text).toContain("Passport");
    expect(docs.text).toContain("5 December 2026");
    expect(docs.text).toContain("https://spa.example.test/b/TOK/documents");
    expect(docs.html).not.toContain("<b>");
    expect(docs.version).toBe(MAIL_TEMPLATE_VERSIONS.documents_request);
  });
  test("transfer booked, registered and an instalment mail carry the view link", () => {
    expect(booked.subject).toBe("Transfer booked · Unit 1204");
    expect(booked.text).toContain("20 December 2026");
    expect(registered.subject).toBe("Registered · Unit 1204");
    for (const m of [booked, registered, withLink]) {
      expect(m.text).toContain("https://spa.example.test/b/V/status");
      expect(m.html).toContain('href="https://spa.example.test/b/V/status"');
      expect(MAIL_TEMPLATE_VERSIONS[m.template]).toBe(m.version);
    }
  });
  test("none mentions a check, a review or a risk", () => {
    for (const m of [docs, booked, registered, withLink])
      for (const t of [m.subject, m.text, m.html])
        expect(t).not.toMatch(/\baml\b|launder|sanction|screening|\bpep\b|suspicio|\brisk|flag|\bedd\b/i);
  });
});
