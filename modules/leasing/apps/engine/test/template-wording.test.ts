import { describe, expect, test } from "bun:test";
import { EMPTY_REVIEW, type TemplateSections } from "@leasing/helpers";
import { templateWordingProblems } from "../src/manager/company-templates.ts";

// Pure (no database): D70 template approval checks against the published rulebooks and the template's emirates.
const sections = (...paragraphs: string[]): TemplateSections => ({
  numbering: "none",
  title: "TENANCY CONTRACT",
  items: [{ id: "s1", number: null, heading: "TERMS", paragraphs }],
});

describe("templateWordingProblems (D70)", () => {
  test("any-emirate template with Dubai wording says to set the emirates to Dubai", () => {
    const out = templateWordingProblems(
      {
        sections: sections("Governed by Law No. 26 of 2007 and the Rental Disputes Centre in Dubai."),
        review: EMPTY_REVIEW,
      },
      [],
    );
    expect(out).toContain("This template cites Dubai law or authorities; set its emirates to Dubai.");
  });
  test("a Dubai template with Dubai wording and the rulebook's periods passes", () => {
    const out = templateWordingProblems(
      {
        sections: sections(
          "Governed by Law No. 26 of 2007.",
          "Any rent increase needs written notice 90 days before the term ends.",
          "The landlord may evict on 12 months' notice by notary public or registered mail.",
          "The deposit is returned within 30 days.",
        ),
        review: EMPTY_REVIEW,
      },
      ["dubai"],
    );
    expect(out).toEqual([]);
  });
  test("a period that differs from the Dubai rulebook blocks, a dropped paragraph does not", () => {
    const s = sections("Any rent increase needs written notice 60 days before the term ends.");
    const blocked = templateWordingProblems({ sections: s, review: EMPTY_REVIEW }, ["dubai"]);
    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toContain("90 days");
    const dropped = templateWordingProblems({ sections: s, review: { ...EMPTY_REVIEW, droppedParagraphs: ["s1:0"] } }, [
      "dubai",
    ]);
    expect(dropped).toEqual([]);
  });
  test("a paragraph that prints an edited company clause is checked as edited (60 → 90 clears it)", () => {
    const s = sections("Any rent increase needs written notice 60 days before the term ends.");
    const edited = templateWordingProblems({ sections: s, review: EMPTY_REVIEW }, ["dubai"], {
      "s1:0": "Any rent increase needs written notice 90 days before the term ends.",
    });
    expect(edited).toEqual([]);
    const stillSixty = templateWordingProblems({ sections: s, review: EMPTY_REVIEW }, ["dubai"], {
      "s1:0": "Any rent increase needs written notice 60 days before the term ends.",
    });
    expect(stillSixty.length).toBe(1);
    // A linked clause that is not printed (removed or not approved) is not checked.
    expect(templateWordingProblems({ sections: s, review: EMPTY_REVIEW }, ["dubai"], { "s1:0": null })).toEqual([]);
  });
});
// To run with the engine suite: contracts.test.ts should also gain a case where a template paragraph holds
// "DEMO-DLD-000017" (another unit's number) and the prepared contract ends needs_human with a `sample_values` reason.
