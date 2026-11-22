import { describe, expect, test } from "bun:test";
import type { TemplateBlank } from "@platform/readers/structure/schema";
import { dubaiSales2026_01, type SalesRulebook } from "@spa/rulebook";
import { hasBlocker, type TemplateCheckInput, templateChecks } from "../src/template/checks.ts";

const blank = (id: string, field: string, extra: Partial<TemplateBlank> = {}): TemplateBlank => ({
  id,
  kind: "underscore",
  marker: "____",
  label: field,
  field,
  fieldType: "text",
  role: "field",
  sectionIndex: 0,
  before: "",
  after: "",
  ...extra,
});

const CORE = [
  blank("b1", "seller_name"),
  blank("b2", "purchaser_name_1"),
  blank("b3", "unit_no"),
  blank("b4", "price"),
  blank("b5", "payment_plan"),
];

const input = (over: Partial<TemplateCheckInput> = {}): TemplateCheckInput => ({
  documentKind: "spa",
  paragraphs: ["The Seller {{b1}} sells unit {{b3}} to {{b2}} for AED {{b4}}, paid as per {{b5}}."],
  blanks: CORE,
  authorityMarks: false,
  rulebook: dubaiSales2026_01,
  ...over,
});
const codes = (i: TemplateCheckInput) => templateChecks(i).map((c) => `${c.severity}:${c.code}`);

describe("template checks", () => {
  test("a clean template has no blocker", () => {
    expect(codes(input())).toEqual([]);
    expect(hasBlocker(templateChecks(input()))).toBe(false);
  });

  test("a sample price left in the wording blocks", () => {
    expect(codes(input({ paragraphs: ["The price is 1,250,000 dirhams, paid {{b4}}."] }))).toContain(
      "blocker:sample_value",
    );
    expect(codes(input({ paragraphs: ["One million two hundred thousand dirhams only."] }))).toContain(
      "blocker:sample_value",
    );
    expect(codes(input({ paragraphs: ["Contact jane.example@example.com"] }))).toContain("blocker:sample_value");
  });

  test("the sample-value message never repeats the value", () => {
    const c = templateChecks(input({ paragraphs: ["Contact jane.example@example.com"] }));
    expect(JSON.stringify(c)).not.toContain("jane.example");
  });

  test("authority marks in header, footer or logo block", () => {
    expect(codes(input({ authorityMarks: true }))).toContain("blocker:authority_marks");
  });

  test("the fee % must equal the rulebook", () => {
    expect(codes(input({ paragraphs: ["The Purchaser pays the DLD registration fee of 4% of the price."] }))).toEqual(
      [],
    );
    expect(codes(input({ paragraphs: ["The DLD registration fee of 2% is paid by the buyer."] }))).toContain(
      "blocker:fee_rate",
    );
    expect(codes(input({ paragraphs: ["A transfer fee of 4.5 % applies."] }))).toContain("blocker:fee_rate");
    expect(codes(input({ paragraphs: ["The Purchaser pays 5% of the price on signing."] }))).toEqual([]);
    expect(
      codes(
        input({
          paragraphs: [
            "The Purchaser pays the DLD fee of 4% of the price, and on the date of signing this agreement a booking of 10% of the price.",
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("a pending rulebook fee can't be checked: blocks", () => {
    const rb: SalesRulebook = { ...dubaiSales2026_01, pending: [...dubaiSales2026_01.pending, "registrationFeeBps"] };
    expect(codes(input({ rulebook: rb, paragraphs: ["The DLD fee is 4%."] }))).toContain("blocker:fee_rate");
  });

  test("missing core keys block, by document kind", () => {
    const noBuyer = CORE.filter((b) => !b.field.startsWith("purchaser"));
    expect(codes(input({ blanks: noBuyer }))).toContain("blocker:missing_core_key");
    expect(codes(input({ documentKind: "listing_agreement", blanks: noBuyer }))).toEqual([]);
    const c = templateChecks(input({ blanks: noBuyer })).find((x) => x.code === "missing_core_key");
    expect(c?.message).toContain("purchaser_name");
  });

  test("an SPA with no payment plan warns (fine for a resale)", () => {
    const noPlan = CORE.filter((b) => b.field !== "payment_plan");
    expect(codes(input({ blanks: noPlan }))).toEqual(["warning:no_payment_plan"]);
    expect(codes(input({ documentKind: "mou", blanks: noPlan }))).toEqual([]);
  });

  test("a blank left empty warns; a signature line doesn't", () => {
    const blanks = [...CORE, blank("b9", "leave_empty"), blank("b10", "leave_empty", { role: "signature" })];
    const c = templateChecks(input({ blanks }));
    expect(c.map((x) => `${x.severity}:${x.code}:${x.blankId ?? ""}`)).toEqual(["warning:unmapped_blank:b9"]);
  });
});
