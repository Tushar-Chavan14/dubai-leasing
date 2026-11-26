import { describe, expect, test } from "bun:test";
import {
  approvalProblems,
  DEFAULT_STYLE,
  detectBlanks,
  detectFilledValues,
  EMPTY_REVIEW,
  fixedValueKinds,
  validateMapping,
  type TemplateSections,
} from "../src/index.ts";

// A FILLED contract as a company might upload it: fictional people and numbers.
const FILLED = [
  "RESIDENTIAL TENANCY CONTRACT",
  "Contract No.: TC-2026-004871 | Date of Contract: 01 November 2026",
  "1. PARTIES",
  "Landlord (Owner)",
  "Owner Name Ahmed Khalid Al Mansoori Emirates ID 784-1980-1234567-1 Nationality United Arab Emirates Phone / Email +971 50 123 4567 / landlord@example.com",
  "Tenant",
  "Tenant Name",
  "Rahul Sharma",
  "Emirates ID",
  "784-1992-7654321-3",
  "Nationality / Passport No. India / Z1234567",
  "Phone / Email +971 55 987 6543 / tenant@example.com",
  "Occupants 2 adults (Tenant and spouse)",
  "3. LEASE TERMS",
  "Start Date 01 November 2026 End Date 31 October 2027 Annual Rent AED 120,000",
  "4. TERMS",
  "The Tenant shall pay all telephone charges and keep the area clean.",
  "5. DECLARATIONS",
  "LANDLORD TENANT Name: Ahmed Khalid Al Mansoori Name: Rahul Sharma Signature: ____ Signature: ____ Date: __ / __ / ____",
];

const run = () => {
  const d = detectBlanks(FILLED.join("\n"));
  const f = detectFilledValues(d.lines, d.blanks.length ? Math.max(...d.blanks.map((b) => Number(b.id.slice(1)))) : 0);
  return { text: f.lines.join("\n"), blanks: [...d.blanks, ...f.blanks], filled: f.blanks };
};

describe("a filled sample: people, numbers and dates become blanks", () => {
  test("no personal data or specific value is left in the wording", () => {
    const { text } = run();
    for (const gone of [
      "Ahmed",
      "Rahul",
      "784-",
      "Z1234567",
      "+971",
      "@example.com",
      "TC-2026",
      "01 November 2026",
      "120,000",
      "United Arab Emirates",
    ])
      expect(text).not.toContain(gone);
  });

  test("known labels get a proposed field by code, by party", () => {
    const { filled } = run();
    const byLabel = (l: string) => filled.filter((b) => b.fixedLabel === l).map((b) => b.proposedField);
    expect(byLabel("Landlord name")).toEqual(["landlordNameEn", "landlordNameEn"]);
    expect(byLabel("Tenant name")).toEqual(["tenantNameEn", "tenantNameEn"]);
    expect(byLabel("Landlord Emirates ID")).toEqual(["landlordIdNo"]);
    expect(byLabel("Tenant Emirates ID")).toEqual(["tenantEmiratesIdNo"]);
    expect(byLabel("Landlord Email")).toEqual(["landlordEmail"]);
    expect(byLabel("Tenant Email")).toEqual(["tenantEmail"]);
    expect(byLabel("Tenant Phone")).toEqual(["tenantPhone"]);
    expect(byLabel("Tenant Passport")).toEqual(["tenantPassportNo"]);
    expect(byLabel("Contract number")).toEqual(["leaseRef"]);
    expect(byLabel("Start date")).toEqual(["startOn"]);
    expect(byLabel("End date")).toEqual(["endOn"]);
    expect(byLabel("Annual rent")).toEqual(["annualRentFils"]);
    // No contract field for these: the admin must drop the line or map them.
    expect(byLabel("Occupants")).toEqual(["unmapped"]);
    expect(byLabel("Date of contract")).toEqual(["unmapped"]);
  });

  test("proposed fields pass the type check; prose that contains a label word is left alone", () => {
    const { text, filled } = run();
    for (const b of filled.filter((x) => x.proposedField && x.proposedField !== "unmapped")) {
      expect(validateMapping(b.proposedField, b.fixedLabel!, b).field).toBe(b.proposedField!);
    }
    expect(text).toContain("The Tenant shall pay all telephone charges and keep the area clean.");
  });

  test("a date written in three parts is one blank", () => {
    const d = detectBlanks("Date: ____ / ____ / ________");
    expect(d.blanks).toHaveLength(1);
    expect(d.lines[0]).toBe("Date: {{b1}}");
  });

  test("a filled value with an unknown label still becomes a blank by pattern", () => {
    const f = detectFilledValues(["Broker card 784-1980-1234567-1 issued 03 March 2024"], 0);
    expect(f.lines[0]).not.toMatch(/784|2024/);
    expect(f.blanks).toHaveLength(2);
    expect(f.blanks.every((b) => b.proposedField === undefined)).toBe(true);
  });
});

describe("approval is blocked while specific values are fixed wording", () => {
  const sections = (paragraphs: string[]): TemplateSections => ({
    numbering: "decimal",
    title: null,
    items: [{ id: "s1", number: "1.", heading: "PARTIES", paragraphs }],
  });
  const problems = (paragraphs: string[], review = EMPTY_REVIEW) =>
    approvalProblems(
      { blanks: [], style: DEFAULT_STYLE, logoDocumentId: null, sections: sections(paragraphs) },
      review,
    );

  for (const [what, text] of [
    ["an Emirates ID", "Owner 784-1980-1234567-1."],
    ["a passport number", "Passport Z1234567."],
    ["a phone number", "Call +971 50 123 4567."],
    ["an email address", "Write to landlord@example.com."],
    ["an AED amount", "Rent is AED 120,000."],
    ["an AED amount", "Rent is 5,000 dirhams."],
    ["an AED amount", "Rent is five thousand dirhams."],
    ["an AED amount", "Rent is AED five thousand."],
    ["a date", "Signed on 01 November 2026."],
    ["a contract number", "Contract TC-2026-004871."],
  ] as const) {
    test(`${what} can't be confirmed as wording`, () => {
      const confirmed = { ...EMPTY_REVIEW, valuesConfirmed: ["s1:0"] };
      expect(problems([text], confirmed).join(" ")).toContain(`contains ${what}`);
    });
  }

  test("dropping the line clears the block; the sample's own disclaimer needs dropping too", () => {
    const text = "Rent is AED 120,000.";
    expect(problems([text])).not.toEqual([]);
    expect(problems([text], { ...EMPTY_REVIEW, droppedParagraphs: ["s1:0"] })).toEqual([]);
    const note = "This sample is modelled on typical contracts; all names are fictitious. Have a lawyer review it.";
    expect(problems([note]).join(" ")).toContain("Drop this line");
    expect(problems([note], { ...EMPTY_REVIEW, droppedParagraphs: ["s1:0"] })).toEqual([]);
  });

  test("a header or footer with values blocks approval until it is dropped", () => {
    const style = { ...DEFAULT_STYLE, header: "Call +971 50 123 4567", footer: "info@example.com" };
    const check = (review = EMPTY_REVIEW) =>
      approvalProblems({ blanks: [], style, logoDocumentId: null, sections: sections(["Fine wording."]) }, review).join(
        " ",
      );
    expect(check()).toContain("header contains a phone number");
    expect(check()).toContain("footer contains an email address");
    expect(check({ ...EMPTY_REVIEW, dropHeader: true, dropFooter: true })).toBe("");
  });

  test("a clean template with blanks has no such problem", () => {
    expect(problems(["Owner Name {{b1}} Emirates ID {{b2}}"])).not.toContain("contains");
  });
});

describe("D64: lines that describe the unit become blanks from the unit record", () => {
  test("Description, Furnishing, Bathrooms, Parking and Property type", () => {
    const f = detectFilledValues(
      [
        "Description: Four-bedroom villa with a private garden and pool, maid's room and a two-car garage",
        "Furnishing: Unfurnished",
        "Bathrooms: 5",
        "Parking: 2 covered bays",
        "Property type: Villa",
      ],
      0,
    );
    expect(f.lines.join("\n")).not.toMatch(/Four-bedroom|Unfurnished|covered bays/);
    expect(f.blanks.map((b) => b.proposedField)).toEqual([
      "unitDescription",
      "furnishing",
      "bathrooms",
      "parkingSpaces",
      "propertySubtype",
    ]);
  });
});

describe("D70: a filled villa sample leaves no sample value in the wording", () => {
  const lines = (l: string[]) => detectFilledValues(l, 0);
  const field = (f: ReturnType<typeof lines>, label: string) =>
    f.blanks.filter((b) => b.fixedLabel === label).map((b) => b.proposedField);

  test("a heading 'Label value' keeps its label and the value becomes a blank", () => {
    const f = lines(["DLD Property No. DEMO-DLD-000017", "DEWA Premise No. DEMO-DEWA-17"]);
    expect(f.lines).toEqual(["DLD Property No. {{b1}}", "DEWA Premise No. {{b2}}"]);
    expect(f.blanks.map((b) => b.proposedField)).toEqual(["dldPropertyNo", "dewaPremiseNo"]);
  });

  test("Category / Type, Unit Code and Built-up Area (with sq ft and commas)", () => {
    const f = lines(["Unit Code ARR-0017 Category / Type Residential / Villa Built-up Area 5,400 sq ft"]);
    expect(f.lines[0]).toBe("Unit Code {{b1}} Category / Type {{b2}} Built-up Area {{b3}}");
    expect(f.blanks.map((b) => b.proposedField)).toEqual(["unitCode", "propertySubtype", "areaSqft"]);
    const area = f.blanks[2]!;
    expect(validateMapping(area.proposedField, area.fixedLabel!, area).field).toBe("areaSqft");
  });

  test("counts before their label on a label row become blanks; prose is left alone", () => {
    const f = lines([
      "Layout 4 Bedrooms | 4 Bathrooms | 1 Parking space Built-up Area 5,400 sq ft",
      "Payment Schedule 4 cheques of AED 30,000 each",
      "4.8 Community Rules. The Tenant keeps 2 Bedrooms tidy and pays 4 cheques.",
    ]);
    expect(f.lines[0]).toMatch(
      /^Layout \{\{b1\}\} Bedrooms \| \{\{b2\}\} Bathrooms \| \{\{b3\}\} Parking space Built-up Area/,
    );
    expect(f.blanks.slice(0, 3).map((b) => b.proposedField)).toEqual(["bedrooms", "bathrooms", "parkingSpaces"]);
    expect(f.lines[1]).toMatch(/^Payment Schedule \{\{b\d+\}\} cheques of /);
    expect(f.blanks.some((b) => b.proposedField === "cheques")).toBe(true);
    expect(f.lines[2]).toBe("4.8 Community Rules. The Tenant keeps 2 Bedrooms tidy and pays 4 cheques.");
  });

  test("a sample value is blanked everywhere else it appears as whole words", () => {
    const f = lines([
      "Landlord Name Al Noor Family Holdings",
      "Community Arabian Ranches",
      "4.8 Community Rules. The Tenant shall comply with the Arabian Ranches community rules of Al Noor Family Holdings.",
      "Arabian Ranchesville is not the same word.",
    ]);
    expect(f.lines[2]).not.toMatch(/Arabian|Al Noor/i);
    expect(f.lines[2]).toMatch(/comply with the \{\{b\d+\}\} community rules of \{\{b\d+\}\}\./);
    expect(f.lines[3]).toContain("Arabian Ranchesville");
    expect(field(f, "Landlord name")).toEqual(["landlordNameEn", "landlordNameEn"]);
    expect(field(f, "Community")).toEqual(["community", "community"]);
  });

  test("names beside signature blanks with no label become name blanks by position", () => {
    const f = detectFilledValues(
      ["Al Noor Family Holdings Authorised Signatory: {{b1}} Priya Example Rao Signature: {{b2}}"],
      2,
    );
    expect(f.lines[0]).toBe("{{b3}} Authorised Signatory: {{b1}} {{b4}} Signature: {{b2}}");
    expect(f.blanks.map((b) => b.proposedField)).toEqual(["landlordNameEn", "tenantNameEn"]);
  });

  test("a label line that wraps from a sentence takes the party of that sentence", () => {
    const f = lines([
      "4.12 Ejari Registration. The Landlord and the Tenant agree that the Tenant shall supply a valid",
      "Emirates ID 784-1992-7654321-3 passport Z1234567",
    ]);
    expect(field(f, "Tenant Emirates ID")).toEqual(["tenantEmiratesIdNo"]);
    expect(field(f, "Tenant Passport number")).toEqual(["tenantPassportNo"]);
  });

  test("reference codes are specific values; ordinary words and contract numbers still work", () => {
    expect(fixedValueKinds("Unit ARR-0017 and DEMO-TL-100201")).toEqual(["a reference code"]);
    expect(fixedValueKinds("Contract TC-2026-004871.")).toContain("a contract number");
    expect(fixedValueKinds("The Tenant shall pay on time, e-mail or well-known terms.")).toEqual([]);
  });
});

describe("D70: the signature row of a filled sample", () => {
  const read = (lines: string[]) => {
    const d = detectBlanks(lines.join("\n"));
    const f = detectFilledValues(
      d.lines,
      d.blanks.length ? Math.max(...d.blanks.map((b) => Number(b.id.slice(1)))) : 0,
    );
    return { text: f.lines.join("\n"), filled: f.blanks };
  };
  test("the company before 'Authorised Signatory' is the landlord, the name in the second column the tenant", () => {
    const { text, filled } = read([
      "LANDLORD TENANT",
      "Al Noor Family Holdings Authorised Signatory: ________________ Priya Example Rao",
      "Signature: ______________________ Signature: ______________________",
    ]);
    expect(text).not.toContain("Al Noor");
    expect(text).not.toContain("Priya");
    const fields = filled.map((b) => b.proposedField);
    expect(fields).toContain("landlordNameEn");
    expect(fields).toEqual(["landlordNameEn", "tenantNameEn"]);
  });
});
