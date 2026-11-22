import { describe, expect, test } from "bun:test";
import { DEFAULT_STYLE } from "@platform/readers/structure/look";
import type { TemplateBlank, TemplateSections, TemplateStyle } from "@platform/readers/structure/schema";
import { moneyInWords, renderSpaAgreement, type SpaRenderInput, spaAgreementBlocks } from "../src/index.ts";

/** Fictional deal data: nothing here is a real person or company. */
const blank = (id: string, label: string, field: string, over: Partial<TemplateBlank> = {}): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____________",
  label,
  field,
  fieldType: null,
  role: "field",
  sectionIndex: 0,
  before: `${label}: `,
  after: "",
  ...over,
});
const sign = (id: string, label: string) =>
  blank(id, "Signature", "unmapped", { role: "signature", before: `${label}: ` });

const NOW = new Date("2026-11-19T08:00:00Z");
const STYLE: TemplateStyle = { ...DEFAULT_STYLE, header: null, footer: null };

/** Two numbered purchaser slots, a seller, a broker, price, a plan table and signature lines. */
const slotted = (): { sections: TemplateSections; blanks: TemplateBlank[] } => ({
  sections: {
    numbering: "article",
    title: "SALE AND PURCHASE AGREEMENT",
    items: [
      { id: "s0", number: null, heading: null, paragraphs: ["This agreement is made between the parties below."] },
      {
        id: "s1",
        number: "ARTICLE 1",
        heading: "PARTIES",
        paragraphs: [
          "SELLER",
          "Name: {{b1}}",
          "Licence: {{b2}} PURCHASER 1",
          "Name: {{b3}}",
          "Licence: {{b4}} PURCHASER 2",
          "Name: {{b5}} BROKER",
          "Agency: {{b6}}",
        ],
      },
      {
        id: "s2",
        number: "ARTICLE 2",
        heading: "PRICE",
        paragraphs: ["The price is {{b7}} ({{b8}}).", "Payment plan: {{b9}}", "Instalment 1: {{b13}} due {{b14}}."],
      },
      {
        id: "s3",
        number: "ARTICLE 3",
        heading: "SIGNATURES",
        paragraphs: ["Seller: {{b10}}", "Purchaser: {{b11}}", "Broker: {{b12}}"],
      },
    ],
  },
  blanks: [
    blank("b1", "Name", "seller_name"),
    blank("b2", "Licence", "seller_licence_no"),
    blank("b3", "Name", "purchaser_name_1"),
    blank("b4", "Licence", "purchaser_licence_no_1"),
    blank("b5", "Name", "purchaser_name_2"),
    blank("b6", "Agency", "broker_agency"),
    blank("b7", "Price", "price"),
    blank("b8", "Price in words", "price_words", { kind: "placeholder", marker: "{price in words}" }),
    blank("b9", "Payment plan", "payment_plan"),
    sign("b10", "Seller"),
    sign("b11", "Purchaser"),
    sign("b12", "Broker"),
    blank("b13", "Instalment 1 amount", "instalment_1_amount"),
    blank("b14", "Instalment 1 due date", "instalment_1_due"),
  ],
});

/** One unnumbered purchaser block: repeats once per purchaser. */
const repeatable = (): { sections: TemplateSections; blanks: TemplateBlank[] } => ({
  sections: {
    numbering: "decimal_nested",
    title: "OFF-PLAN SALE AGREEMENT",
    items: [
      {
        id: "s1",
        number: "1.",
        heading: "THE PARTIES",
        paragraphs: ["Seller name: {{b1}}", "PURCHASER", "Name: {{b2}}", "Nationality: {{b3}}", "The price is {{b4}}."],
      },
      { id: "s2", number: "2.", heading: "SIGNATURES", paragraphs: ["Purchaser signature: {{b5}}"] },
    ],
  },
  blanks: [
    blank("b1", "Seller name", "seller_name"),
    blank("b2", "Name", "purchaser_name"),
    blank("b3", "Nationality", "purchaser_nationality"),
    blank("b4", "Price", "price"),
    sign("b5", "Purchaser signature"),
  ],
});

const person = (name: string, extra: Record<string, string | number | null> = {}) => ({
  purchaser_name: name,
  ...extra,
});

const base = (t: { sections: TemplateSections; blanks: TemplateBlank[] }): SpaRenderInput => ({
  template: { ...t, style: STYLE, version: 3 },
  dealType: "primary_offplan",
  reference: "DEAL-0001",
  sellers: [{ seller_name: "Palm Sample Developments LLC", seller_licence_no: "TL-100200" }],
  purchasers: [person("Alma Example", { purchaser_licence_no: "L-1" })],
  values: {
    price: 125_000_000,
    broker_agency: "Example Realty",
  },
  plan: [
    { number: 2, label: "On completion", dueOn: "2027-06-30", milestone: null, amountFils: 62_500_000 },
    { number: 1, label: "Booking", dueOn: "2026-12-01", milestone: null, amountFils: 62_500_000 },
  ],
  settlement: [],
  now: NOW,
});

const textOf = (
  blocks: { kind: string; text?: string; label?: string; items?: string[]; rows?: string[][]; head?: string[] }[],
) =>
  blocks
    .map((b) =>
      b.kind === "table"
        ? [b.head!.join(" | "), ...b.rows!.map((r) => r.join(" | "))].join("\n")
        : (b.text ?? b.label ?? (b.items ?? []).join(" ")),
    )
    .join("\n");

const okBlocks = (i: SpaRenderInput) => {
  const r = spaAgreementBlocks(i);
  if (!r.ok) throw new Error(r.problems.join(" / "));
  return r;
};

describe("price in words (by code)", () => {
  test("dirhams and fils", () => {
    expect(moneyInWords(125_000_000)).toBe("UAE Dirhams One Million Two Hundred Fifty Thousand Only");
    expect(moneyInWords(100)).toBe("UAE Dirhams One Only");
    expect(moneyInWords(150_025)).toBe("UAE Dirhams One Thousand Five Hundred and Twenty-Five Fils Only");
    expect(moneyInWords(2_000_000_000_000)).toContain("Twenty Billion");
  });
});

describe("fixed slots", () => {
  test("two purchasers fill slot 1 and slot 2 in order; the unnumbered signature line repeats", () => {
    const i = base(slotted());
    i.purchasers = [
      person("Alma Example", { purchaser_licence_no: "L-1" }),
      person("Bram Sample", { purchaser_licence_no: "L-2" }),
    ];
    const r = okBlocks(i);
    const t = textOf(r.blocks);
    expect(t.indexOf("Alma Example")).toBeGreaterThan(-1);
    expect(t.indexOf("Alma Example")).toBeLessThan(t.indexOf("Bram Sample"));
    expect(t).toContain("PURCHASER 2");
    expect(r.blocks.filter((b) => b.kind === "sigline").map((b) => [b.role, b.slot])).toEqual([
      ["seller", 1],
      ["purchaser", 1],
      ["purchaser", 2],
      ["broker", null],
    ]);
  });

  test("one purchaser on a two-slot template: the second slot is left out, the next block keeps its label", () => {
    const r = okBlocks(base(slotted()));
    const t = textOf(r.blocks);
    expect(t).toContain("PURCHASER 1");
    expect(t).not.toContain("PURCHASER 2");
    expect(t).toContain("BROKER");
    expect(t).toContain("Alma Example");
    expect(t).not.toContain("____");
  });

  test("three purchasers on two slots is needs_human; no party is dropped", async () => {
    const i = base(slotted());
    i.purchasers = [person("A One"), person("B Two"), person("C Three")];
    const r = await renderSpaAgreement(i);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe("needs_human");
    expect(r.problems).toContain("3 purchasers, template has 2 slots.");
    expect("bytes" in r).toBe(false);
  });
});

describe("repeatable block", () => {
  test("three purchasers print three blocks in order, with the block's own label", () => {
    const i = base(repeatable());
    i.purchasers = [
      person("Alma Example", { purchaser_nationality: "Exampleland" }),
      person("Bram Sample", { purchaser_nationality: "Sampleland" }),
      person("Cleo Test", { purchaser_nationality: "Testland" }),
    ];
    const r = okBlocks(i);
    const t = textOf(r.blocks);
    const at = ["Alma Example", "Bram Sample", "Cleo Test"].map((n) => t.indexOf(n));
    expect(at.every((n) => n > -1)).toBe(true);
    expect(at).toEqual(at.toSorted((a, b) => a - b));
    expect(t.match(/^PURCHASER$/gm)?.length).toBe(3);
    expect(t.match(/^Nationality: /gm)?.length).toBe(3);
    // The seller line and the price are printed once.
    expect(t.match(/^Seller name: /gm)?.length).toBe(1);
    expect(t.match(/^The price is /gm)?.length).toBe(1);
    expect(r.blocks.filter((b) => b.kind === "sigline").map((b) => [b.role, b.slot])).toEqual([
      ["purchaser", 1],
      ["purchaser", 2],
      ["purchaser", 3],
    ]);
  });

  test("a paragraph that mixes two parties can't repeat: needs_human, not a guess", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs.push("Between {{b6}} and {{b7}}.");
    t.blanks.push(blank("b6", "Seller", "seller_name"), blank("b7", "Purchaser", "purchaser_name"));
    const i = base(t);
    i.purchasers = [person("A One"), person("B Two")];
    const r = spaAgreementBlocks(i);
    expect(r.ok).toBe(false);
  });
});

describe("co-owners", () => {
  test("a seller block repeats per seller, in order, with its signature line", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs[0] = "Seller name: {{b1}}";
    t.sections.items[1]!.paragraphs.push("Seller signature: {{b9}}");
    t.blanks.push(sign("b9", "Seller signature"));
    const i = base(t);
    i.sellers = [{ seller_name: "Palm Sample Developments LLC" }, { seller_name: "Cove Example Holdings LLC" }];
    const r = okBlocks(i);
    const text = textOf(r.blocks);
    expect(text.indexOf("Palm Sample")).toBeLessThan(text.indexOf("Cove Example"));
    expect(r.blocks.filter((b) => b.kind === "sigline").map((b) => [b.role, b.slot])).toEqual([
      ["purchaser", 1],
      ["seller", 1],
      ["seller", 2],
    ]);
  });
});

describe("company party", () => {
  test("a company purchaser prints its name, licence and signatory", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs.push("Licence: {{b6}}", "Signatory: {{b7}}, {{b8}}");
    t.blanks.push(
      blank("b6", "Licence", "purchaser_licence_no"),
      blank("b7", "Signatory name", "purchaser_signatory_name"),
      blank("b8", "Signatory title", "purchaser_signatory_title"),
    );
    const i = base(t);
    i.purchasers = [
      person("Sample Holdings FZ-LLC", {
        purchaser_licence_no: "CN-5550001",
        purchaser_signatory_name: "Dana Example",
        purchaser_signatory_title: "Managing Director",
      }),
    ];
    const text = textOf(okBlocks(i).blocks);
    expect(text).toContain("Licence: CN-5550001");
    expect(text).toContain("Signatory: Dana Example, Managing Director");
  });

  test("a company seller prints licence and signatory the same way", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs.push("Licence: {{b6}}", "Signed by {{b7}}, {{b8}}");
    t.blanks.push(
      blank("b6", "Licence", "seller_licence_no"),
      blank("b7", "Signatory name", "seller_signatory_name"),
      blank("b8", "Signatory title", "seller_signatory_title"),
    );
    const i = base(t);
    i.sellers = [
      {
        seller_name: "Palm Sample Developments LLC",
        seller_licence_no: "TL-100200",
        seller_signatory_name: "Eli Test",
        seller_signatory_title: "Director",
      },
    ];
    const text = textOf(okBlocks(i).blocks);
    expect(text).toContain("Licence: TL-100200");
    expect(text).toContain("Signed by Eli Test, Director");
  });

  test("a licence that isn't known prints an empty line: it is not a core key", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs.push("Licence: {{b6}}");
    t.blanks.push(blank("b6", "Licence", "purchaser_licence_no"));
    const i = base(t);
    i.purchasers = [person("Alma Example")];
    expect(textOf(okBlocks(i).blocks)).toContain("Licence: ____________");
  });
});

describe("tables", () => {
  test("the payment plan prints as a table sorted by due date then number: the booking is row 1", () => {
    const r = okBlocks(base(slotted()));
    const table = r.blocks.find((b) => b.kind === "table");
    if (!table || table.kind !== "table") throw new Error("no table");
    expect(table.head).toEqual(["No.", "Description", "Due", "Amount"]);
    expect(table.rows).toEqual([
      ["1", "Booking", "1 December 2026", "AED 625,000"],
      ["2", "On completion", "30 June 2027", "AED 625,000"],
    ]);
    // Numbered instalment keys read the same order.
    expect(textOf(r.blocks)).toContain("Instalment 1: AED 625,000 due 1 December 2026.");
  });

  test("a milestone row sorts after the dated rows and prints its milestone", () => {
    const i = base(slotted());
    i.plan = [
      { number: 3, label: "Handover", dueOn: null, milestone: "On handover", amountFils: 25_000_000 },
      { number: 1, label: "Booking", dueOn: "2026-12-01", milestone: null, amountFils: 100_000_000 },
    ];
    const table = okBlocks(i).blocks.find((b) => b.kind === "table");
    if (!table || table.kind !== "table") throw new Error("no table");
    expect(table.rows.map((r) => r[0])).toEqual(["1", "2"]);
    expect(table.rows.map((r) => r[1])).toEqual(["Booking", "Handover"]);
    expect(table.rows[1]![2]).toBe("On handover");
  });

  test("the settlement statement prints as a table in statement order", () => {
    const t = repeatable();
    t.sections.items[0]!.paragraphs.push("Settlement: {{b6}}");
    t.blanks.push(blank("b6", "Settlement", "settlement_table"));
    const i = base(t);
    i.dealType = "resale_ready";
    i.settlement = [
      { label: "Sale price", payer: "buyer", payee: "seller", amountFils: 125_000_000 },
      { label: "DLD transfer fee", payer: "buyer", payee: "dld", amountFils: 5_000_000 },
    ];
    const table = okBlocks(i).blocks.find((b) => b.kind === "table");
    if (!table || table.kind !== "table") throw new Error("no table");
    expect(table.head).toEqual(["Item", "Payer", "Payee", "Amount"]);
    expect(table.rows).toEqual([
      ["Sale price", "Buyer", "Seller", "AED 1,250,000"],
      ["DLD transfer fee", "Buyer", "DLD", "AED 50,000"],
    ]);
  });

  test("a primary deal with no plan rows fails: the plan is required there", () => {
    const i = base(slotted());
    i.plan = [];
    const r = spaAgreementBlocks(i);
    expect(r.ok).toBe(false);
  });

  test("a resale with no plan prints an empty line", () => {
    const i = base(slotted());
    i.plan = [];
    i.dealType = "resale_ready";
    expect(textOf(okBlocks(i).blocks)).toContain("Payment plan: ____________");
  });
});

describe("fail closed", () => {
  test("a core key with no value gives a problem and no PDF", async () => {
    const i = base(slotted());
    i.sellers = [{ seller_name: null }];
    const r = await renderSpaAgreement(i);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("No value for Seller name");
    expect("bytes" in r).toBe(false);
  });

  test("a missing price (and so no price in words) is reported, never printed empty", () => {
    const i = base(slotted());
    i.values = { broker_agency: "Example Realty" };
    const r = spaAgreementBlocks(i);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("No value for Sale price");
  });

  test("a signature line whose role is null gives a problem", () => {
    const t = slotted();
    t.blanks = t.blanks.map((b) => (b.id === "b12" ? { ...b, label: "Signature", before: "Witness: " } : b));
    t.sections.items[3]!.paragraphs[2] = "Witness: {{b12}}";
    const r = spaAgreementBlocks(base(t));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("Signature line");
  });

  test("an authority mark in the stored look blocks the render", () => {
    const i = base(slotted());
    i.template.style = {
      ...STYLE,
      header: "Dubai Land Department | Agreement",
      flags: { authorityMarks: true, areas: ["header"] },
    };
    const r = spaAgreementBlocks(i);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.join(" ")).toContain("authority");
  });

  test("a blank mapped to an unknown key, and a missing blank, are reported together", () => {
    const t = slotted();
    t.blanks = t.blanks.map((b) => (b.id === "b6" ? { ...b, field: "not_a_key" } : b));
    t.sections.items[1]!.paragraphs.push("Ghost {{b99}}");
    const r = spaAgreementBlocks(base(t));
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problems.length).toBeGreaterThanOrEqual(2);
  });

  test("a value the PDF fonts can't print is reported", () => {
    const i = base(slotted());
    i.sellers = [{ seller_name: "مشروع" }];
    const r = spaAgreementBlocks(i);
    expect(r.ok).toBe(false);
  });

  test("nothing from another deal or from the template's sample appears", () => {
    const a = base(slotted());
    a.sellers = [{ seller_name: "Aaa Seller LLC", seller_licence_no: "TL-AAA" }];
    a.purchasers = [person("Aaa Buyer")];
    const b = base(slotted());
    b.sellers = [{ seller_name: "Bbb Seller LLC", seller_licence_no: "TL-BBB" }];
    b.purchasers = [person("Bbb Buyer")];
    const ta = textOf(okBlocks(a).blocks);
    const tb = textOf(okBlocks(b).blocks);
    for (const s of ["Aaa Seller", "TL-AAA", "Aaa Buyer"]) expect(tb).not.toContain(s);
    for (const s of ["Bbb Seller", "TL-BBB", "Bbb Buyer"]) expect(ta).not.toContain(s);
  });
});

describe("price and money are code-formatted", () => {
  test("price, price in words and instalments come from the integer fils", () => {
    const t = textOf(okBlocks(base(slotted())).blocks);
    expect(t).toContain("The price is AED 1,250,000 (UAE Dirhams One Million Two Hundred Fifty Thousand Only).");
  });
});

describe("render", () => {
  test("a good deal gives a PDF and one anchor per signature line; same input and now give the same bytes", async () => {
    const i = base(slotted());
    i.purchasers = [person("Alma Example"), person("Bram Sample")];
    const a = await renderSpaAgreement(i);
    const b = await renderSpaAgreement(i);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(Buffer.from(a.bytes).equals(Buffer.from(b.bytes))).toBe(true);
    expect(a.anchors.map((x) => [x.role, x.slot])).toEqual([
      ["seller", 1],
      ["purchaser", 1],
      ["purchaser", 2],
      ["broker", null],
    ]);
    expect(String.fromCharCode(...a.bytes.subarray(0, 5))).toBe("%PDF-");
  });
});
