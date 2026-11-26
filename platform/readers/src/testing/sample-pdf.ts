import { PDFDocument, type PDFFont, rgb, StandardFonts } from "pdf-lib";
import { encodePng } from "../structure/png.ts";

/**
 * Fictional sample agreements for tests and evals of any module, generated with pdf-lib. Nothing here is a real
 * company: names are invented and the logos are simple shapes. Test support only: no runtime code imports it.
 */
export interface SpecSection {
  heading: string;
  lines: string[];
  pageBreakBefore?: boolean;
}
export interface Spec {
  id: string;
  serif: boolean;
  size: [number, number];
  /** RGB 0 to 255. */
  accent: [number, number, number];
  title: string;
  intro: string[];
  sections: SpecSection[];
  header?: string;
  /** `{n}` and `{N}` become the page number and the page count. */
  footer?: string;
  logo?: { colour: [number, number, number] };
  leftMargin: number;
}
const hexOf = (c: [number, number, number]) => `#${c.map((n) => n.toString(16).padStart(2, "0")).join("")}`;

/** A small logo from shapes: a coloured disc on a light tile. */
function logoPng(colour: [number, number, number]): Uint8Array {
  const w = 60;
  const h = 40;
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const inDisc = (x - 30) ** 2 + (y - 20) ** 2 < 15 ** 2;
      const o = (y * w + x) * 4;
      const c = inDisc ? colour : [235, 235, 235];
      px[o] = c[0]!;
      px[o + 1] = c[1]!;
      px[o + 2] = c[2]!;
      px[o + 3] = 255;
    }
  return encodePng(w, h, 4, px);
}

type Op = {
  kind: "text";
  x: number;
  y: number;
  text: string;
  size: number;
  bold: boolean;
  colour?: [number, number, number];
};

export async function generatePdf(s: Spec): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const reg = await doc.embedFont(s.serif ? StandardFonts.TimesRoman : StandardFonts.Helvetica);
  const bold = await doc.embedFont(s.serif ? StandardFonts.TimesRomanBold : StandardFonts.HelveticaBold);
  const [W, H] = s.size;
  const maxW = W - s.leftMargin * 2;
  const pages: Op[][] = [[]];
  let y = H - 140;
  const wrap = (text: string, font: PDFFont, size: number): string[] => {
    const out: string[] = [];
    let cur = "";
    for (const word of text.split(" ")) {
      const next = cur ? `${cur} ${word}` : word;
      if (font.widthOfTextAtSize(next, size) > maxW && cur) {
        out.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) out.push(cur);
    return out;
  };
  const put = (text: string, size: number, isBold: boolean, colour?: [number, number, number]) => {
    for (const l of wrap(text, isBold ? bold : reg, size)) {
      if (y < 90) {
        pages.push([]);
        y = H - 100;
      }
      pages
        .at(-1)!
        .push({ kind: "text", x: s.leftMargin, y, text: l, size, bold: isBold, ...(colour ? { colour } : {}) });
      y -= size + 4;
    }
  };
  put(s.title, 20, true, s.accent);
  y -= 8;
  for (const l of s.intro) put(l, 11, false);
  for (const sec of s.sections) {
    if (sec.pageBreakBefore) {
      pages.push([]);
      y = H - 100;
    }
    y -= 10;
    put(sec.heading, 14, true, s.accent);
    y -= 2;
    for (const l of sec.lines) put(l, 11, false);
  }
  const png = s.logo ? await doc.embedPng(logoPng(s.logo.colour)) : null;
  pages.forEach((ops, i) => {
    const p = doc.addPage([W, H]);
    if (s.header)
      p.drawText(s.header, {
        x: s.leftMargin + (png ? 70 : 0),
        y: H - 36,
        size: 9,
        font: reg,
        color: rgb(0.3, 0.3, 0.3),
      });
    if (png && i === 0) p.drawImage(png, { x: s.leftMargin, y: H - 70, width: 60, height: 40 });
    if (s.footer) {
      const t = s.footer.replace("{n}", String(i + 1)).replace("{N}", String(pages.length));
      p.drawText(t, { x: s.leftMargin, y: 30, size: 9, font: reg, color: rgb(0.3, 0.3, 0.3) });
    }
    p.drawRectangle({
      x: s.leftMargin,
      y: H - 80,
      width: maxW,
      height: 1,
      color: rgb(...(s.accent.map((c) => c / 255) as [number, number, number])),
    });
    for (const o of ops) {
      p.drawText(o.text, {
        x: o.x,
        y: o.y,
        size: o.size,
        font: o.bold ? bold : reg,
        color: o.colour ? rgb(...(o.colour.map((c) => c / 255) as [number, number, number])) : rgb(0, 0, 0),
      });
    }
  });
  return doc.save();
}

export { hexOf };
