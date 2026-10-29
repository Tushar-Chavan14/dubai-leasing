import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";

/**
 * Renders a simple structured document to an A4 PDF: plain typography, no logos or government
 * branding. Content comes from the notice templates in `packages/helpers`.
 */
export type PdfBlock =
  | { kind: "title"; text: string }
  | { kind: "meta"; rows: [string, string][] }
  | { kind: "heading"; text: string }
  | { kind: "para"; text: string }
  | { kind: "facts"; rows: [string, string][] }
  | { kind: "list"; items: string[] }
  | { kind: "small"; text: string };

const A4: [number, number] = [595.28, 841.89];
const MARGIN = 56;
const INK = rgb(0.1, 0.11, 0.12);
const MUTED = rgb(0.41, 0.44, 0.46);
const LINE = rgb(0.85, 0.87, 0.85);

/** Standard PDF fonts only cover WinAnsi; replace characters they can't draw. */
export const safe = (s: string) =>
  s
    .replace(/[−–—]/g, "-")
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[^\x20-\x7e\xa0-\xff\n]/g, "?");

export async function renderPdf(meta: { title: string; subject: string }, blocks: PdfBlock[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle(safe(meta.title));
  doc.setSubject(safe(meta.subject));
  doc.setProducer("Dubai Leasing");
  doc.setCreator("Dubai Leasing");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  let page = doc.addPage(A4);
  let y = A4[1] - MARGIN;
  const width = A4[0] - MARGIN * 2;

  const ensure = (h: number) => {
    if (y - h < MARGIN) {
      page = doc.addPage(A4);
      y = A4[1] - MARGIN;
    }
  };
  const wrap = (text: string, font: PDFFont, size: number, max: number) => {
    const words = safe(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
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
    opts: { font?: PDFFont; size?: number; color?: ReturnType<typeof rgb>; x?: number; max?: number; gap?: number },
  ) => {
    const font = opts.font ?? regular;
    const size = opts.size ?? 10.5;
    const lh = size * 1.45;
    for (const l of wrap(text, font, size, opts.max ?? width)) {
      ensure(lh);
      page.drawText(l, { x: opts.x ?? MARGIN, y: y - size, size, font, color: opts.color ?? INK });
      y -= lh;
    }
    y -= opts.gap ?? 6;
  };
  const rows = (rs: [string, string][]) => {
    const keyW = 150;
    for (const [k, v] of rs) {
      const vLines = wrap(v, regular, 10.5, width - keyW);
      const h = Math.max(1, vLines.length) * 15.2;
      ensure(h);
      page.drawText(safe(k), { x: MARGIN, y: y - 10.5, size: 10, font: regular, color: MUTED });
      vLines.forEach((l, i) =>
        page.drawText(l, { x: MARGIN + keyW, y: y - 10.5 - i * 15.2, size: 10.5, font: bold, color: INK }),
      );
      y -= h + 2;
    }
    y -= 8;
  };

  for (const b of blocks) {
    switch (b.kind) {
      case "title":
        write(b.text, { font: bold, size: 18, gap: 14 });
        break;
      case "meta":
        rows(b.rows);
        ensure(12);
        page.drawLine({ start: { x: MARGIN, y }, end: { x: A4[0] - MARGIN, y }, thickness: 0.8, color: LINE });
        y -= 16;
        break;
      case "heading":
        y -= 4;
        write(b.text, { font: bold, size: 12, gap: 4 });
        break;
      case "para":
        write(b.text, { gap: 8 });
        break;
      case "facts":
        rows(b.rows);
        break;
      case "list":
        for (const it of b.items) {
          ensure(16);
          page.drawText("-", { x: MARGIN, y: y - 10.5, size: 10.5, font: regular, color: INK });
          write(it, { x: MARGIN + 14, max: width - 14, gap: 2 });
        }
        y -= 6;
        break;
      case "small":
        y -= 10;
        write(b.text, { size: 8.5, color: MUTED });
        break;
    }
  }
  const pages = doc.getPages();
  pages.forEach((p, i) =>
    p.drawText(`Page ${i + 1} of ${pages.length}`, {
      x: A4[0] - MARGIN - 60,
      y: 28,
      size: 8,
      font: regular,
      color: MUTED,
    }),
  );
  // Deterministic output for the same content: fixed dates in the PDF metadata.
  doc.setCreationDate(new Date(0));
  doc.setModificationDate(new Date(0));
  return doc.save({ useObjectStreams: false });
}
