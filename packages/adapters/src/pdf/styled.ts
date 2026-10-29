import { degrees, PDFDocument, type PDFFont, type PDFImage, rgb, StandardFonts } from "pdf-lib";
import { safe } from "./render.ts";

/**
 * Renders a contract in a company's look (slice 4): page size and margins, a serif or sans standard
 * font, heading sizes and weights, an accent colour on headings and rules, header and footer text
 * on every page, and the company's logo on page 1. The look comes from a reviewed company template
 * (never from a model at render time). Nothing here draws a government mark.
 */
export type StyledBlock =
  | { kind: "title"; text: string }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "list"; items: string[] }
  | { kind: "sigline"; label: string }
  | { kind: "small"; text: string };

export interface PdfLook {
  page: { widthPt: number; heightPt: number };
  margins: { topPt: number; rightPt: number; bottomPt: number; leftPt: number };
  font: { regular: "Times-Roman" | "Times-Bold" | "Helvetica" | "Helvetica-Bold"; bold: string };
  sizes: { bodyPt: number; headingPt: number; titlePt: number | null };
  headingBold: boolean;
  /** `#rrggbb`, or null for the neutral colour. */
  accentColour: string | null;
  /** `{page}` and `{pages}` stand for the page numbers. Null: none. */
  header: string | null;
  footer: string | null;
}

export interface PdfLogo {
  bytes: Uint8Array;
  mime: string;
  /** Pixel size, to keep the aspect ratio. */
  widthPx: number;
  heightPx: number;
}

/** The logo image can't be read (corrupt or not a PNG/JPEG). */
export class PdfLogoError extends Error {}

const INK = rgb(0.1, 0.11, 0.12);
const MUTED = rgb(0.41, 0.44, 0.46);
const NEUTRAL = rgb(0.25, 0.27, 0.29);
const LINE = rgb(0.75, 0.77, 0.75);
const LOGO_MAX_W = 150;
const LOGO_MAX_H = 56;
const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const hex = (c: string | null) => {
  const m = c && /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(c);
  return m ? rgb(parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255) : null;
};

const STANDARD: Record<string, StandardFonts> = {
  "Times-Roman": StandardFonts.TimesRoman,
  "Times-Bold": StandardFonts.TimesRomanBold,
  Helvetica: StandardFonts.Helvetica,
  "Helvetica-Bold": StandardFonts.HelveticaBold,
};

export async function renderStyledPdf(
  meta: { title: string; subject: string },
  blocks: StyledBlock[],
  look: PdfLook,
  opts: { logo?: PdfLogo | null; watermark?: string | null } = {},
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(meta.title));
  doc.setSubject(safe(meta.subject));
  doc.setProducer("Dubai Leasing");
  doc.setCreator("Dubai Leasing");
  const regular = await doc.embedFont(STANDARD[look.font.regular] ?? StandardFonts.Helvetica);
  const bold = await doc.embedFont(STANDARD[look.font.bold] ?? StandardFonts.HelveticaBold);
  const W = clamp(look.page.widthPt, 200, 1200);
  const H = clamp(look.page.heightPt, 200, 1700);
  const left = clamp(look.margins.leftPt, 18, 144);
  const right = clamp(look.margins.rightPt, 18, 144);
  // Room for the header and footer text above and below the body.
  const top = Math.max(clamp(look.margins.topPt, 18, 144), look.header ? 48 : 0);
  const bottom = Math.max(clamp(look.margins.bottomPt, 18, 144), 48);
  const body = clamp(look.sizes.bodyPt, 7, 16);
  const headingSize = clamp(look.sizes.headingPt, body, 24);
  const titleSize = clamp(look.sizes.titlePt ?? headingSize + 4, headingSize, 30);
  const accent = hex(look.accentColour);
  const headingColour = accent ?? NEUTRAL;
  const width = W - left - right;

  let image: PDFImage | null = null;
  let logoW = 0;
  let logoH = 0;
  if (opts.logo) {
    const mime = opts.logo.mime.toLowerCase();
    try {
      image = mime.includes("png") ? await doc.embedPng(opts.logo.bytes) : await doc.embedJpg(opts.logo.bytes);
    } catch {
      throw new PdfLogoError("The logo image can't be read.");
    }
    const scale = Math.min(
      LOGO_MAX_W / Math.max(1, opts.logo.widthPx),
      LOGO_MAX_H / Math.max(1, opts.logo.heightPx),
      1,
    );
    logoW = opts.logo.widthPx * scale;
    logoH = opts.logo.heightPx * scale;
  }

  let page = doc.addPage([W, H]);
  let y = H - top;
  if (image) {
    page.drawImage(image, { x: left, y: y - logoH, width: logoW, height: logoH });
    y -= logoH + 14;
  }
  const ensure = (h: number) => {
    if (y - h < bottom) {
      page = doc.addPage([W, H]);
      y = H - top;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, max: number) => {
    const lines: string[] = [];
    let line = "";
    for (const w of safe(text).split(/\s+/)) {
      const next = line ? `${line} ${w}` : w;
      if (font.widthOfTextAtSize(next, size) > max && line) {
        lines.push(line);
        line = w;
      } else line = next;
    }
    if (line) lines.push(line);
    return lines;
  };
  const write = (
    text: string,
    o: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; max?: number; gap?: number } = {},
  ) => {
    const font = o.font ?? regular;
    const size = o.size ?? body;
    const lh = size * 1.45;
    for (const l of wrap(text, font, size, o.max ?? width)) {
      ensure(lh);
      page.drawText(l, { x: o.x ?? left, y: y - size, size, font, color: o.color ?? INK });
      y -= lh;
    }
    y -= o.gap ?? 6;
  };
  const rule = (color = accent ?? LINE) => {
    ensure(10);
    page.drawLine({ start: { x: left, y }, end: { x: W - right, y }, thickness: 0.8, color });
    y -= 10;
  };

  for (const b of blocks) {
    switch (b.kind) {
      case "title":
        write(b.text, { font: bold, size: titleSize, color: headingColour, gap: 6 });
        rule();
        y -= 4;
        break;
      case "heading":
        y -= 6;
        ensure(headingSize * 1.45 + 24);
        write(b.text, { font: look.headingBold ? bold : regular, size: headingSize, color: headingColour, gap: 4 });
        break;
      case "para":
        write(b.text, { gap: 8 });
        break;
      case "list":
        for (const it of b.items) {
          ensure(body * 1.45 + 4);
          page.drawText("-", { x: left, y: y - body, size: body, font: regular, color: INK });
          write(it, { x: left + 14, max: width - 14, gap: 2 });
        }
        y -= 6;
        break;
      case "sigline": {
        ensure(52);
        y -= 22;
        page.drawLine({
          start: { x: left, y },
          end: { x: left + Math.min(240, width), y },
          thickness: 0.7,
          color: INK,
        });
        y -= 4;
        write(b.label, { size: body - 1, color: MUTED, gap: 10 });
        break;
      }
      case "small":
        y -= 10;
        write(b.text, { size: Math.max(7, body - 2), color: MUTED });
        break;
    }
  }

  const pages = doc.getPages();
  const fill = (s: string, i: number) =>
    safe(s.replaceAll("{pages}", String(pages.length)).replaceAll("{page}", String(i + 1)));
  const small = Math.max(7, body - 3);
  /** One line, cut with an ellipsis when it is wider than the text area. */
  const oneLine = (text: string) => {
    let t = safe(text).replace(/\s+/g, " ").trim();
    if (regular.widthOfTextAtSize(t, small) <= width) return t;
    while (t.length > 1 && regular.widthOfTextAtSize(`${t}...`, small) > width) t = t.slice(0, -1);
    return `${t.trimEnd()}...`;
  };
  pages.forEach((p, i) => {
    if (look.header) {
      p.drawText(oneLine(fill(look.header, i)), {
        x: left,
        y: H - top / 2 - small / 2,
        size: small,
        font: regular,
        color: MUTED,
      });
    }
    const footer = look.footer ? fill(look.footer, i) : `Page ${i + 1} of ${pages.length}`;
    p.drawText(oneLine(footer), {
      x: left,
      y: bottom / 2 - small / 2,
      size: small,
      font: regular,
      color: MUTED,
    });
    if (opts.watermark) {
      const size = Math.min(110, (W * 0.9) / Math.max(4, opts.watermark.length) / 0.7);
      p.drawText(safe(opts.watermark), {
        x: W * 0.14,
        y: H * 0.3,
        size,
        font: bold,
        color: rgb(0.85, 0.85, 0.85),
        opacity: 0.45,
        rotate: degrees(40),
      });
    }
  });
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc.save({ useObjectStreams: false });
}
