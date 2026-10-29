import { getDocumentProxy, getResolvedPDFJS } from "unpdf";
import { isPdf, MAX_BYTES, normalizeWs, type ParseState, raceTimeout } from "../contract-template/extract.ts";
import { MAX_PAGES } from "../contract-template/schema.ts";
import { encodePng } from "./png.ts";
import { MAX_LOGO_BYTES, MAX_LOGO_PIXELS, type TemplateLogo, type TemplateStyle } from "./schema.ts";

/** Pages read for the look (headers and footers are judged on these). */
export const LOOK_MAX_PAGES = 12;
const BAND = 0.08;
const LOGO_ZONE = 0.25;
const MIN_MARGIN = 18;
const MAX_MARGIN = 144;

/** Arabic folded to one spelling: no tatweel or marks, alef variants to alef, ya and ta marbuta unified. */
const foldArabic = (t: string): string =>
  t
    .normalize("NFKC")
    .replace(/[\u0640\u064B-\u065F\u0670]/g, "")
    .replace(/[\u0622\u0623\u0625\u0671]/g, "\u0627")
    .replace(/\u0649/g, "\u064A")
    .replace(/\u0629/g, "\u0647")
    .replace(/\u0626/g, "\u064A");
const arPhrase = (p: string) => foldArabic(p).split(/\s+/).join("\\s*");
const AUTHORITY_EN =
  /dubai\s*land\s*department|land\s*department|\bDLD\b|\bRERA\b|real\s*estate\s*regulatory|government\s*of\s*dubai|\bejari\b/i;
const AUTHORITY_AR = new RegExp(
  ["دائرة الأراضي", "دائرة الاراضي", "الأراضي والأملاك", "حكومة دبي", "مؤسسة التنظيم العقاري", "إيجاري", "ايجاري"]
    .map(arPhrase)
    .join("|"),
);

/**
 * Rule 9: DLD, RERA, Ejari and Dubai-government branding words, in English or Arabic. The text is
 * NFKC-normalised (Arabic presentation forms) and Arabic spellings are folded first, so spellings
 * without a hamza or with tatweel match too.
 */
export const hasAuthorityMarks = (text: string): boolean => {
  const t = text.normalize("NFKC");
  return AUTHORITY_EN.test(t) || AUTHORITY_AR.test(foldArabic(t));
};

export const DEFAULT_STYLE: TemplateStyle = {
  fromSample: false,
  page: { widthPt: 595, heightPt: 842 },
  margins: { topPt: 72, rightPt: 56, bottomPt: 72, leftPt: 56 },
  font: { family: "sans", regular: "Helvetica", bold: "Helvetica-Bold", observed: [] },
  sizes: { bodyPt: 10, headingPt: 12, titlePt: null },
  headingBold: true,
  accentColour: null,
  header: null,
  footer: null,
  flags: { authorityMarks: false, areas: [] },
};

export type Look =
  | {
      ok: true;
      style: TemplateStyle;
      logo: TemplateLogo | null;
      /** Normalised keys (digits as `#`) of the repeated header and footer lines, so the body text can drop them. */
      repeated: Set<string>;
      /** Lines set in a heading look (bigger or bold-only), not the title: the only lines a section heading may be. */
      headings: Set<string>;
    }
  | { ok: false; message: string };

interface Line {
  text: string;
  x: number;
  right: number;
  y: number;
  size: number;
  bold: boolean;
  serif: boolean;
  fonts: string[];
  chars: number;
}

interface Pdfjs {
  OPS: Record<string, number>;
}

/** `#rrggbb` (pdf.js) or an `[r, g, b]` array of 0 to 255 values to a lower-case hex string. */
function hex(arg: unknown): string | null {
  if (typeof arg === "string" && /^#[0-9a-f]{6}$/i.test(arg)) return arg.toLowerCase();
  if (Array.isArray(arg) && arg.length >= 3 && arg.slice(0, 3).every((n) => typeof n === "number")) {
    return `#${arg
      .slice(0, 3)
      .map((n: number) =>
        Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  }
  return null;
}

/** Multiplies two PDF transform matrices. */
const mul = (a: number[], b: number[]): number[] => [
  a[0]! * b[0]! + a[1]! * b[2]!,
  a[0]! * b[1]! + a[1]! * b[3]!,
  a[2]! * b[0]! + a[3]! * b[2]!,
  a[2]! * b[1]! + a[3]! * b[3]!,
  a[4]! * b[0]! + a[5]! * b[2]! + b[4]!,
  a[4]! * b[1]! + a[5]! * b[3]! + b[5]!,
];

/** Black, white and greys are not an accent. */
function neutral(h: string): boolean {
  const c = [1, 3, 5].map((i) => Number.parseInt(h.slice(i, i + 2), 16));
  return Math.max(...c) - Math.min(...c) < 40;
}

const mode = <T>(m: Map<T, number>): T | undefined => [...m.entries()].toSorted((a, b) => b[1] - a[1])[0]?.[0];
const bump = <T>(m: Map<T, number>, k: T, n = 1) => m.set(k, (m.get(k) ?? 0) + n);
const clamp = (n: number) => Math.round(Math.max(MIN_MARGIN, Math.min(MAX_MARGIN, n)));
export const lineKey = (t: string) => normalizeWs(t).replace(/\d+/g, "#");

function withPageTokens(text: string, page: number, pages: number): string {
  let p = false;
  let n = false;
  return normalizeWs(text).replace(/\d+/g, (d) => {
    if (!p && Number(d) === page) {
      p = true;
      return "{page}";
    }
    if (!n && Number(d) === pages) {
      n = true;
      return "{pages}";
    }
    return d;
  });
}

/**
 * Reads the look of a sample PDF with pdf.js (unpdf): page size, margins, fonts, sizes, accent
 * colour, repeated header and footer, and the logo. Same limits as the text extraction: 10 MB,
 * 60 pages, 30 s, the document is destroyed afterwards. Never throws; returns `ok: false`.
 */
export async function extractLook(bytes: Uint8Array): Promise<Look> {
  if (!isPdf(bytes) || bytes.length > MAX_BYTES) return { ok: false, message: "The file can't be read for its look." };
  return raceTimeout(
    (state) => parse(bytes, state).catch((): Look => ({ ok: false, message: "The look of the PDF couldn't be read." })),
    () => ({ ok: false, message: "Reading the look took too long." }),
  );
}

async function parse(bytes: Uint8Array, state: ParseState): Promise<Look> {
  const { OPS } = (await getResolvedPDFJS()) as unknown as Pdfjs;
  // Bounded image decoding (no huge bitmaps) and no eval of PDF-supplied functions.
  const doc = await getDocumentProxy(new Uint8Array(bytes), {
    maxImageSize: MAX_LOGO_PIXELS,
    isEvalSupported: false,
  } as Parameters<typeof getDocumentProxy>[1]);
  state.destroy = () => void doc.loadingTask.destroy().catch(() => {});
  try {
    if (doc.numPages > MAX_PAGES) return { ok: false, message: "Too many pages to read the look." };
    const n = Math.min(doc.numPages, LOOK_MAX_PAGES);
    const pagesLines: Line[][] = [];
    const sizes = { w: 0, h: 0 };
    const colours = new Map<string, number>();
    const fontNames = new Map<string, number>();
    let logo: TemplateLogo | null = null;
    for (let pn = 1; pn <= n; pn++) {
      if (state.aborted) return { ok: false, message: "Reading the look took too long." };
      const page = await doc.getPage(pn);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const w = x1 - x0;
      const h = y1 - y0;
      if (pn === 1) {
        sizes.w = w;
        sizes.h = h;
      }
      const tc = await page.getTextContent();
      const ol = await page.getOperatorList();
      const fontInfo = new Map<string, { bold: boolean; serif: boolean; name: string }>();
      const info = (id: string) => {
        let f = fontInfo.get(id);
        if (!f) {
          let name = "";
          let bold = false;
          let serif = (tc.styles[id] as { fontFamily?: string } | undefined)?.fontFamily === "serif";
          try {
            if (page.commonObjs.has(id)) {
              const fo = page.commonObjs.get(id) as {
                name?: string;
                bold?: boolean;
                fallbackName?: string;
                systemFontInfo?: { baseFontName?: string };
              };
              name = String(fo.name ?? fo.systemFontInfo?.baseFontName ?? "").slice(0, 80);
              bold = !!fo.bold;
              if (fo.fallbackName) serif = fo.fallbackName === "serif";
            }
          } catch {
            // unknown font: keep the text-content style
          }
          if (/bold|black|heavy|semibold|demi/i.test(name)) bold = true;
          if (name)
            serif = /times|georgia|garamond|palatino|cambria|minion|baskerville|caslon|book/i.test(name)
              ? true
              : /sans|arial|helvet|calibri|verdana|tahoma/i.test(name)
                ? false
                : serif;
          f = { bold, serif, name };
          fontInfo.set(id, f);
        }
        return f;
      };
      // Group text items into lines by baseline.
      const byY = new Map<number, { x: number; right: number; str: string; size: number; font: string }[]>();
      for (const it of tc.items as {
        str?: string;
        transform?: number[];
        width?: number;
        fontName?: string;
      }[]) {
        if (typeof it.str !== "string" || !it.str.trim() || !it.transform) continue;
        const t = it.transform;
        const size = Math.round(Math.hypot(t[2]!, t[3]!) * 2) / 2;
        const y = Math.round((t[5]! - y0) * 2) / 2;
        const row = byY.get(y) ?? [];
        row.push({ x: t[4]! - x0, right: t[4]! - x0 + (it.width ?? 0), str: it.str, size, font: it.fontName ?? "" });
        byY.set(y, row);
      }
      const lines: Line[] = [];
      for (const [y, row] of byY) {
        row.sort((a, b) => a.x - b.x);
        const sz = new Map<number, number>();
        let bold = 0;
        let serif = 0;
        let chars = 0;
        const fonts: string[] = [];
        for (const r of row) {
          const f = info(r.font);
          bump(sz, r.size, r.str.length);
          chars += r.str.length;
          if (f.bold) bold += r.str.length;
          if (f.serif) serif += r.str.length;
          if (f.name) {
            fonts.push(f.name);
            bump(fontNames, f.name, r.str.length);
          }
        }
        lines.push({
          text: normalizeWs(row.map((r) => r.str).join(" ")),
          x: row[0]!.x,
          right: Math.max(...row.map((r) => r.right)),
          y,
          size: mode(sz) ?? 0,
          bold: bold * 2 > chars,
          serif: serif * 2 > chars,
          fonts,
          chars,
        });
      }
      lines.sort((a, b) => b.y - a.y || a.x - b.x);
      pagesLines.push(lines);

      // Operator list: colours of text and lines, and (page 1) images near the top.
      const ctm: number[][] = [[1, 0, 0, 1, 0, 0]];
      let fill: string | null = null;
      let stroke: string | null = null;
      let best: { name: string; area: number; wPt: number; hPt: number } | null = null;
      for (let i = 0; i < ol.fnArray.length; i++) {
        const op = ol.fnArray[i]!;
        const args = ol.argsArray[i] as unknown[] | null;
        if (op === OPS.save) ctm.push([...ctm[ctm.length - 1]!]);
        else if (op === OPS.restore) {
          if (ctm.length > 1) ctm.pop();
        } else if (op === OPS.transform && Array.isArray(args)) {
          ctm[ctm.length - 1] = mul(args as number[], ctm[ctm.length - 1]!);
        } else if (op === OPS.setFillRGBColor) fill = hex(args?.[0]) ?? hex(args);
        else if (op === OPS.setStrokeRGBColor) stroke = hex(args?.[0]) ?? hex(args);
        else if (op === OPS.showText && fill && !neutral(fill)) {
          const glyphs = Array.isArray(args?.[0])
            ? (args![0] as unknown[]).filter((g) => typeof g === "object").length
            : 1;
          bump(colours, fill, glyphs);
        } else if (op === OPS.constructPath && Array.isArray(args)) {
          const paint = args[0];
          const strokes = paint === OPS.stroke || paint === OPS.closeStroke || paint === OPS.fillStroke;
          const fills = paint === OPS.fill || paint === OPS.eoFill || paint === OPS.fillStroke;
          if (fills && fill && !neutral(fill)) bump(colours, fill, 20);
          if (strokes && stroke && !neutral(stroke)) bump(colours, stroke, 20);
        } else if (op === OPS.paintImageXObject && pn === 1 && Array.isArray(args) && typeof args[0] === "string") {
          const m = ctm[ctm.length - 1]!;
          const wPt = Math.hypot(m[0]!, m[1]!);
          const hPt = Math.hypot(m[2]!, m[3]!);
          const centreY = m[5]! + m[3]! / 2 - y0;
          if (centreY >= h * (1 - LOGO_ZONE) && wPt > 4 && hPt > 4 && (!best || wPt * hPt > best.area)) {
            best = { name: args[0], area: wPt * hPt, wPt, hPt };
          }
        }
      }
      if (pn === 1 && best) logo = readLogo(page, best);
      page.cleanup();
    }
    const style = deriveStyle(pagesLines, sizes, colours, fontNames);
    return { ok: true, style: style.style, logo, repeated: style.repeated, headings: style.headings };
  } finally {
    state.aborted = true;
    await doc.loadingTask.destroy().catch(() => {});
  }
}

interface ImgObj {
  width: number;
  height: number;
  kind?: number;
  data?: Uint8Array | Uint8ClampedArray;
}

/** Largest image near the top of page 1 as PNG bytes; `null` when pdf.js has no pixel data or it is too big. */
function readLogo(
  page: { objs: { has(n: string): boolean; get(n: string): unknown } },
  c: { name: string; wPt: number; hPt: number },
): TemplateLogo | null {
  try {
    if (!page.objs.has(c.name)) return null;
    const img = page.objs.get(c.name) as ImgObj | null;
    if (!img?.data || !img.width || !img.height || img.width * img.height > MAX_LOGO_PIXELS) return null;
    const { width, height, data } = img;
    let png: Uint8Array;
    if (img.kind === 2 && data.length >= width * height * 3)
      png = encodePng(width, height, 3, new Uint8Array(data.buffer, data.byteOffset, width * height * 3));
    else if (img.kind === 3 && data.length >= width * height * 4)
      png = encodePng(width, height, 4, new Uint8Array(data.buffer, data.byteOffset, width * height * 4));
    else if (img.kind === 1) {
      // 1 bit per pixel, rows padded to whole bytes.
      const rowBytes = Math.ceil(width / 8);
      if (data.length < rowBytes * height) return null;
      const px = new Uint8Array(width * height);
      for (let y = 0; y < height; y++)
        for (let x = 0; x < width; x++)
          px[y * width + x] = (data[y * rowBytes + (x >> 3)]! >> (7 - (x & 7))) & 1 ? 255 : 0;
      png = encodePng(width, height, 1, px);
    } else return null;
    if (png.length > MAX_LOGO_BYTES) return null;
    return {
      mime: "image/png",
      base64: Buffer.from(png).toString("base64"),
      widthPx: width,
      heightPx: height,
      drawnWidthPt: Math.round(c.wPt * 10) / 10,
      drawnHeightPt: Math.round(c.hPt * 10) / 10,
    };
  } catch {
    return null;
  }
}

function deriveStyle(
  pages: Line[][],
  size: { w: number; h: number },
  colours: Map<string, number>,
  fontNames: Map<string, number>,
): { style: TemplateStyle; repeated: Set<string>; headings: Set<string> } {
  const { w, h } = size;
  const inBand = (l: Line, top: boolean) => (top ? l.y >= h * (1 - BAND) : l.y <= h * BAND);
  const body = pages.map((ls) => ls.filter((l) => !inBand(l, true) && !inBand(l, false)));
  // Header and footer: lines repeated in the top or bottom band of most pages.
  const repeated = new Set<string>();
  const find = (top: boolean): string | null => {
    const seen = new Map<string, { count: number; text: string; y: number; x: number }>();
    pages.forEach((ls, i) => {
      const keys = new Set<string>();
      for (const l of ls.filter((x) => inBand(x, top))) {
        const k = lineKey(l.text);
        if (!k || keys.has(k)) continue;
        keys.add(k);
        const e = seen.get(k);
        if (e) e.count++;
        else seen.set(k, { count: 1, text: withPageTokens(l.text, i + 1, pages.length), y: l.y, x: l.x });
      }
    });
    const kept = [...seen.entries()].filter(([, e]) => e.count * 2 > pages.length);
    for (const [k] of kept) repeated.add(k);
    kept.sort((a, b) => b[1].y - a[1].y || a[1].x - b[1].x);
    const text = kept.map(([, e]) => e.text.slice(0, 200)).join("\n");
    return text || null;
  };
  let header = find(true);
  let footer = find(false);
  // Rule 9: every page's top and bottom band (not only repeated lines) and the top 25% of page 1 (letterhead).
  // The same words elsewhere in the body are ordinary legal wording ("registered in Ejari"): kept, no flag.
  const areas: ("header" | "footer" | "logo_area")[] = [];
  const flag = (area: (typeof areas)[number], l: Line) => {
    if (!areas.includes(area)) areas.push(area);
    repeated.add(lineKey(l.text));
  };
  pages.forEach((ls, i) => {
    for (const l of ls) {
      if (!hasAuthorityMarks(l.text)) continue;
      if (inBand(l, true)) flag("header", l);
      else if (inBand(l, false)) flag("footer", l);
      if (i === 0 && l.y >= h * (1 - LOGO_ZONE)) flag("logo_area", l);
    }
  });
  if (areas.includes("header") || (header && hasAuthorityMarks(header))) header = null;
  if (areas.includes("footer") || (footer && hasAuthorityMarks(footer))) footer = null;
  const authorityMarks = areas.length > 0;

  // Sizes and weights: body = most common size by characters; headings = bigger or bold-only lines.
  const flat = body.flat().filter((l) => l.size > 0);
  if (!flat.length)
    return {
      style: { ...DEFAULT_STYLE, page: { widthPt: Math.round(w), heightPt: Math.round(h) } },
      repeated,
      headings: new Set(),
    };
  const bySize = new Map<number, number>();
  for (const l of flat) bump(bySize, l.size, l.chars);
  const bodyPt = mode(bySize)!;
  const bodyLines = flat.filter((l) => l.size === bodyPt);
  const bodyBold =
    bodyLines.filter((l) => l.bold).reduce((a, l) => a + l.chars, 0) * 2 > bodyLines.reduce((a, l) => a + l.chars, 0);
  const heads = flat.filter(
    (l) =>
      l.text.length >= 2 &&
      l.text.length <= 100 &&
      (l.size > bodyPt * 1.08 || (l.bold && !bodyBold && l.size >= bodyPt)),
  );
  const headSizes = new Map<number, number>();
  for (const l of heads) bump(headSizes, l.size);
  const sorted = [...headSizes.keys()].toSorted((a, b) => b - a);
  const top = sorted[0];
  const firstPage = new Set((body[0] ?? []).map((l) => l));
  const titlePt =
    top !== undefined &&
    top > bodyPt * 1.08 &&
    (headSizes.get(top) ?? 0) <= 2 &&
    heads.some((l) => l.size === top && firstPage.has(l)) &&
    sorted.length > 1
      ? top
      : null;
  const rest = new Map([...headSizes].filter(([s]) => s !== titlePt));
  const headingPt = mode(rest) ?? titlePt ?? top ?? bodyPt;
  const hl = heads.filter((l) => l.size === headingPt);
  const headingBold = hl.length ? hl.filter((l) => l.bold).length * 2 >= hl.length : true;

  const serifChars = flat.filter((l) => l.serif).reduce((a, l) => a + l.chars, 0);
  const serif = serifChars * 2 > flat.reduce((a, l) => a + l.chars, 0);
  const observed = [...fontNames.entries()]
    .toSorted((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([k]) => k);

  const left = Math.min(...flat.map((l) => l.x));
  const right = w - Math.max(...flat.map((l) => l.right));
  // The fullest page shows where the text area really ends; short pages would overstate the margin.
  const tops = body.filter((p) => p.length).map((p) => h - Math.max(...p.map((l) => l.y + l.size)));
  const bottoms = body.filter((p) => p.length).map((p) => Math.min(...p.map((l) => l.y)));
  // A sample with authority marks gets the neutral default colour, not whatever colour its branding used.
  const accent = authorityMarks ? null : (mode(colours) ?? null);
  return {
    repeated,
    headings: new Set(heads.filter((l) => l.size !== titlePt).map((l) => l.text)),
    style: {
      fromSample: true,
      page: { widthPt: Math.round(w), heightPt: Math.round(h) },
      margins: {
        topPt: clamp(tops.length ? Math.min(...tops) : DEFAULT_STYLE.margins.topPt),
        // Wrapped text rarely reaches the right margin, so it is taken as no wider than the left one.
        rightPt: clamp(Math.min(right, left)),
        bottomPt: clamp(bottoms.length ? Math.min(...bottoms) : DEFAULT_STYLE.margins.bottomPt),
        leftPt: clamp(left),
      },
      font: serif
        ? { family: "serif", regular: "Times-Roman", bold: "Times-Bold", observed }
        : { family: "sans", regular: "Helvetica", bold: "Helvetica-Bold", observed },
      sizes: { bodyPt, headingPt, titlePt },
      headingBold,
      accentColour: accent,
      header,
      footer,
      flags: { authorityMarks, areas },
    },
  };
}
