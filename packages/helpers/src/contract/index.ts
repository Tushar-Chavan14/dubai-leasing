import type { Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { getRulebook } from "@leasing/rulebook";
import { buildContractFields } from "./fields.ts";
import { addendumReviewMessages } from "./prompt.ts";
import { AddendumReview, ContractContext, ContractData } from "./schema.ts";

export { buildContractFields } from "./fields.ts";
export { addendumReviewMessages } from "./prompt.ts";
export { AddendumReview, ContractContext, ContractData } from "./schema.ts";
export { contractDocument } from "./template.ts";

export const ContractSchemas = { context: ContractContext, data: ContractData };

/**
 * Contract helper (step 5). Pure code copies every field from its record, with a source per field.
 * The chat model only reads the staff-written free-text addendum and lists conflicts for the
 * approver; it never writes or changes a field or a word. Missing data → `needs_human`.
 */
export function contractHelper(llm: Llm): Helper<ContractContext, ContractData> {
  return {
    name: "contract",
    async run(input) {
      const c = input.context;
      const built = buildContractFields(c);
      if (!built.ok) {
        return {
          status: "needs_human",
          reasons: built.missing.map((m) => `Missing or invalid: ${m}.`),
          sourceDocIds: [],
        };
      }
      const text = c.addendum.freeText?.trim();
      if (!text) {
        return {
          status: "ok",
          data: { fields: built.fields, sources: built.sources, addendum: c.addendum, flags: [], reviewed: false },
          reasons: ["Every field copied from its record; no free-text addendum to review."],
          sourceDocIds: [],
        };
      }
      const r = await llm.chat(addendumReviewMessages(text, built.fields, getRulebook(input.rulesVersion)), {
        schema: AddendumReview,
      });
      // An answer that doesn't parse throws: the runner retries once, then asks a person.
      const review = AddendumReview.parse(r.parsed);
      return {
        status: "ok",
        data: {
          fields: built.fields,
          sources: built.sources,
          addendum: c.addendum,
          flags: review.flags,
          reviewed: true,
        },
        reasons: review.flags.length
          ? review.flags.map((f) => `Addendum ${f.kind.replace("_", " ")}: "${f.quote}" (${f.reason})`)
          : ["Every field copied from its record; the addendum review found no conflicts."],
        sourceDocIds: [],
        model: { name: r.model },
      };
    },
  };
}
