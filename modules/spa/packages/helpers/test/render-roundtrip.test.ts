import { describe, expect, test } from "bun:test";
import { extractPdf, normalizeWs } from "@platform/readers/pdf/extract";
import type { ContractStructureData } from "@platform/readers/structure/schema";
import { type PlanRow, renderSpaAgreement, type SpaRenderInput, type SpaValues } from "../src/index.ts";
import { read, SAMPLES } from "./fixtures/template-samples.ts";

/**
 * C14 round trip: read a fictional template (C12 reader), render a deal into it, read the result with the same reader.
 * What makes the template the company's own (numbering, headings, fixed wording, tables, header, footer, look) must
 * be the same before and after; only the blanks differ.
 */
const NOW = new Date("2026-11-19T08:00:00Z");
const PLAN: PlanRow[] = [
  { number: 1, label: "Booking", dueOn: "2026-12-01", milestone: null, amountFils: 25_000_000 },
  { number: 2, label: "On completion", dueOn: "2027-06-30", milestone: null, amountFils: 100_000_000 },
];
const buyer = (name: string, extra: SpaValues = {}): SpaValues => ({
  purchaser_name: name,
  purchaser_nationality: "Exampleland",
  purchaser_passport_no: "P0000001",
  ...extra,
});
const dealFor = (data: ContractStructureData, purchasers: SpaValues[]): SpaRenderInput => ({
  template: { sections: data.sections, blanks: data.blanks, style: data.style, version: 1 },
  dealType: "primary_offplan",
  reference: "DEAL-RT",
  sellers: [{ seller_name: "Palm Sample Developments LLC", seller_licence_no: "TL-100200" }],
  purchasers,
  values: {
    price: 125_000_000,
    unit_no: "A-1204",
    building: "Sample Tower",
    broker_agency: "Example Realty",
    broker_orn: "ORN-9001",
    dld_fee: 5_000_000,
    anticipated_completion: "2027-06-30",
    agreement_date: "2026-11-19",
  },
  plan: PLAN,
  now: NOW,
});

const fixedFragments = (data: ContractStructureData): string[] =>
  [data.sections.title, ...data.sections.items.flatMap((s) => [s.heading, ...s.paragraphs])]
    .flatMap((t) => (t ?? "").split(/\{\{b\d+\}\}/))
    // A signature line prints its label without the trailing colon.
    .map((f) => normalizeWs(f).replace(/[\s:]+$/, ""))
    .filter((f) => f.replace(/[^A-Za-z]/g, "").length >= 3);

const fingerprint = (d: ContractStructureData) => ({
  numbering: d.sections.numbering,
  numbers: d.sections.items.map((s) => s.number),
  headings: d.sections.items.map((s) => s.heading),
  title: d.sections.title,
  header: d.style.header,
  footer: d.style.footer,
  look: {
    page: d.style.page,
    family: d.style.font.family,
    regular: d.style.font.regular,
    accent: d.style.accentColour,
    sizes: d.style.sizes,
    leftPt: d.style.margins.leftPt,
    rightPt: d.style.margins.rightPt,
  },
});

const textOf = async (bytes: Uint8Array) => {
  const r = await extractPdf(bytes);
  if (!r.ok) throw new Error(r.message);
  return normalizeWs(r.text);
};

describe("render then re-read: three fictional templates", () => {
  test.each(SAMPLES.map((s) => [s.spec.id, s] as const))("%s keeps its structure and look", async (_id, s) => {
    const original = (await read(s)).rec.result.data!;
    const purchasers =
      s.spec.id === "articles-slots" ? [buyer("Alma Example"), buyer("Bram Sample")] : [buyer("Alma Example")];
    const out = await renderSpaAgreement(dealFor(original, purchasers));
    if (!out.ok) throw new Error(out.problems.join(" / "));

    const again = (await read(s, out.bytes)).rec.result.data!;
    expect(fingerprint(again)).toEqual(fingerprint(original));

    // Fixed wording: every piece of the template's own text is in the output, in order.
    const text = await textOf(out.bytes);
    let at = 0;
    for (const f of fixedFragments(original)) {
      const found = text.indexOf(f, at);
      expect([f, found >= 0]).toEqual([f, true]);
      at = found;
    }
    // Tables: one printed table for each table key the template holds.
    const tableKeys = original.blanks.filter(
      (b) => b.field === "payment_plan" || b.field === "settlement_table",
    ).length;
    expect(out.blocks.filter((b) => b.kind === "table").length).toBe(tableKeys);
    // Nothing of the sample stays in; the deal's values are there.
    for (const secret of s.secrets) expect(text).not.toContain(secret);
    expect(text).toContain("Alma Example");
    expect(text).toContain("AED 1,250,000");
  });

  test("the numbered template prints both purchasers in slot order", async () => {
    const s = SAMPLES[0]!;
    const original = (await read(s)).rec.result.data!;
    const out = await renderSpaAgreement(dealFor(original, [buyer("Alma Example"), buyer("Bram Sample")]));
    if (!out.ok) throw new Error(out.problems.join(" / "));
    const text = await textOf(out.bytes);
    expect(text.indexOf("Alma Example")).toBeLessThan(text.indexOf("Bram Sample"));
    expect(text.indexOf("PURCHASER 1")).toBeLessThan(text.indexOf("Alma Example"));
    expect(text.indexOf("PURCHASER 2")).toBeLessThan(text.indexOf("Bram Sample"));
    expect(out.anchors.map((a) => [a.role, a.slot])).toEqual([
      ["seller", 1],
      ["purchaser", 1],
      ["purchaser", 2],
    ]);
  });

  test("three purchasers on the two-slot template: needs_human, no PDF", async () => {
    const original = (await read(SAMPLES[0]!)).rec.result.data!;
    const out = await renderSpaAgreement(dealFor(original, [buyer("A One"), buyer("B Two"), buyer("C Three")]));
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.status).toBe("needs_human");
    expect(out.problems).toContain("3 purchasers, template has 2 slots.");
  });

  test("the placeholder template prints its plan as a table after the sentence it sat in", async () => {
    const s = SAMPLES[2]!;
    const original = (await read(s)).rec.result.data!;
    const out = await renderSpaAgreement(dealFor(original, [buyer("Alma Example")]));
    if (!out.ok) throw new Error(out.problems.join(" / "));
    const kinds = out.blocks.map((b) => b.kind);
    expect(kinds.filter((k) => k === "table")).toHaveLength(1);
    const text = await textOf(out.bytes);
    expect(text).toContain("The price is AED 1,250,000, paid as per");
    expect(text.indexOf("Booking")).toBeGreaterThan(text.indexOf("paid as per"));
    expect(text).toContain("1 December 2026");
    expect(text).toContain("AED 250,000");
  });

  test("a deal with no value for a core key stops the render of a real template", async () => {
    const original = (await read(SAMPLES[1]!)).rec.result.data!;
    const i = dealFor(original, [buyer("Alma Example")]);
    i.values = { ...i.values, price: null };
    const out = await renderSpaAgreement(i);
    expect(out.ok).toBe(false);
    if (out.ok) return;
    expect(out.problems.join(" ")).toContain("No value for Sale price");
  });

  test("header, footer and logo carry over (header with a page marker, footer with the page count)", async () => {
    const s = {
      ...SAMPLES[2]!,
      spec: {
        ...SAMPLES[2]!.spec,
        header: "Example Homes Sample | Agreement",
        footer: "Page {n} of {N}",
        logo: { colour: [200, 30, 30] as [number, number, number] },
      },
    };
    const original = (await read(s)).rec.result.data!;
    expect(original.style.header).toBe("Example Homes Sample | Agreement");
    expect(original.logo).not.toBeNull();
    const i = dealFor(original, [buyer("Alma Example")]);
    // A one-page sample reads back huge top and bottom margins (no body text near the edges); the usual 72 pt
    // puts the header and footer in the band the reader looks at.
    i.template.style = { ...original.style, margins: { ...original.style.margins, topPt: 72, bottomPt: 72 } };
    const logo = original.logo!;
    i.template.logo = {
      bytes: Buffer.from(logo.base64, "base64"),
      mime: logo.mime,
      widthPx: logo.widthPx,
      heightPx: logo.heightPx,
    };
    const out = await renderSpaAgreement(i);
    if (!out.ok) throw new Error(out.problems.join(" / "));
    const again = (await read(s, out.bytes)).rec.result.data!;
    expect(fingerprint(again)).toEqual(fingerprint(original));
    expect(again.logo).not.toBeNull();
  });
});
