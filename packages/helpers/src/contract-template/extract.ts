import { getDocumentProxy } from "unpdf";
import { MAX_CHARS, MAX_PAGES } from "./schema.ts";

export const MAX_BYTES = 10 * 1024 * 1024;
export const PARSE_TIMEOUT_MS = 30_000;
const MAX_PAGE_CHARS = MAX_CHARS;

export type Extracted =
  | { ok: true; text: string; pages: number; unreadablePages: number }
  | { ok: false; kind: "not_pdf" | "too_long" | "scan" | "timeout"; message: string };

export const NOT_PDF = "Upload a PDF file.";
export const TOO_LONG = "Too long to read; upload the clauses section only.";
export const TOO_BIG = "This file is too large (over 10 MB); upload the clauses section only.";
export const TIMEOUT = "The PDF took too long to read; upload a text PDF or the clauses as text.";
export const SCAN = "This PDF is a scan; upload a text PDF or the clauses as text.";

const MIN_PAGE_CHARS = 20;

export const isPdf = (bytes: Uint8Array): boolean =>
  bytes.length >= 5 && String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";

/** NFKC (maps NBSP and fullwidth forms), drops soft hyphens and zero-width marks, straightens curly quotes, collapses whitespace. */
export const normalizeWs = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/[\u00AD\u200B-\u200D\u2060\uFEFF]/g, "")
    .replace(/[\u2018\u2019\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201F\u2033]/g, '"')
    .replace(/\s+/g, " ")
    .trim();

/** Renders one page (1-based) to an image for the local vision model; supplied by the caller if available. */
export type RenderPage = (pdf: Uint8Array, page: number) => Promise<Uint8Array>;
/** Reads a page image with the local vision model and returns its text. */
export type ReadPageImage = (image: Uint8Array) => Promise<string>;

export async function extractPdf(
  bytes: Uint8Array,
  vision?: { render: RenderPage; read: ReadPageImage },
): Promise<Extracted> {
  if (!isPdf(bytes)) return { ok: false, kind: "not_pdf", message: NOT_PDF };
  if (bytes.length > MAX_BYTES) return { ok: false, kind: "too_long", message: TOO_BIG };
  return raceTimeout(
    (state) => parse(bytes, state, vision),
    () => ({ ok: false, kind: "timeout", message: TIMEOUT }),
  );
}

export interface ParseState {
  aborted: boolean;
  /** Set by the parser once the document is open: the timeout path calls it at once. */
  destroy?: () => void;
}

/**
 * Runs a PDF parse against `PARSE_TIMEOUT_MS`. On timeout the parser is told to stop and its
 * document is destroyed immediately (not only when the parse eventually ends).
 */
export async function raceTimeout<T>(
  run: (state: ParseState) => Promise<T>,
  onTimeout: () => T,
  ms: number = PARSE_TIMEOUT_MS,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state: ParseState = { aborted: false };
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => {
      state.aborted = true;
      try {
        state.destroy?.();
      } catch {
        // already closed
      }
      resolve(onTimeout());
    }, ms);
  });
  try {
    return await Promise.race([run(state), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function pageText(page: { getTextContent(): Promise<{ items: unknown[] }> }): Promise<string> {
  const content = await page.getTextContent();
  let out = "";
  for (const it of content.items as { str?: string; hasEOL?: boolean }[]) {
    if (typeof it.str !== "string") continue;
    out += it.str + (it.hasEOL ? "\n" : "");
  }
  return out;
}

async function parse(
  bytes: Uint8Array,
  state: ParseState,
  vision?: { render: RenderPage; read: ReadPageImage },
): Promise<Extracted> {
  // pdf.js detaches the buffer it is given, so hand it a copy: `vision.render` needs the original.
  const doc = await getDocumentProxy(new Uint8Array(bytes));
  state.destroy = () => void doc.loadingTask.destroy().catch(() => {});
  try {
    if (doc.numPages > MAX_PAGES) return { ok: false, kind: "too_long", message: TOO_LONG };
    const pages: string[] = [];
    let unreadable = 0;
    let total = 0;
    for (let i = 1; i <= doc.numPages; i++) {
      if (state.aborted) return { ok: false, kind: "timeout", message: TIMEOUT };
      let t = (await pageText(await doc.getPage(i))).trim();
      if (t.length < MIN_PAGE_CHARS && vision && !state.aborted) {
        try {
          t = (await vision.read(await vision.render(bytes, i))).trim().slice(0, MAX_PAGE_CHARS);
        } catch {
          t = "";
        }
      }
      if (t.length < MIN_PAGE_CHARS) unreadable++;
      total += t.length;
      if (total > MAX_CHARS) return { ok: false, kind: "too_long", message: TOO_LONG };
      pages.push(t);
    }
    if (unreadable * 2 > doc.numPages) return { ok: false, kind: "scan", message: SCAN };
    return { ok: true, text: pages.filter(Boolean).join("\n\n"), pages: doc.numPages, unreadablePages: unreadable };
  } finally {
    state.aborted = true;
    await doc.loadingTask.destroy().catch(() => {});
  }
}
