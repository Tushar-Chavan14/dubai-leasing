import { describe, expect, test } from "bun:test";
import type { ParagraphText } from "@leasing/core";
import { anchorQuote } from "../src/contract-change/anchor.ts";

const p = (key: string, label: string, text: string, values: string[] = []): ParagraphText => ({
  key,
  label,
  text,
  values,
  rewritable: true,
  page: null,
});

const paras = [
  p("s1:0", "4.5 Maintenance", "The tenant keeps the swimming pool clean.", []),
  p("s1:1", "4.6 Rent", "The annual rent is AED 50,000 payable in four cheques.", ["AED 50,000"]),
  p("no_pets", "Pets", "No pets are allowed in the unit."),
  p("free_text", "Additional terms", "Parking is included."),
  p("std:0", "Terms", "This contract is governed by UAE law."),
];

describe("anchorQuote", () => {
  test("anchors a quote inside one paragraph", () => {
    const r = anchorQuote(paras, "keeps the swimming pool");
    expect(r.refused).toBeNull();
    expect(r.anchor).toEqual({ kind: "paragraph", key: "s1:0", label: "4.5 Maintenance" });
    expect(r.quotes).toEqual([{ key: "s1:0", quote: "keeps the swimming pool" }]);
  });
  test("anchors across a line break and a hyphen", () => {
    const r = anchorQuote(paras, "swim-\nming pool");
    expect(r.anchor.kind).toBe("paragraph");
    expect(r.quotes[0]!.key).toBe("s1:0");
  });
  test("splits a quote that spans two paragraphs", () => {
    const r = anchorQuote(paras, "pool clean. The annual rent");
    expect(r.quotes).toEqual([
      { key: "s1:0", quote: "pool clean." },
      { key: "s1:1", quote: "The annual rent" },
    ]);
    expect(r.anchor).toMatchObject({ kind: "paragraph", key: "s1:0" });
  });
  test("refuses a quote inside a record value", () => {
    const r = anchorQuote(paras, "AED 50,000");
    expect(r.refused).toBe("This is set in the offer or the records and can't be changed here.");
  });
  test("unknown when the version has no paragraph texts", () => {
    expect(anchorQuote(null, "anything")).toEqual({ anchor: { kind: "unknown" }, refused: null, quotes: [] });
  });
  test("unknown when nothing matches", () => {
    expect(anchorQuote(paras, "zebra").anchor).toEqual({ kind: "unknown" });
  });
  test("a clause and the additional terms anchor by kind", () => {
    expect(anchorQuote(paras, "No pets are allowed").anchor).toEqual({ kind: "clause", ref: "no_pets", label: "Pets" });
    expect(anchorQuote(paras, "Parking is included").anchor).toEqual({ kind: "free_text", label: "Additional terms" });
    expect(anchorQuote(paras, "governed by UAE law").anchor).toEqual({ kind: "fixed", label: "Terms" });
  });
  test("normalises curly quotes", () => {
    const r = anchorQuote([p("s1:0", "1 A", "the tenant's pool")], "the tenant’s pool");
    expect(r.anchor.kind).toBe("paragraph");
  });
  test('"4.10 Renewal" is not refused when a value is "1"', () => {
    const r = anchorQuote([p("s1:0", "4.10 Renewal", "4.10 Renewal applies after 12 months.", ["1"])], "4.10 Renewal");
    expect(r.refused).toBeNull();
    expect(r.anchor.kind).toBe("paragraph");
  });
  test('quote "AED 50,000 per year" is refused', () => {
    expect(
      anchorQuote(
        paras.concat(p("s2:0", "Rent", "Rent is AED 50,000 per year.", ["AED 50,000"])),
        "AED 50,000 per year",
      ).refused,
    ).toBe("This is set in the offer or the records and can't be changed here.");
  });
  test('quote "Bathrooms" next to value "1" is not refused but "1 Bathrooms" is', () => {
    const one = [p("s1:0", "Unit", "Bathrooms 1 in total", ["1"])];
    expect(anchorQuote(one, "Bathrooms").refused).toBeNull();
    const two = [p("s1:0", "Unit", "Count 1 Bathrooms", ["1"])];
    expect(anchorQuote(two, "1 Bathrooms").refused).not.toBeNull();
  });
  test("an unmatched quote is unknown, not refused", () => {
    const r = anchorQuote(paras, "AED 99,999");
    expect(r.refused).toBeNull();
    expect(r.anchor).toEqual({ kind: "unknown" });
  });
});
