import type { Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { z } from "zod";
import { extractPdf, normalizeWs, type ReadPageImage, type RenderPage } from "./extract.ts";
import { clauseMessages } from "./prompt.ts";
import {
  ContractTemplateContext,
  ContractTemplateData,
  MAX_CHARS,
  ModelOutput,
  type TemplateClause,
} from "./schema.ts";
import { hasValues, inventedValues } from "./values.ts";

export { extractPdf, isPdf, normalizeWs, NOT_PDF, SCAN, TOO_BIG, TOO_LONG, TIMEOUT } from "./extract.ts";
export type { Extracted, ReadPageImage, RenderPage } from "./extract.ts";
export { clauseMessages, stripDelimiters } from "./prompt.ts";
export * from "./schema.ts";
export { hasValues, inventedValues } from "./values.ts";

const MIN_QUOTE_CHARS = 20;
const MIN_QUOTE_WORDS = 4;
const MIN_QUOTE_RATIO = 0.4;
/** Quotes are capped at 300 chars, so never require more than this however long the clause is. */
const MAX_QUOTE_REQUIRED = 250;
const TextRead = z.object({ text: z.string() });

export interface ContractTemplateDeps {
  /** Returns the uploaded file's bytes. The helper never touches disk. */
  readFile: (docId: string) => Promise<Uint8Array>;
  /**
   * Only when a local vision model is configured: renders an image-only page so the local vision
   * model reads it. Without it, such pages count as unreadable.
   */
  renderPage?: RenderPage;
}

/**
 * Contract-template helper (slice 3). Extracts text from a sample contract (PDF text layer; local
 * vision model for image-only pages when configured), asks the local chat model for addendum
 * clauses with exact quotes, then code keeps only clauses whose quote is in the document
 * (whitespace-normalised) and sets `hasValues` by regex. The model never decides a value; staff
 * review every clause. Returns data only; the Manager stores it.
 */
export function contractTemplateHelper(
  llm: Llm,
  deps: ContractTemplateDeps,
): Helper<ContractTemplateContext, ContractTemplateData> {
  return {
    name: "contract_template",
    async run(input) {
      const src = input.context.source;
      let text: string;
      let pages = 0;
      let unreadablePages = 0;
      if (src.kind === "text") {
        text = src.text.trim();
        if (text.length > MAX_CHARS) {
          return {
            status: "needs_human",
            reasons: ["Too long to read; upload the clauses section only."],
            sourceDocIds: [],
          };
        }
      } else {
        let bytes: Uint8Array;
        try {
          bytes = await deps.readFile(src.docId);
        } catch (e) {
          const missing = (e as { code?: string } | null)?.code === "ENOENT";
          return {
            status: "failed",
            reasons: [missing ? "The uploaded file is missing." : "The uploaded file couldn't be read."],
            sourceDocIds: [src.docId],
          };
        }
        const read: ReadPageImage | undefined = deps.renderPage
          ? async (img) => {
              const v = TextRead.parse(
                await llm.vision([img], "Transcribe all the text on this page exactly.", TextRead),
              );
              return v.text.slice(0, MAX_CHARS);
            }
          : undefined;
        const ex = await extractPdf(bytes, deps.renderPage && read ? { render: deps.renderPage, read } : undefined);
        if (!ex.ok) {
          return {
            status: ex.kind === "not_pdf" ? "failed" : "needs_human",
            reasons: [ex.message],
            sourceDocIds: [src.docId],
          };
        }
        ({ text, pages, unreadablePages } = ex);
      }
      if (!text) {
        return { status: "needs_human", reasons: ["No readable text in the document."], sourceDocIds: [] };
      }
      const r = await llm.chat(clauseMessages(text), { schema: ModelOutput });
      // An answer that doesn't parse throws: the runner retries once, then asks a person.
      const out = ModelOutput.parse(r.parsed);
      const haystack = normalizeWs(text);
      const clauses: TemplateClause[] = [];
      let droppedCount = 0;
      for (const c of out.clauses) {
        const q = normalizeWs(c.quote);
        const enough =
          q.length >= MIN_QUOTE_CHARS &&
          q.split(" ").length >= MIN_QUOTE_WORDS &&
          q.length >= Math.min(MIN_QUOTE_RATIO * normalizeWs(c.text).length, MAX_QUOTE_REQUIRED);
        // A figure, period or date in the clause text that its quote does not contain is invented: dropped.
        if (enough && haystack.includes(q) && !inventedValues(c.text, c.quote).length)
          clauses.push({ ...c, hasValues: hasValues(c.text) || hasValues(c.quote) });
        else droppedCount++;
      }
      return {
        status: "ok",
        data: { clauses, droppedCount, pages, unreadablePages },
        reasons: [
          `${clauses.length} clause${clauses.length === 1 ? "" : "s"} proposed for review` +
            (droppedCount ? `; ${droppedCount} dropped because the quote isn't in the document` : "") +
            ".",
        ],
        sourceDocIds: src.kind === "pdf" ? [src.docId] : [],
        model: { name: r.model },
      };
    },
  };
}
