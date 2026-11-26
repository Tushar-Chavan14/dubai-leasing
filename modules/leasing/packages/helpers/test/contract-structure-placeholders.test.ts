import { describe, expect, test } from "bun:test";
import {
  buildSections,
  detectBlanks,
  detectFilledValues,
  fillPlaceholderText,
  fixedValueKinds,
  formatField,
  matchPlaceholder,
  placeholderLabel,
  proposeMappings,
  remapForData,
  resuggestBlanks,
  SAMPLE_CONTRACT_FIELDS,
  SHEET_KEYS,
  sheetExtras,
  templateContractBlocks,
  autoReview,
  type TemplateBlank,
  type TemplateSections,
  EMPTY_REVIEW,
  DEFAULT_STYLE,
  approvalBlockers,
} from "../src/index.ts";
import { FakeLlm } from "@platform/llm";

describe("D74: placeholder detection", () => {
  test("finds {name}, [name] and <name> in all three bracket styles", () => {
    const d = detectBlanks("Tenant: {tenant name}\nUnit: [unit no]\nBuilding: <building>");
    expect(d.blanks.map((b) => [b.kind, b.marker])).toEqual([
      ["placeholder", "{tenant name}"],
      ["placeholder", "[unit no]"],
      ["placeholder", "<building>"],
    ]);
    expect(d.lines).toEqual(["Tenant: {{b1}}", "Unit: {{b2}}", "Building: {{b3}}"]);
  });

  test("ignores {{b1}} tokens, empty brackets keep their kind, << >> and page markers are not placeholders", () => {
    const d = detectBlanks(
      [
        "Forged {{b1}} token",
        "Rent [ ] and << >> and {   }",
        "Page {n} of {N}, {page} / {pages}",
        "<<name>> and [[name]]",
      ].join("\n"),
    );
    expect(d.blanks.map((b) => [b.kind, b.marker])).toEqual([
      ["bracket", "[ ]"],
      ["bracket", "<< >>"],
      ["bracket", "{   }"],
    ]);
  });

  test("names: 2 to 40 characters, a letter first, letters digits space _ - / .", () => {
    const d = detectBlanks(
      "{a} {1st cheque} {property_community} {Community / area} {no. of cheques} [1] {tenant@mail} {" +
        "x".repeat(41) +
        "}",
    );
    expect(d.blanks.map((b) => b.marker)).toEqual(["{property_community}", "{Community / area}", "{no. of cheques}"]);
  });

  test("a placeholder split by a line or page break is joined", () => {
    const d = detectBlanks(
      [
        "registered with {registration system} ({registering",
        "",
        "",
        "authority}). The details must match.",
        "Disputes go to {dispute",
        "body}.",
      ].join("\n"),
    );
    expect(d.blanks.map((b) => b.marker)).toEqual([
      "{registration system}",
      "{registering authority}",
      "{dispute body}",
    ]);
    expect(d.lines[0]).toBe("registered with {{b1}} ({{b2}}). The details must match.");
    expect(d.lines[3]).toBe("");
    expect(d.lines[4]).toBe("Disputes go to {{b3}}.");
  });

  test("labels read the name in words", () => {
    expect(placeholderLabel("property_community")).toBe("Property community");
    expect(placeholderLabel("tenantFullName")).toBe("Tenant full name");
    expect(placeholderLabel("no of cheques")).toBe("No of cheques");
  });
});

describe("D74: mapping a placeholder by name", () => {
  test("exact key, camel and snake forms, aliases from the generic template", () => {
    expect(matchPlaceholder("community")).toBe("community");
    expect(matchPlaceholder("property_community")).toBe("community");
    expect(matchPlaceholder("tenantFullName")).toBe("tenantNameEn");
    expect(matchPlaceholder("tenant_name")).toBe("tenantNameEn");
    expect(matchPlaceholder("tenantNameEn")).toBe("tenantNameEn");
    expect(matchPlaceholder("tenant emirates id")).toBe("tenantEmiratesIdNo");
    expect(matchPlaceholder("no of cheques")).toBe("cheques");
    expect(matchPlaceholder("cheque dates")).toBe("chequeDates");
    expect(matchPlaceholder("cheque date 2")).toBe("chequeDate2");
    expect(matchPlaceholder("contract no")).toBe("leaseRef");
    expect(matchPlaceholder("contract date")).toBe("contractOn");
    expect(matchPlaceholder("emirate")).toBe("emirateName");
    expect(matchPlaceholder("renewal notice days")).toBe("renewalNoticeDays");
    expect(matchPlaceholder("additional terms")).toBe("additionalTerms");
  });

  test("the label rules read a name the table doesn't list; an unknown name is null", () => {
    expect(matchPlaceholder("Tenant visa number")).toBe("tenantVisaNo");
    expect(matchPlaceholder("zzz widget")).toBeNull();
  });

  test("proposeMappings: a placeholder is matched by name (no model), an unknown one is left empty", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("no decide");
    });
    const item = (id: string, name: string, before = "") => ({
      id,
      label: placeholderLabel(name),
      before,
      after: "",
      party: null,
      placeholder: name,
    });
    const r = await proposeMappings(llm, [
      // The words around "no of cheques" ("cheques of") would read as an amount: the name wins.
      item("b1", "no of cheques", "Payment:"),
      item("b2", "zzz widget"),
      item("b3", "signatory name", "Represented by:"),
    ]);
    expect(r.asked).toBe(0);
    expect(r.proposals.get("b1")).toEqual({ field: "cheques", source: "matched" });
    expect(r.proposals.get("b2")).toEqual({ field: "leave_empty", source: "empty" });
    expect(r.proposals.get("b3")).toEqual({ field: "signatoryName", source: "matched" });
  });

  test("resuggestBlanks keeps the unknown-placeholder note", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("no decide");
    });
    const mk = (id: string, marker: string): TemplateBlank => ({
      id,
      kind: "placeholder",
      marker,
      label: placeholderLabel(marker.slice(1, -1)),
      field: "leave_empty",
      fieldType: null,
      role: "field",
      sectionIndex: 0,
      before: "",
      after: "",
    });
    const r = await resuggestBlanks(
      llm,
      { title: null, items: [{ heading: "X", paragraphs: ["{{b1}} and {{b2}}"] }] },
      [mk("b1", "{tenant name}"), mk("b2", "{zzz widget}")],
    );
    expect(r.blanks[0]).toMatchObject({ field: "tenantNameEn", source: "matched" });
    expect(r.blanks[1]).toMatchObject({ field: "leave_empty", note: "Unknown placeholder {zzz widget}" });
  });
});

describe("D74: the filled-sample sweep and the review ignore placeholders", () => {
  test("detectFilledValues leaves placeholder tokens and the label lines around them alone", () => {
    const d = detectBlanks("Tenant: {tenant name}\nTenant Emirates ID: {tenant emirates id}\nUnit no.: {unit no}");
    const filled = detectFilledValues(d.lines, d.blanks.length);
    expect(filled.blanks).toHaveLength(0);
    expect(filled.lines).toEqual(d.lines);
  });

  test("a template with placeholders keeps 'Community / area:' as one label; values by pattern are still blanked", () => {
    const d = detectBlanks("Community / area: {community}\nLiving and dining area: ________\nEmail: a.b@example.com");
    const f = detectFilledValues(
      d.lines,
      d.blanks.length,
      new Set(d.blanks.filter((b) => b.kind === "placeholder").map((b) => b.id)),
    );
    expect(f.lines.slice(0, 2)).toEqual(d.lines.slice(0, 2));
    expect(f.blanks).toHaveLength(1);
    expect(f.lines[2]).toMatch(/^Email: \{\{b\d+\}\}$/);
    // Read as a filled sample (the default) the same label rows are taken apart.
    expect(detectFilledValues(d.lines, d.blanks.length).lines[0]).not.toBe(d.lines[0]);
  });

  test("a sample's own line next to placeholders is still blanked (no sample value prints)", () => {
    const d = detectBlanks("Tenant Name Ahmed Example\nUnit no.: {unit no}");
    const ph = new Set(d.blanks.filter((b) => b.kind === "placeholder").map((b) => b.id));
    const f = detectFilledValues(d.lines, d.blanks.length, ph);
    expect(f.lines[0]).not.toContain("Ahmed");
    expect(f.lines[1]).toBe(d.lines[1]);
    expect(f.blanks[0]).toMatchObject({ proposedField: "tenantNameEn" });
  });

  test("a form row is its own paragraph", () => {
    const d = detectBlanks("1. PARTIES\nLandlord: {landlord name}\nTenant: {tenant name}\nEmail: {tenant email}");
    const built = buildSections(d.lines, ["PARTIES"]);
    expect(built.sections.items[0]!.paragraphs).toEqual(["Landlord: {{b1}}", "Tenant: {{b2}}", "Email: {{b3}}"]);
  });

  test("fixedValueKinds and autoReview don't drop a paragraph with a placeholder", () => {
    const d = detectBlanks("1. PARTIES\nTenant: {tenant name}, passport {tenant passport no}\n");
    expect(fixedValueKinds(d.lines[1]!)).toEqual([]);
    const built = buildSections(d.lines, ["1. PARTIES"]);
    const r = autoReview({ style: DEFAULT_STYLE, logoDocumentId: null, sections: built.sections }, EMPTY_REVIEW);
    expect(r.review.droppedParagraphs).toEqual([]);
    expect(approvalBlockers({ style: DEFAULT_STYLE, sections: built.sections })).toEqual([]);
  });
});

describe("D74: remapping at prepare", () => {
  test("in a template with placeholders only the placeholders are re-read; plain blanks stay for hand-writing", async () => {
    const llm = new FakeLlm(() => {
      throw new Error("no decide");
    });
    const mk = (id: string, kind: TemplateBlank["kind"], marker: string, label: string): TemplateBlank => ({
      id,
      kind,
      marker,
      label,
      field: "leave_empty",
      fieldType: null,
      role: "field",
      sectionIndex: 0,
      before: label,
      after: "",
    });
    const r = await remapForData(
      llm,
      { title: null, items: [{ heading: "X", paragraphs: ["{{b1}}", "Bedrooms: {{b2}}"] }] },
      [mk("b1", "placeholder", "{tenant name}", "Tenant name"), mk("b2", "underscore", "____", "Bedrooms")],
      { tenantNameEn: "A B", bedrooms: 2 },
    );
    expect(r.blanks.find((b) => b.id === "b1")?.field).toBe("tenantNameEn");
    expect(r.blanks.find((b) => b.id === "b2")?.field).toBe("leave_empty");
  });
});

describe("D74: new data-sheet keys", () => {
  test("keys exist with their types", () => {
    for (const k of ["registrationSystem", "registeringAuthority", "governingLaw", "disputeBody", "utilityProvider"])
      expect(SHEET_KEYS[k]?.type).toBe("text");
    for (const k of ["renewalNoticeDays", "repossessionNoticeMonths", "lateRentDays"])
      expect(SHEET_KEYS[k]?.type).toBe("int");
    expect(SHEET_KEYS.emirateName?.type).toBe("text");
    expect(SHEET_KEYS.additionalTerms?.type).toBe("text");
  });

  test("values are copied from the wording, rulebook and unit records", () => {
    const x = sheetExtras({
      unit: { emirate: "sharjah" },
      wording: {
        registrationSystem: "Sharjah Municipality attestation",
        registeringAuthority: "Sharjah Municipality",
        governingLaw: "the laws of the Emirate of Sharjah",
        disputeBody: "the committee",
        utilityProvider: "SEWA",
      },
      rulebook: { renewalNoticeDays: 90, repossessionNoticeMonths: 12, lateRentDaysAfterFormalReminder: 15 },
    });
    expect(x).toMatchObject({
      emirateName: "Sharjah",
      utilityProvider: "SEWA",
      registeringAuthority: "Sharjah Municipality",
      renewalNoticeDays: 90,
      repossessionNoticeMonths: 12,
      lateRentDays: 15,
      additionalTerms: null,
    });
    const none = sheetExtras({});
    expect(none.renewalNoticeDays).toBeNull();
    expect(none.emirateName).toBeNull();
  });
});

const blankOf = (id: string, marker: string, field: string, over: Partial<TemplateBlank> = {}): TemplateBlank => ({
  id,
  kind: "placeholder",
  marker,
  label: marker.slice(1, -1),
  field,
  fieldType: null,
  role: "field",
  sectionIndex: 0,
  before: "",
  after: "",
  ...over,
});

describe("D74: rendering placeholders", () => {
  const sections: TemplateSections = {
    numbering: "decimal",
    title: "TENANCY CONTRACT",
    items: [
      { id: "s0", number: null, heading: null, paragraphs: ["Emirate: {{b1}}"] },
      {
        id: "s1",
        number: "1.",
        heading: "TERMS",
        paragraphs: ["Notice at least {{b2}} days before. Mystery {{b3}}.", "Utilities: {{b4}} account."],
      },
      { id: "s2", number: "2.", heading: "ADDITIONAL TERMS", paragraphs: ["{{b5}}"] },
      { id: "s3", number: "3.", heading: "DECLARATIONS", paragraphs: ["Read and accepted."] },
    ],
  };
  const blanks = [
    blankOf("b1", "{emirate}", "emirateName"),
    blankOf("b2", "{renewal notice days}", "renewalNoticeDays", { before: "Notice at least ", after: "days before." }),
    blankOf("b3", "{zzz widget}", "leave_empty"),
    blankOf("b4", "{utility provider}", "utilityProvider"),
    blankOf("b5", "{additional terms}", "additionalTerms"),
  ];
  const extras = { emirateName: "Sharjah", renewalNoticeDays: 90, utilityProvider: "SEWA", additionalTerms: null };
  const add = { clauses: ["maintenance" as const], freeText: "The parties agree to pets." };
  const run = (e: Record<string, string | number | null> = extras, unavailable?: Record<string, string>) =>
    templateContractBlocks({ sections, blanks, templateVersion: 1 }, SAMPLE_CONTRACT_FIELDS, add, {
      version: 1,
      reference: "R",
      demo: false,
      extras: e,
      emirate: "sharjah",
      ...(unavailable ? { unavailable } : {}),
    });
  const texts = (r: ReturnType<typeof run>) =>
    r.blocks.map((b) => (b.kind === "list" ? b.items.join(" / ") : "text" in b ? b.text : ""));

  test("filled from the extras; an unknown placeholder prints an empty line, never its name", () => {
    const t = texts(run());
    expect(t).toContain("Emirate: Sharjah");
    expect(t).toContain("Notice at least 90 days before. Mystery ________.");
    expect(t).toContain("Utilities: SEWA account.");
    expect(t.join("\n")).not.toContain("{zzz");
  });

  test("{additional terms}: the addendum prints at that paragraph, not at the end, and the blank prints nothing", () => {
    const t = texts(run());
    const at = t.indexOf("2. ADDITIONAL TERMS");
    const minor = t.findIndex((x) => x.includes("Minor maintenance"));
    const free = t.findIndex((x) => x.includes("The parties agree to pets."));
    const decl = t.indexOf("3. DECLARATIONS");
    expect(at).toBeGreaterThan(-1);
    expect(minor).toBeGreaterThan(at);
    expect(free).toBeGreaterThan(minor);
    expect(decl).toBeGreaterThan(free);
    expect(t).not.toContain("Addendum");
    expect(t.filter((x) => x.includes("Minor maintenance"))).toHaveLength(1);
  });

  test("without that placeholder the addendum still prints at the end under its heading", () => {
    const r = templateContractBlocks(
      { sections, blanks: blanks.map((b) => (b.id === "b5" ? { ...b, field: "leave_empty" } : b)), templateVersion: 1 },
      SAMPLE_CONTRACT_FIELDS,
      add,
      { version: 1, reference: "R", demo: false, extras, emirate: "sharjah" },
    );
    const t = texts(r);
    expect(t.indexOf("Addendum")).toBeGreaterThan(t.indexOf("3. DECLARATIONS"));
  });

  test("a rulebook period with no value fails with the reason given", () => {
    expect(() =>
      run(
        { ...extras, renewalNoticeDays: null },
        { renewalNoticeDays: "No rulebook for Ajman: publish one in Settings → Rulebooks" },
      ),
    ).toThrow("No rulebook for Ajman");
    expect(() => run({ ...extras, renewalNoticeDays: null })).toThrow("No value for");
  });

  test("header and footer placeholders are filled like the body; page markers stay", () => {
    const values = { ...SAMPLE_CONTRACT_FIELDS, companyName: "Acme Realty", leaseRef: "L-1" };
    expect(fillPlaceholderText("{company name} | Tenancy Contract {contract no}", values)).toBe(
      "Acme Realty | Tenancy Contract L-1",
    );
    expect(fillPlaceholderText("Page {page} of {pages} {zzz widget}", values)).toBe("Page {page} of {pages} ________");
    expect(formatField("leaseRef", values)).toBe("L-1");
  });
});
