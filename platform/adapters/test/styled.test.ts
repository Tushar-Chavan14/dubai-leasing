import { describe, expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
import { extractPdf } from "../../readers/src/pdf/extract.ts";
import { type PdfLook, renderStyledPdf, renderStyledPdfWithAnchors, type StyledBlock } from "../src/index.ts";

const look: PdfLook = {
  page: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 60, rightPt: 56, bottomPt: 60, leftPt: 56 },
  font: { regular: "Helvetica", bold: "Helvetica-Bold" },
  sizes: { bodyPt: 11, headingPt: 13, titlePt: 16 },
  headingBold: true,
  accentColour: "#143c6e",
  header: null,
  footer: null,
};
const meta = { title: "T", subject: "S" };
const textOf = async (bytes: Uint8Array) => {
  const r = await extractPdf(bytes);
  if (!r.ok) throw new Error(r.message);
  return r.text;
};

describe("table block", () => {
  const blocks: StyledBlock[] = [
    { kind: "title", text: "Agreement" },
    {
      kind: "table",
      head: ["No.", "Due date", "Amount"],
      rows: [
        ["1", "1 January 2027", "AED 100,000"],
        ["2", "1 March 2027", "AED 50,000"],
      ],
      widths: [1, 3, 3],
    },
    { kind: "para", text: "After the table." },
  ];

  test("prints the head and every row, in order, and the text after it", async () => {
    const { bytes } = await renderStyledPdfWithAnchors(meta, blocks, look);
    const t = await textOf(bytes);
    const at = (s: string) => t.indexOf(s);
    for (const s of ["No.", "Due date", "Amount", "1 January 2027", "AED 100,000", "1 March 2027", "AED 50,000"])
      expect(at(s)).toBeGreaterThan(-1);
    expect(at("Amount")).toBeLessThan(at("AED 100,000"));
    expect(at("AED 100,000")).toBeLessThan(at("AED 50,000"));
    expect(at("AED 50,000")).toBeLessThan(at("After the table."));
  });

  test("a long table breaks across pages and repeats its head", async () => {
    const rows = Array.from({ length: 80 }, (_, i) => [String(i + 1), "1 January 2027", "AED 1,000"]);
    const { bytes } = await renderStyledPdfWithAnchors(
      meta,
      [{ kind: "table", head: ["No.", "Due", "Amount"], rows }],
      look,
    );
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    const t = await textOf(bytes);
    expect(t.split("Amount").length - 1).toBeGreaterThan(1);
    expect(t).toContain("80 1 January 2027 AED 1,000");
  });

  test("a table with no rows still prints its head", async () => {
    const { bytes } = await renderStyledPdfWithAnchors(
      meta,
      [
        { kind: "para", text: "Enough text on this page to count as text." },
        { kind: "table", head: ["Alpha", "Beta"], rows: [] },
      ],
      look,
    );
    expect(await textOf(bytes)).toContain("Alpha Beta");
  });
});

describe("signature anchors", () => {
  const blocks: StyledBlock[] = [
    { kind: "para", text: "Sign below." },
    { kind: "sigline", label: "Seller", role: "seller", slot: null },
    { kind: "sigline", label: "Purchaser 1", role: "purchaser", slot: 1 },
    { kind: "sigline", label: "Purchaser 2", role: "purchaser", slot: 2 },
  ];

  test("one anchor per signature line, in order, with its role and slot", async () => {
    const { anchors } = await renderStyledPdfWithAnchors(meta, blocks, look);
    expect(anchors.map((a) => [a.role, a.slot, a.page])).toEqual([
      ["seller", null, 1],
      ["purchaser", 1, 1],
      ["purchaser", 2, 1],
    ]);
    expect(anchors[0]!.xPt).toBe(56);
    expect(anchors[0]!.widthPt).toBe(240);
    // Lower on the page for each later line (PDF y grows upward).
    expect(anchors[1]!.yPt).toBeLessThan(anchors[0]!.yPt);
    expect(anchors[2]!.yPt).toBeLessThan(anchors[1]!.yPt);
  });

  test("a line that moves to the next page is anchored on that page", async () => {
    const filler: StyledBlock[] = Array.from({ length: 60 }, (_, i) => ({ kind: "para", text: `Clause ${i + 1}.` }));
    const { anchors } = await renderStyledPdfWithAnchors(meta, [...filler, ...blocks], look);
    expect(anchors.length).toBe(3);
    const pages = anchors.map((a) => a.page);
    expect(pages[0]).toBeGreaterThanOrEqual(1);
    expect(pages).toEqual(pages.toSorted((a, b) => a - b));
  });

  test("a line without a role gets a null role and slot", async () => {
    const { anchors } = await renderStyledPdfWithAnchors(meta, [{ kind: "sigline", label: "Someone" }], look);
    expect(anchors).toEqual([expect.objectContaining({ role: null, slot: null, page: 1 })]);
  });
});

describe("fixed dates", () => {
  const blocks: StyledBlock[] = [{ kind: "para", text: "Same text." }];
  const dateOf = async (bytes: Uint8Array) =>
    (await PDFDocument.load(bytes, { updateMetadata: false })).getCreationDate()?.toISOString();

  test("without `now` the dates are the epoch and the old function is unchanged", async () => {
    const a = await renderStyledPdf(meta, blocks, look);
    const b = (await renderStyledPdfWithAnchors(meta, blocks, look)).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(await dateOf(a)).toBe("1970-01-01T00:00:00.000Z");
  });

  test("the caller's `now` sets creation and modification dates; same input and now give the same bytes", async () => {
    const now = new Date("2026-11-19T08:00:00Z");
    const a = (await renderStyledPdfWithAnchors(meta, blocks, look, { now })).bytes;
    const b = (await renderStyledPdfWithAnchors(meta, blocks, look, { now })).bytes;
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
    expect(await dateOf(a)).toBe("2026-11-19T08:00:00.000Z");
    expect((await PDFDocument.load(a, { updateMetadata: false })).getModificationDate()?.toISOString()).toBe(
      "2026-11-19T08:00:00.000Z",
    );
  });
});
