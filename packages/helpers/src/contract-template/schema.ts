import { z } from "zod";

export const CLAUSE_CATEGORIES = [
  "maintenance",
  "pets",
  "subletting",
  "termination",
  "parking",
  "payment",
  "utilities",
  "other",
] as const;

export const MAX_PAGES = 60;
export const MAX_CHARS = 120_000;

/** Where the sample contract comes from: pasted/typed text, or an uploaded PDF read through `readFile`. */
export const ContractTemplateContext = z.object({
  source: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("text"), text: z.string().min(1) }),
    z.object({ kind: z.literal("pdf"), docId: z.string().min(1) }),
  ]),
});
export type ContractTemplateContext = z.infer<typeof ContractTemplateContext>;

/** What the model may return. Everything is untrusted until the code below has filtered it. */
export const ModelClause = z.object({
  title: z.string().min(1).max(80),
  text: z.string().min(1).max(1200),
  category: z.enum(CLAUSE_CATEGORIES),
  /** Exact source span the clause is based on. */
  quote: z.string().min(1).max(300),
});
export const ModelOutput = z.object({ clauses: z.array(ModelClause).max(30) });
export type ModelOutput = z.infer<typeof ModelOutput>;

export const TemplateClause = ModelClause.extend({
  /** Set by code (regex), never by the model: the clause mentions money, a number, a period or a date. */
  hasValues: z.boolean(),
});
export type TemplateClause = z.infer<typeof TemplateClause>;

export const ContractTemplateData = z.object({
  clauses: z.array(TemplateClause).max(30),
  /** Clauses the model proposed whose quote isn't in the document (hallucination guard). */
  droppedCount: z.number().int().min(0),
  pages: z.number().int().min(0),
  /** Pages with no readable text (no text layer and no vision read). */
  unreadablePages: z.number().int().min(0),
});
export type ContractTemplateData = z.infer<typeof ContractTemplateData>;

export const ContractTemplateSchemas = { context: ContractTemplateContext, data: ContractTemplateData };
