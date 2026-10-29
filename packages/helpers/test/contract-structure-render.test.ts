import { describe, expect, test } from "bun:test";
import {
  approvalProblems,
  approvalWarnings,
  DEFAULT_STYLE,
  EMPTY_REVIEW,
  effectiveStyle,
  formatCalendarDate,
  formatField,
  formatMoneyFils,
  LAW_SECTION_HEADING,
  nextSectionNumber,
  REQUIRED_TERMS,
  unprintable,
  SAMPLE_CONTRACT_FIELDS,
  type TemplateBlank,
  type TemplateSections,
  templateContractBlocks,
} from "../src/index.ts";

const blank = (
  id: string,
  label: string,
  field: TemplateBlank["field"],
  before: string,
  over: Partial<TemplateBlank> = {},
): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____",
  label,
  field,
  fieldType: null,
  role: "field",
  sectionIndex: 0,
  before,
  after: "",
  ...over,
});

const sections: TemplateSections = {
  numbering: "article",
  title: "RESIDENTIAL TENANCY AGREEMENT",
  items: [
    { id: "s0", number: null, heading: null, paragraphs: ["Made between {{b1}} (Landlord) and {{b2}} (Tenant)."] },
    {
      id: "s1",
      number: "Article I",
      heading: "Rent",
      paragraphs: ["The annual rent is {{b3}}.", "The term starts on {{b4}}."],
    },
    { id: "s2", number: "Article II", heading: "Signing", paragraphs: ["Landlord: {{b5}}", "Tenant: {{b6}}"] },
  ],
};
const blanks = (): TemplateBlank[] => [
  blank("b1", "Landlord name", "landlordNameEn", "Made between "),
  blank("b2", "Tenant name", "tenantNameEn", "(Landlord) and "),
  blank("b3", "Annual rent", "annualRentFils", "The annual rent is "),
  blank("b4", "Start date", "startOn", "The term starts on "),
  blank("b5", "Landlord signature", "unmapped", "Landlord: ", { role: "signature" }),
  blank("b6", "Tenant signature", "unmapped", "Tenant: ", { role: "signature" }),
];
const opts = { version: 2, reference: "C-TEST", demo: false };
const input = (b = blanks()) => ({ sections, blanks: b, templateVersion: 3 });
const textOf = (bl: { kind: string; text?: string; items?: string[]; label?: string }[]) =>
  bl.map((b) => b.text ?? b.label ?? (b.items ?? []).join(" ")).join("\n");

describe("formatting by code", () => {
  test("money prints whole dirhams without fils", () => {
    expect(formatMoneyFils(8_500_000)).toBe("AED 85,000");
    expect(formatMoneyFils(8_500_050)).toBe("AED 85,000.50");
    expect(formatMoneyFils(0)).toBe("AED 0");
  });
  test("dates print as calendar dates, a bad one is refused", () => {
    expect(formatCalendarDate("2027-03-05")).toBe("5 March 2027");
    expect(formatCalendarDate("2027-13-05")).toBeNull();
    expect(formatCalendarDate("05/03/2027")).toBeNull();
  });
  test("a null field has no value; names print exactly", () => {
    expect(formatField("tenantPassportNo", { ...SAMPLE_CONTRACT_FIELDS, tenantPassportNo: null })).toBeNull();
    expect(formatField("tenantNameEn", { ...SAMPLE_CONTRACT_FIELDS, tenantNameEn: "LENA  Testova" })).toBe(
      "LENA  Testova",
    );
    expect(formatField("cheques", SAMPLE_CONTRACT_FIELDS)).toBe("4");
  });
});

describe("rendering a company template", () => {
  test("every blank is filled from contract fields; signature blanks become signature lines", () => {
    const r = templateContractBlocks(input(), SAMPLE_CONTRACT_FIELDS, { clauses: [], freeText: null }, opts);
    const text = textOf(r.blocks);
    expect(text).toContain("Made between Sample Landlord LLC (Landlord) and Sample Tenant (Tenant).");
    expect(text).toContain("The annual rent is AED 85,000.");
    expect(text).toContain("The term starts on 1 January 2027.");
    expect(text).not.toMatch(/\{\{|_{3}/);
    expect(r.blocks.filter((b) => b.kind === "sigline").map((b) => (b as { label: string }).label)).toEqual([
      "Landlord",
      "Tenant",
    ]);
    // Headings keep the template's numbering and wording.
    expect(r.blocks.filter((b) => b.kind === "heading").map((b) => (b as { text: string }).text)).toContain(
      "Article I Rent",
    );
    expect(r.blocks[0]).toEqual({ kind: "title", text: "RESIDENTIAL TENANCY AGREEMENT" });
  });

  test("optional values with no data, empty choices and unusable mappings print as empty lines, with a list", () => {
    const b = blanks();
    b[2] = blank("b3", "Annual rent", "tenantPassportNo", "The annual rent is "); // wrong type: left empty, not used
    b[3] = blank("b4", "Start date", "unmapped", "The term starts on ");
    const r = templateContractBlocks(
      input(b),
      { ...SAMPLE_CONTRACT_FIELDS, tenantPassportNo: null },
      { clauses: [], freeText: null },
      opts,
    );
    const text = textOf(r.blocks);
    expect(text).toContain("The annual rent is ____.");
    expect(text).toContain("The term starts on ____.");
    expect(r.leftEmpty).toEqual(["Annual rent", "Start date"]);
  });

  test("a blank mapped to leave_empty or to data we have no value for keeps its underscores", () => {
    const b = blanks();
    b[0] = blank("b1", "Landlord nationality", "landlordNationality", "Made between ", { marker: "________" });
    b[1] = blank("b2", "Tenant representative", "leave_empty", "(Landlord) and ", { marker: "[ ]" });
    const r = templateContractBlocks(
      input(b),
      { ...SAMPLE_CONTRACT_FIELDS, landlordNationality: null },
      { clauses: [], freeText: null },
      opts,
    );
    expect(textOf(r.blocks)).toContain("Made between ________ (Landlord) and [ ] (Tenant).");
    expect(r.leftEmpty).toEqual(["Landlord nationality", "Tenant representative"]);
    expect(r.filled.map((f) => f.key)).toEqual(["annualRentFils", "startOn"]);
  });

  test("a legal or money core field with no value blocks with a clear message", () => {
    for (const [field, label, key] of [
      ["annualRentFils", "Annual rent", "annualRentFils"],
      ["startOn", "Start date", "startOn"],
      ["endOn", "End date", "endOn"],
      ["depositFils", "Security deposit", "depositFils"],
      ["cheques", "Cheques", "cheques"],
      ["landlordNameEn", "Landlord name", "landlordNameEn"],
      ["tenantNameEn", "Tenant name", "tenantNameEn"],
      ["unitNo", "Unit", "unitNo"],
      ["dldPropertyNo", "Property number", "dldPropertyNo"],
      ["tenancyPeriod", "Tenancy period", "tenancyPeriod"],
    ] as const) {
      const b = blanks();
      b[0] = blank("b1", label, field, "Made between ");
      expect(() =>
        templateContractBlocks(
          input(b),
          { ...SAMPLE_CONTRACT_FIELDS, [key]: null },
          { clauses: [], freeText: null },
          {
            ...opts,
            extras: { tenancyPeriod: null },
          },
        ),
      ).toThrow("No value for");
    }
  });

  test("absent-by-nature keys print a neutral word; a missing move-in date blocks", () => {
    const b = blanks();
    b[0] = blank("b1", "Rent-free days", "rentFreeDays", "Made between ");
    b[1] = blank("b2", "Reservation", "reservationFils", "(Landlord) and ");
    const r = templateContractBlocks(
      input(b),
      { ...SAMPLE_CONTRACT_FIELDS, rentFreeDays: 0 },
      { clauses: [], freeText: null },
      {
        ...opts,
        extras: { reservationFils: null },
      },
    );
    expect(textOf(r.blocks)).toContain("Made between 0 (Landlord) and None (Tenant).");
    expect(r.leftEmpty).toEqual([]);
    const m = blanks();
    m[0] = blank("b1", "Move-in date", "moveInOn", "Made between ");
    expect(() =>
      templateContractBlocks(
        input(m),
        { ...SAMPLE_CONTRACT_FIELDS, moveInOn: null as never },
        { clauses: [], freeText: null },
        opts,
      ),
    ).toThrow("No value for Move-in date");
  });

  test("extra data-sheet keys (tenancy period, DEWA number) are copied from the extras", () => {
    const b = blanks();
    b[0] = blank("b1", "Tenancy period", "tenancyPeriod", "Made between ");
    b[1] = blank("b2", "DEWA premises", "dewaPremiseNo", "(Landlord) and ");
    const r = templateContractBlocks(
      input(b),
      SAMPLE_CONTRACT_FIELDS,
      { clauses: [], freeText: null },
      {
        ...opts,
        extras: { tenancyPeriod: "1 January 2027 to 31 December 2027", dewaPremiseNo: "123-456" },
      },
    );
    expect(textOf(r.blocks)).toContain(
      "Made between 1 January 2027 to 31 December 2027 (Landlord) and 123-456 (Tenant).",
    );
  });

  test("a token the template never defined fails", () => {
    const s: TemplateSections = {
      ...sections,
      items: [{ id: "s0", number: null, heading: null, paragraphs: ["{{b99}}"] }],
    };
    expect(() =>
      templateContractBlocks(
        { sections: s, blanks: blanks(), templateVersion: 1 },
        SAMPLE_CONTRACT_FIELDS,
        { clauses: [], freeText: null },
        opts,
      ),
    ).toThrow("b99");
  });

  test("terms the template lacks are appended under the law heading, numbered in its style", () => {
    const r = templateContractBlocks(input(), SAMPLE_CONTRACT_FIELDS, { clauses: [], freeText: null }, opts);
    const headings = r.blocks.filter((b) => b.kind === "heading").map((b) => (b as { text: string }).text);
    expect(headings.at(-1)).toBe(`Article III ${LAW_SECTION_HEADING}`);
    const text = textOf(r.blocks);
    expect(text).toContain("registered in Ejari");
    // All three required terms are appended; two signature blanks exist, so no extra signature lines.
    expect(text).toContain(REQUIRED_TERMS.rentChange);
    expect(text).toContain(REQUIRED_TERMS.signatures);
    expect(r.blocks.filter((b) => b.kind === "sigline")).toHaveLength(2);
  });

  test("a template that has the exact standard sentences (any case or spacing) gets no law section", () => {
    const full: TemplateSections = {
      numbering: "none",
      title: null,
      items: [
        {
          id: "s0",
          number: null,
          heading: null,
          paragraphs: [
            REQUIRED_TERMS.rentChange.toUpperCase(),
            REQUIRED_TERMS.ejari.replace(/ /g, "  "),
            REQUIRED_TERMS.signatures,
            "Landlord: {{b5}}",
            "Tenant: {{b6}}",
          ],
        },
      ],
    };
    const r = templateContractBlocks(
      { sections: full, blanks: blanks(), templateVersion: 1 },
      SAMPLE_CONTRACT_FIELDS,
      { clauses: [], freeText: null },
      opts,
    );
    expect(textOf(r.blocks)).not.toContain(LAW_SECTION_HEADING);
    const noSig = templateContractBlocks(
      {
        sections: { ...full, items: [{ ...full.items[0]!, paragraphs: full.items[0]!.paragraphs.slice(0, 3) }] },
        blanks: blanks().filter((b) => b.role === "field"),
        templateVersion: 1,
      },
      SAMPLE_CONTRACT_FIELDS,
      { clauses: [], freeText: null },
      opts,
    ).blocks.filter((b) => b.kind === "sigline");
    expect(noSig).toHaveLength(2);
  });

  test("an 'Ejari fee' mention or an unrelated 'notice' in a rent paragraph does not stand in for the terms", () => {
    const tricky: TemplateSections = {
      numbering: "none",
      title: null,
      items: [
        {
          id: "s0",
          number: null,
          heading: null,
          paragraphs: [
            "The tenant pays the Ejari fee.",
            "Rent is due on the first day; a notice of arrears may be sent. Landlord: {{b5}} Tenant: {{b6}}",
          ],
        },
      ],
    };
    const text = textOf(
      templateContractBlocks(
        { sections: tricky, blanks: blanks(), templateVersion: 1 },
        SAMPLE_CONTRACT_FIELDS,
        { clauses: [], freeText: null },
        opts,
      ).blocks,
    );
    expect(text).toContain(REQUIRED_TERMS.rentChange);
    expect(text).toContain(REQUIRED_TERMS.ejari);
    expect(text).toContain(REQUIRED_TERMS.signatures);
  });

  test("text outside WinAnsi is detected; a value that can't be printed fails the render", () => {
    expect(unprintable("Plain, with \u2019 and \u2013 and caf\u00e9")).toBe(false);
    expect(unprintable("\u0645\u062d\u0645\u062f")).toBe(true);
    expect(() =>
      templateContractBlocks(
        input(),
        { ...SAMPLE_CONTRACT_FIELDS, tenantNameEn: "\u0645\u062d\u0645\u062f" },
        { clauses: [], freeText: null },
        opts,
      ),
    ).toThrow("can't be printed");
  });

  test("enum values print as capitalised words", () => {
    expect(formatField("tenantKind", SAMPLE_CONTRACT_FIELDS)).toBe("Individual");
    expect(formatField("propertyUsage", SAMPLE_CONTRACT_FIELDS)).toBe("Residential");
  });

  test("company clauses follow the template; the footer line says Company template v<N>", () => {
    const r = templateContractBlocks(
      input(),
      SAMPLE_CONTRACT_FIELDS,
      {
        clauses: ["no_pets", "cc:11111111-1111-4111-8111-111111111111"],
        companyClauses: [
          { id: "11111111-1111-4111-8111-111111111111", title: "Balcony", text: "Keep it clear.", category: "other" },
        ],
        freeText: null,
      },
      { ...opts, demo: true },
    );
    const text = textOf(r.blocks);
    expect(text).toContain("Balcony: Keep it clear.");
    expect(text).toContain("Company template v3");
    expect(text).toContain("fictional");
  });

  test("numbering of the next section follows the style", () => {
    expect(nextSectionNumber("article", "Article II", 2)).toBe("Article III");
    expect(nextSectionNumber("article", "Article 2", 2)).toBe("Article 3");
    expect(nextSectionNumber("clause", "Clause 4", 4)).toBe("Clause 5");
    expect(nextSectionNumber("roman", "II.", 2)).toBe("III.");
    expect(nextSectionNumber("decimal", "2.", 2)).toBe("3.");
    expect(nextSectionNumber("alpha", "B.", 2)).toBe("C.");
    expect(nextSectionNumber("none", null, 0)).toBeNull();
  });
});

describe("approval problems", () => {
  const style = { ...DEFAULT_STYLE };
  test("leave_empty and unmapped are approvable; a wrong-type or unknown mapping still blocks; signatures do not", () => {
    const b = blanks();
    expect(approvalProblems({ blanks: b, style, logoDocumentId: null }, EMPTY_REVIEW)).toEqual([]);
    b[3] = blank("b4", "Start date", "leave_empty", "The term starts on ");
    expect(approvalProblems({ blanks: b, style, logoDocumentId: null }, EMPTY_REVIEW)).toEqual([]);
    b[3] = blank("b4", "Start date", "unmapped", "The term starts on ");
    expect(approvalProblems({ blanks: b, style, logoDocumentId: null }, EMPTY_REVIEW)).toEqual([]);
    b[3] = blank("b4", "Start date", "notAKey", "The term starts on ");
    b[2] = blank("b3", "Annual rent", "startOn", "The annual rent is ");
    const p = approvalProblems({ blanks: b, style, logoDocumentId: null }, EMPTY_REVIEW);
    expect(p).toHaveLength(2);
    expect(p.join(" ")).toContain("not a data field");
    expect(p.join(" ")).toContain("asks for money_fils");
  });

  test("authority marks need the flagged parts dropped; a kept logo needs the confirmation", () => {
    const flagged = {
      ...style,
      accentColour: "#336699",
      flags: {
        authorityMarks: true,
        areas: ["header", "footer", "logo_area"] as ("header" | "footer" | "logo_area")[],
      },
    };
    const t = { blanks: blanks(), style: flagged, logoDocumentId: "doc" };
    expect(approvalProblems(t, EMPTY_REVIEW)).toHaveLength(4);
    expect(approvalProblems(t, { ...EMPTY_REVIEW, dropHeader: true, dropFooter: true })).toHaveLength(2);
    // Dropping the logo clears both the mark and the confirmation problem.
    expect(approvalProblems(t, { ...EMPTY_REVIEW, dropHeader: true, dropFooter: true, dropLogo: true })).toEqual([]);
    // An unflagged logo only needs the confirmation.
    const plain = { blanks: blanks(), style, logoDocumentId: "doc" };
    expect(approvalProblems(plain, EMPTY_REVIEW)).toHaveLength(1);
    expect(approvalProblems(plain, { ...EMPTY_REVIEW, logoConfirmed: true })).toEqual([]);
  });

  test("text the PDF fonts can't print blocks approval (wording, header, footer)", () => {
    const t = { blanks: blanks(), style, logoDocumentId: null };
    const arabic = "\u0627\u0644\u0625\u064a\u062c\u0627\u0631";
    const bad = { ...sections, items: [{ ...sections.items[0]!, paragraphs: [arabic] }] };
    expect(approvalProblems({ ...t, sections: bad }, EMPTY_REVIEW).join(" ")).toContain("can't print");
    expect(approvalProblems({ ...t, sections }, { ...EMPTY_REVIEW, valuesConfirmed: ["s1:0"] })).toEqual([]);
    expect(approvalProblems({ ...t, style: { ...style, header: arabic } }, EMPTY_REVIEW)).toHaveLength(1);
    expect(approvalProblems({ ...t, style: { ...style, footer: arabic } }, EMPTY_REVIEW)).toHaveLength(1);
  });

  test("authority marks with no named area need the admin's tick", () => {
    const t = {
      blanks: blanks(),
      style: { ...style, flags: { authorityMarks: true, areas: [] } },
      logoDocumentId: null,
    };
    expect(approvalProblems(t, EMPTY_REVIEW).join(" ")).toContain("Authority marks");
    expect(approvalProblems(t, { ...EMPTY_REVIEW, authorityChecked: true })).toEqual([]);
  });

  describe("wording checks (rules 1 and 9)", () => {
    const withText = (paragraphs: string[], heading: string | null = "Terms"): TemplateSections => ({
      numbering: "article",
      title: null,
      items: [{ id: "s9", number: null, heading, paragraphs }],
    });
    const check = (sec: TemplateSections, review = EMPTY_REVIEW) =>
      approvalProblems({ blanks: [], style, logoDocumentId: null, sections: sec }, review);

    test("a paragraph with a period, number, date or amount blocks until confirmed", () => {
      for (const text of [
        "The tenant pays within 5 days.",
        "Payment is due monthly.",
        "Starting 1 March the tenant pays.",
      ]) {
        const sec = withText([text]);
        expect(check(sec).join(" ")).toContain("Confirm the numbers");
        expect(check(sec, { ...EMPTY_REVIEW, valuesConfirmed: ["s9:0"] })).toEqual([]);
      }
      expect(check(withText(["The tenant keeps the unit clean and tidy."]))).toEqual([]);
    });

    test("a value in a heading needs its own confirmation; blank tokens are not values", () => {
      expect(check(withText(["Pays {{b1}}."], "Payment within 30 days")).join(" ")).toContain("Confirm the numbers");
      expect(check(withText(["Pays {{b1}} to the landlord."]))).toEqual([]);
      expect(check(withText(["x 2 y"]), { ...EMPTY_REVIEW, valuesConfirmed: ["other"] })).not.toEqual([]);
    });

    test("rent change or a notice period in days warns but never blocks", () => {
      const sec = withText(["The landlord may increase the rent at renewal.", "Notice of ninety days is required."]);
      const confirmed = { ...EMPTY_REVIEW, valuesConfirmed: ["s9:1"] };
      expect(check(sec, confirmed)).toEqual([]);
      const w = approvalWarnings({ sections: sec });
      expect(w).toHaveLength(2);
      expect(w[0]).toContain("Check against the required terms; confirm with legal");
      expect(approvalWarnings({ sections: withText(["Keep the unit tidy."]) })).toEqual([]);
    });

    test("authority marks in the body need a neutral-reference confirmation per paragraph", () => {
      const sec = withText(["The tenancy is registered with Ejari by the landlord.", "Other text."]);
      expect(check(sec).join(" ")).toContain("neutral reference, not branding");
      expect(check(sec, { ...EMPTY_REVIEW, authorityBodyConfirmed: ["s9:0"] })).toEqual([]);
      const title: TemplateSections = { ...sec, title: "Dubai Land Department Agreement" };
      expect(check(title, { ...EMPTY_REVIEW, authorityBodyConfirmed: ["s9:0"] }).join(" ")).toContain("neutral");
      expect(check(title, { ...EMPTY_REVIEW, authorityBodyConfirmed: ["s9:0", "title"] })).toEqual([]);
    });

    test("header and footer hits still block until dropped, and confirming the body does not help", () => {
      const sec = withText(["Registered with Ejari."]);
      const t = {
        blanks: [],
        style: { ...style, header: "Dubai Land Department", footer: "RERA" },
        logoDocumentId: null,
        sections: sec,
      };
      const ok = { ...EMPTY_REVIEW, authorityBodyConfirmed: ["s9:0"] };
      const p = approvalProblems(t, ok).join(" ");
      expect(p).toContain("header carries");
      expect(p).toContain("footer carries");
      expect(approvalProblems(t, { ...ok, dropHeader: true, dropFooter: true })).toEqual([]);
    });
  });

  test("the effective style drops what was dropped and uses the neutral accent for flagged samples", () => {
    const s = {
      ...style,
      header: "Acme Realty",
      footer: "Page {page}",
      accentColour: "#336699",
      flags: { authorityMarks: true, areas: ["logo_area" as const] },
    };
    const e = effectiveStyle(s, { ...EMPTY_REVIEW, dropHeader: true, dropLogo: true }, "doc");
    expect(e.style.header).toBeNull();
    expect(e.style.footer).toBe("Page {page}");
    expect(e.style.accentColour).toBeNull();
    expect(e.logoDocumentId).toBeNull();
    expect(effectiveStyle({ ...s, flags: { authorityMarks: false, areas: [] } }, EMPTY_REVIEW, "doc")).toMatchObject({
      style: { accentColour: "#336699" },
      logoDocumentId: "doc",
    });
  });
});
