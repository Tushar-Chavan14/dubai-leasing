import { describe, expect, test } from "bun:test";
import { renderStyledPdf } from "@platform/adapters";
import { extractPdf } from "@platform/readers/pdf/extract";
import {
  DEFAULT_STYLE,
  SAMPLE_CONTRACT_FIELDS,
  type TemplateBlank,
  type TemplateSections,
  templateContractBlocks,
} from "../src/index.ts";

/**
 * C14 golden: the leasing render (blocks, PDF text and PDF bytes) recorded before the generic part moved to
 * `@platform/readers/render`. It must stay identical. Re-record only on purpose: `GOLDEN_UPDATE=1 bun test <this file>`.
 */
const GOLDEN = new URL("./fixtures/render.golden.json", import.meta.url);

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
  title: "RESIDENTIAL TENANCY AGREEMENT {{b9}}",
  items: [
    { id: "s0", number: null, heading: null, paragraphs: ["Made between {{b1}} (Landlord) and {{b2}} (Tenant)."] },
    {
      id: "s1",
      number: "Article I",
      heading: "Rent",
      paragraphs: [
        "The annual rent is {{b3}}.",
        "The term starts on {{b4}}, ends on {{b7}}, rent-free days {{b8}}.",
        "Dropped line {{b3}}.",
        "Linked line {{b3}}.",
      ],
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
  blank("b7", "End date", "endOn", "ends on "),
  blank("b8", "Rent free", "rentFreeDays", "rent-free days ", { fieldType: "int" }),
  blank("b9", "Tenant passport", "tenantPassportNo", "", { marker: "[passport]" }),
];
const add = { clauses: [], freeText: "Pets need written consent." };
const extras = { chequePayeeName: "Sample Landlord LLC", allFeesList: "Admin fee AED 500 (tenant)" };
const look = {
  page: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 56, rightPt: 56, bottomPt: 56, leftPt: 56 },
  font: { regular: "Times-Roman" as const, bold: "Times-Bold" },
  sizes: { bodyPt: 11, headingPt: 13, titlePt: 16 },
  headingBold: true,
  accentColour: "#143c6e",
  header: "Sample Co | Tenancy {page}",
  footer: "Footer {page} of {pages}",
};

async function snapshot() {
  const base = { sections, blanks: blanks(), templateVersion: 3, dropped: ["s1:2"] };
  const runs = {
    final: templateContractBlocks(
      { ...base, paragraphs: { "s1:3": "Linked rent {{b3}} (company clause).", "s0:0": null } },
      { ...SAMPLE_CONTRACT_FIELDS, tenantPassportNo: "X1234567" },
      add,
      { version: 2, reference: "C-TEST", demo: false, extras },
    ),
    demo: templateContractBlocks(base, SAMPLE_CONTRACT_FIELDS, add, {
      version: 1,
      reference: "C-D",
      demo: true,
      extras,
    }),
    preview: templateContractBlocks(base, SAMPLE_CONTRACT_FIELDS, add, {
      version: 1,
      reference: "C-P",
      demo: false,
      preview: true,
    }),
  };
  const out: Record<string, unknown> = {};
  for (const [name, r] of Object.entries(runs)) {
    const bytes = await renderStyledPdf({ title: r.title, subject: "golden" }, r.blocks, look, {
      watermark: name === "preview" ? "PREVIEW" : null,
    });
    const text = await extractPdf(bytes);
    out[name] = {
      title: r.title,
      blocks: r.blocks,
      leftEmpty: r.leftEmpty,
      filled: r.filled,
      paragraphs: r.paragraphs,
      pdfText: text.ok ? text.text : text.message,
      pdfSha256: new Bun.CryptoHasher("sha256").update(bytes).digest("hex"),
    };
  }
  out.defaultStyle = DEFAULT_STYLE;
  return JSON.parse(JSON.stringify(out)) as unknown;
}

describe("leasing render golden (C14)", () => {
  test("blocks, PDF text and PDF bytes match the recorded golden", async () => {
    const now = await snapshot();
    if (process.env.GOLDEN_UPDATE === "1") await Bun.write(GOLDEN, `${JSON.stringify(now, null, 1)}\n`);
    expect(now).toEqual(await Bun.file(GOLDEN).json());
  });
});
