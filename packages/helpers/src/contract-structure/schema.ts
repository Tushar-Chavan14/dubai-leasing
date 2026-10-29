import { z } from "zod";

/** Limits (the extraction limits listed in the task report). */
export const MAX_SECTIONS = 60;
export const MAX_BLANKS = 200;
export const MAX_PROMPT_CHARS = 60_000;
export const MAX_LOGO_BYTES = 512 * 1024;
export const MAX_LOGO_PIXELS = 4096 * 4096;

export const ContractStructureContext = z.object({ docId: z.string().min(1) });
export type ContractStructureContext = z.infer<typeof ContractStructureContext>;

export const NUMBERING_STYLES = ["article", "clause", "roman", "decimal", "decimal_nested", "alpha", "none"] as const;
export type NumberingStyle = (typeof NUMBERING_STYLES)[number];

/** What the model may return. Untrusted: code validates every id, heading and field name. */
export const StructureModelOutput = z.object({
  sections: z.array(z.object({ heading: z.string().min(1).max(160) })).max(MAX_SECTIONS * 2),
  blanks: z
    .array(
      z.object({ id: z.string().min(1).max(20), label: z.string().max(200), field: z.string().max(60).optional() }),
    )
    .max(MAX_BLANKS * 2),
});
export type StructureModelOutput = z.infer<typeof StructureModelOutput>;

/** `sections` column: ordered sections, fixed wording copied from the sample by code. */
export const TemplateSection = z.object({
  id: z.string(),
  /** The number as printed ("1.", "Article II"), null when the heading has none. */
  number: z.string().nullable(),
  /** Null for the opening part before the first heading. */
  heading: z.string().nullable(),
  /** Fixed wording, one entry per paragraph, verbatim from the sample. A blank is the token `{{bN}}`. */
  paragraphs: z.array(z.string()),
});
export type TemplateSection = z.infer<typeof TemplateSection>;

export const TemplateSections = z.object({
  numbering: z.enum(NUMBERING_STYLES),
  /** First line of the sample when it is not a section heading. */
  title: z.string().nullable(),
  items: z.array(TemplateSection).max(MAX_SECTIONS),
});
export type TemplateSections = z.infer<typeof TemplateSections>;

export const MAPPING_SOURCES = ["matched", "model", "empty", "admin"] as const;
/** How a mapping was chosen: code rule, decision model, left empty (unsure or not stored), or the admin. */
export type MappingSource = (typeof MAPPING_SOURCES)[number];

export const BLANK_KINDS = ["underscore", "dots", "bracket", "label"] as const;

/** `blanks` column entry. A blank is rendered only when `field` is set (or `role` is "signature"). */
export const TemplateBlank = z.object({
  /** `b1`, `b2`, …: the token `{{b1}}` in the section paragraphs. */
  id: z.string(),
  kind: z.enum(BLANK_KINDS),
  /** The marker as printed in the sample (empty for a "Label:" blank). */
  marker: z.string(),
  label: z.string().max(80),
  /**
   * A data-sheet key (see `datasheet.ts`), "leave_empty" (printed as an empty line, filled by hand), or "unmapped"
   * (legacy, same as leave_empty). Chosen by code and the model once at extraction; validated by code.
   */
  field: z.string().min(1).max(60),
  /** How the mapping was chosen (absent on templates read before this existed). */
  source: z.enum(MAPPING_SOURCES).optional(),
  fieldType: z.enum(["text", "money_fils", "date", "int", "enum"]).nullable(),
  /** "signature" blanks are signature or stamp lines: they never map to a field. */
  role: z.enum(["field", "signature"]),
  /** Index into `sections.items`. */
  sectionIndex: z.number().int().min(0),
  /** Text around the blank in the sample, for the review screen. */
  before: z.string().max(200),
  after: z.string().max(100),
  /** Why a proposed mapping was rejected by code, if it was. */
  note: z.string().max(200).optional(),
});
export type TemplateBlank = z.infer<typeof TemplateBlank>;

export const STANDARD_FONTS = ["Times-Roman", "Times-Bold", "Helvetica", "Helvetica-Bold"] as const;
export const HexColour = z.string().regex(/^#[0-9a-f]{6}$/);

/** `style` column. All values read from the PDF by code. */
export const TemplateStyle = z.object({
  /** False when the look could not be read and these are the defaults. */
  fromSample: z.boolean(),
  page: z.object({ widthPt: z.number(), heightPt: z.number() }),
  margins: z.object({ topPt: z.number(), rightPt: z.number(), bottomPt: z.number(), leftPt: z.number() }),
  font: z.object({
    family: z.enum(["serif", "sans"]),
    /** pdf-lib standard font names (`StandardFonts`). */
    regular: z.enum(STANDARD_FONTS),
    bold: z.enum(STANDARD_FONTS),
    /** Font names found in the sample (display only). */
    observed: z.array(z.string().max(80)).max(6),
  }),
  sizes: z.object({
    bodyPt: z.number(),
    headingPt: z.number(),
    titlePt: z.number().nullable(),
  }),
  headingBold: z.boolean(),
  accentColour: HexColour.nullable(),
  /** Text repeated at the top or bottom of the pages (`{page}` and `{pages}` stand for page numbers). */
  header: z.string().max(400).nullable(),
  footer: z.string().max(400).nullable(),
  flags: z.object({
    /** Rule 9: the header, footer or logo area carries DLD or Ejari wording. Task 3 blocks approval until an admin acts. */
    authorityMarks: z.boolean(),
    areas: z.array(z.enum(["header", "footer", "logo_area"])),
  }),
});
export type TemplateStyle = z.infer<typeof TemplateStyle>;

/** Logo bytes travel as base64 in helper output; the Manager stores them in the documents store. */
export const TemplateLogo = z.object({
  mime: z.literal("image/png"),
  /** At most MAX_LOGO_BYTES of PNG (about 700,000 base64 characters). */
  base64: z.string().max(700_000),
  widthPx: z.number().int().positive(),
  heightPx: z.number().int().positive(),
  /** Size as drawn on page 1, in points. */
  drawnWidthPt: z.number().positive(),
  drawnHeightPt: z.number().positive(),
});
export type TemplateLogo = z.infer<typeof TemplateLogo>;

export const ContractStructureData = z.object({
  sections: TemplateSections,
  blanks: z.array(TemplateBlank).max(MAX_BLANKS),
  style: TemplateStyle,
  logo: TemplateLogo.nullable(),
  pages: z.number().int().min(0),
  /** Model-proposed headings dropped because they are not in the text verbatim. */
  droppedSections: z.number().int().min(0),
  /** Blanks with no valid field (and not signatures): each blocks approval until mapped. */
  unmappedBlanks: z.number().int().min(0),
});
export type ContractStructureData = z.infer<typeof ContractStructureData>;

export const ContractStructureSchemas = { context: ContractStructureContext, data: ContractStructureData };
