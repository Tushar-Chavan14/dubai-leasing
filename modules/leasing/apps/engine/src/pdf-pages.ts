import { createHash } from "node:crypto";
import { getDocumentProxy, renderPageAsImage } from "unpdf";

/** Most pages the signing-page viewer will render for one contract. */
export const MAX_PDF_PAGES = 60;
/** Rendered width in pixels: readable on a phone and a laptop, too coarse to be a useful copy. */
const PAGE_WIDTH_PX = 1200;
/** Neither side of a rendered page may exceed this (guards huge page sizes). */
const MAX_SIDE_PX = 2400;
/** Renders running at once, across all requests. */
const MAX_CONCURRENT_RENDERS = 2;
/** Total bytes of rendered pages kept for re-views. */
const CACHE_MAX_BYTES = 40 * 1024 * 1024;

/** Tiny counting semaphore. */
let running = 0;
const waiting: Array<() => void> = [];
async function withRenderSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT_RENDERS) await new Promise<void>((resolve) => waiting.push(resolve));
  else running++;
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next(); // the slot passes straight to the next waiter
    else running--;
  }
}

/** In-memory LRU of rendered pages (Map keeps insertion order). */
const cache = new Map<string, Uint8Array>();
let cacheBytes = 0;
function cacheGet(key: string): Uint8Array | undefined {
  const v = cache.get(key);
  if (v) {
    cache.delete(key);
    cache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, v: Uint8Array) {
  if (v.byteLength > CACHE_MAX_BYTES) return;
  const old = cache.get(key);
  if (old) cacheBytes -= old.byteLength;
  cache.set(key, v);
  cacheBytes += v.byteLength;
  for (const [k, val] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES) break;
    cache.delete(k);
    cacheBytes -= val.byteLength;
  }
}

/** Number of pages the viewer will show (capped). */
export async function pdfPageCount(bytes: Uint8Array): Promise<number> {
  const pdf = await getDocumentProxy(new Uint8Array(bytes));
  try {
    return Math.min(pdf.numPages, MAX_PDF_PAGES);
  } finally {
    await pdf.cleanup?.();
  }
}

/** One page (1-based) as a PNG, or null when it is outside the shown range. Nothing is written to disk. */
export async function renderPdfPage(bytes: Uint8Array, n: number): Promise<Uint8Array | null> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PDF_PAGES) return null;
  const key = `${createHash("sha256").update(bytes).digest("hex")}:${n}`;
  const hit = cacheGet(key);
  if (hit) return hit;
  return withRenderSlot(async () => {
    const again = cacheGet(key);
    if (again) return again;
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (n > Math.min(pdf.numPages, MAX_PDF_PAGES)) return null;
      const page = await pdf.getPage(n);
      const v = page.getViewport({ scale: 1 });
      const scale = Math.min(PAGE_WIDTH_PX / v.width, MAX_SIDE_PX / v.width, MAX_SIDE_PX / v.height);
      const png = new Uint8Array(
        await renderPageAsImage(pdf, n, { canvasImport: () => import("@napi-rs/canvas"), scale }),
      );
      cacheSet(key, png);
      return png;
    } finally {
      await pdf.cleanup?.();
    }
  });
}

export interface PageTextItem {
  str: string;
  x: number;
  y: number;
  w: number;
  h: number;
}
export interface PageText {
  width: number;
  height: number;
  items: PageTextItem[];
}

/** Text layer cache (small JSON; same key scheme as page images). */
const textCache = new Map<string, PageText>();
const TEXT_CACHE_MAX = 200;

/**
 * The page's positioned strings in the rendered image's pixel space (same scale as `renderPdfPage`), so the signing
 * page can select text over the image. Null when the page is outside the shown range.
 */
export async function pdfPageText(bytes: Uint8Array, n: number): Promise<PageText | null> {
  if (!Number.isInteger(n) || n < 1 || n > MAX_PDF_PAGES) return null;
  const key = `${createHash("sha256").update(bytes).digest("hex")}:${n}`;
  const hit = textCache.get(key);
  if (hit) return hit;
  return withRenderSlot(async () => {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    try {
      if (n > Math.min(pdf.numPages, MAX_PDF_PAGES)) return null;
      const page = await pdf.getPage(n);
      const v1 = page.getViewport({ scale: 1 });
      const scale = Math.min(PAGE_WIDTH_PX / v1.width, MAX_SIDE_PX / v1.width, MAX_SIDE_PX / v1.height);
      const v = page.getViewport({ scale });
      const content = await page.getTextContent();
      const items: PageTextItem[] = [];
      for (const it of content.items) {
        if (!("str" in it) || !it.str.trim()) continue;
        const [px, py] = v.convertToViewportPoint(it.transform[4]!, it.transform[5]!) as [number, number];
        const h = Math.abs(it.height) * scale;
        items.push({
          str: it.str,
          x: Math.round(px * 10) / 10,
          y: Math.round((py - h) * 10) / 10,
          w: Math.round(it.width * scale * 10) / 10,
          h: Math.round(h * 10) / 10,
        });
      }
      const out = { width: Math.round(v.width), height: Math.round(v.height), items };
      if (textCache.size >= TEXT_CACHE_MAX) textCache.delete(textCache.keys().next().value!);
      textCache.set(key, out);
      return out;
    } finally {
      await pdf.cleanup?.();
    }
  });
}
