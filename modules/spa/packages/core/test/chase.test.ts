import { describe, expect, test } from "bun:test";
import {
  CHASE_ALLOWED_PLACEHOLDERS,
  CHASE_REASON_CODES,
  CHASE_REASONS,
  chaseTemplateProblems,
  neutralChaseReason,
} from "../src/index.ts";

const GOOD = {
  subject: "Documents needed · {property}",
  body: "Dear {party_name},\nFor {property} we still need:\n{items}\nContact {agent_name} at {agent_email}.\n{company_name}",
};

describe("C25 chase templates and reasons (S23, S60)", () => {
  test("the reason codes are a fixed list and no reason names a review, a screening or AML", () => {
    expect([...CHASE_REASON_CODES] as string[]).toEqual(Object.keys(CHASE_REASONS));
    expect(CHASE_REASONS.passport_expired).toBe("passport expired");
    expect(CHASE_REASONS.photo_unreadable).toBe("photo unreadable");
    expect(CHASE_REASONS.name_differs_title_deed).toBe("name differs from the title deed");
    expect(CHASE_REASONS.additional_documents).toBe("Additional documents needed");
    for (const text of Object.values(CHASE_REASONS))
      expect(text).not.toMatch(/\baml\b|launder|sanction|screening|\bpep\b|\bedd\b|suspicious|compliance/i);
  });

  test("any compliance-originated item maps to additional_documents and the original reason is never passed on", () => {
    expect(neutralChaseReason()).toBe("additional_documents");
    expect(neutralChaseReason.length).toBe(0);
  });

  test("a good template passes and the six placeholders are the only ones", () => {
    expect([...CHASE_ALLOWED_PLACEHOLDERS]).toEqual([
      "party_name",
      "property",
      "items",
      "agent_name",
      "agent_email",
      "company_name",
    ]);
    expect(chaseTemplateProblems(GOOD)).toEqual([]);
  });

  test("risk, flag, report, review and hold (and their endings) are banned too (S60 amendment)", () => {
    for (const w of [
      "risk",
      "risks",
      "flag",
      "flagged",
      "report",
      "reported",
      "reporting",
      "review",
      "reviewed",
      "hold",
      "on hold",
      "holding",
    ])
      expect(chaseTemplateProblems({ ...GOOD, body: `${GOOD.body}\nThis is a ${w} matter.` }).join(" ")).toMatch(
        /may never use/,
      );
    // Ordinary words that merely contain them are fine.
    expect(chaseTemplateProblems({ ...GOOD, body: `${GOOD.body}\nThe householder and the reportage.` })).toEqual([]);
  });

  test("an unknown placeholder is refused", () => {
    expect(chaseTemplateProblems({ ...GOOD, body: `${GOOD.body}\n{hit_list}` }).join(" ")).toMatch(/hit_list/);
    expect(chaseTemplateProblems({ ...GOOD, subject: "Hello {name}" }).join(" ")).toMatch(/name/);
  });

  test("a banned AML word in the subject or the body is refused", () => {
    for (const w of [
      "AML",
      "anti money laundering",
      "sanctions",
      "Screening",
      "PEP",
      "EDD",
      "suspicious",
      "compliance flag",
      "compliance review",
    ]) {
      expect(chaseTemplateProblems({ ...GOOD, body: `${GOOD.body}\nWe need this for ${w} reasons.` })).not.toEqual([]);
      expect(chaseTemplateProblems({ ...GOOD, subject: `Needed for ${w}` })).not.toEqual([]);
    }
    // a word that merely contains one is fine
    expect(chaseTemplateProblems({ ...GOOD, body: `${GOOD.body}\nPlease keep the pepper receipt.` })).toEqual([]);
  });

  test("the body must hold {items}; subject and body have length limits and may not be empty", () => {
    expect(chaseTemplateProblems({ ...GOOD, body: "Dear {party_name}, please send documents." }).join(" ")).toMatch(
      /items/,
    );
    expect(chaseTemplateProblems({ subject: "", body: GOOD.body })).not.toEqual([]);
    expect(chaseTemplateProblems({ subject: "x".repeat(200), body: GOOD.body })).not.toEqual([]);
    expect(chaseTemplateProblems({ subject: GOOD.subject, body: `{items}${"y".repeat(4100)}` })).not.toEqual([]);
  });
});
