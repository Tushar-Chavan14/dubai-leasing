import { createHash } from "node:crypto";
import { describe, expect, test } from "bun:test";
import { CHASE_REASON_CODES, CHASE_REASONS } from "@spa/core";
import { chaseBodyHash, fillChaseMail } from "../src/mail/index.ts";

const TEMPLATE = {
  version: 3,
  subject: "Documents needed · {property}",
  body: "Dear {party_name},\nFor {property} we still need:\n{items}\nQuestions? Write to {agent_name} ({agent_email}) at {company_name}.",
};
const VALUES = {
  partyName: "Sample Buyer",
  property: "Unit U-101",
  agentName: "Sample Agent",
  agentEmail: "agent@example.test",
  companyName: "Fictional Developments LLC",
  items: [
    { label: "Passport data page", reason: "passport_expired" as const },
    { label: "Proof of address", reason: "document_missing" as const },
  ],
};

describe("chase mail (C25, S60): fixed wording filled by code", () => {
  test("every placeholder is filled by code; the reasons come from the fixed list", () => {
    const m = fillChaseMail(TEMPLATE, VALUES);
    expect(m.template).toBe("chase");
    expect(m.version).toBe(3);
    expect(m.subject).toBe("Documents needed · Unit U-101");
    expect(m.text).toContain("Dear Sample Buyer,");
    expect(m.text).toContain("- Passport data page: passport expired");
    expect(m.text).toContain("- Proof of address: document not received yet");
    expect(m.text).toContain("Sample Agent (agent@example.test) at Fictional Developments LLC.");
    expect(m.text).not.toMatch(/\{[a-z_]+\}/);
    expect(m.html).not.toMatch(/\{[a-z_]+\}/);
  });

  test("a neutral item reads only 'Additional documents needed': no document name, no original reason", () => {
    const m = fillChaseMail(TEMPLATE, {
      ...VALUES,
      items: [{ label: "Source of funds evidence", reason: "additional_documents" }],
    });
    expect(m.text).toContain("- Additional documents needed");
    expect(m.text).not.toContain("Source of funds");
  });

  test("no reason code gives a mail that names a review, a screening or AML", () => {
    for (const reason of CHASE_REASON_CODES) {
      const m = fillChaseMail(TEMPLATE, { ...VALUES, items: [{ label: "A document", reason }] });
      expect(`${m.subject} ${m.text} ${m.html}`).not.toMatch(
        /\baml\b|launder|sanction|screening|\bpep\b|\bedd\b|suspicious|compliance/i,
      );
      expect(m.text).toContain(CHASE_REASONS[reason]);
    }
  });

  test("a value can't smuggle a placeholder in: filling is one pass", () => {
    const m = fillChaseMail(TEMPLATE, { ...VALUES, partyName: "{items}" });
    expect(m.text).toContain("Dear {items},");
    expect(m.text.match(/Passport data page/g)).toHaveLength(1);
  });

  test("html is escaped", () => {
    const m = fillChaseMail(TEMPLATE, { ...VALUES, partyName: "<b>Sample</b> & Co" });
    expect(m.html).toContain("&lt;b&gt;Sample&lt;/b&gt; &amp; Co");
    expect(m.html).not.toContain("<b>Sample");
  });

  test("a stored template with a placeholder code can't fill is refused, not sent half filled", () => {
    expect(() => fillChaseMail({ ...TEMPLATE, body: `${TEMPLATE.body} {hit_list}` }, VALUES)).toThrow(/hit_list/);
  });

  test("the body hash is the one the outbound row keeps: sha256 of text, a newline, then html", () => {
    const m = fillChaseMail(TEMPLATE, VALUES);
    expect(chaseBodyHash(m)).toBe(createHash("sha256").update(`${m.text}\n${m.html}`).digest("hex"));
    expect(chaseBodyHash(fillChaseMail(TEMPLATE, { ...VALUES, partyName: "Other" }))).not.toBe(chaseBodyHash(m));
  });
});
