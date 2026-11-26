import type { Helper } from "@platform/kernel/helper";
import { type Llm, ModelTimeoutError } from "@platform/llm";
import { allStrings, documentInstructionLike } from "./injection.ts";
import { READER_PROMPT_VERSION, readerPrompt } from "./prompt.ts";
import { type ReadFields, type ReadProfile, readSchemaFor } from "./schema.ts";

export interface ReaderContext {
  docId: string;
  profile: ReadProfile;
}
export interface ReaderData {
  profile: ReadProfile;
  fields: ReadFields;
  /** Text on the document read like an order to a model. Flagged only: nothing else changes (S52). */
  instructionFound: boolean;
  promptVersion: string;
}

export const READER_DEFAULT_TIMEOUT_MS = 120_000;

/**
 * `document-reader` (specs 6.3): the local vision model copies one document's fields, Zod validates the answer (one
 * retry, then `needs_human`: nothing advances on an unparsed answer, rule 6). It returns data only; the Manager stores
 * the read and code interprets it. A missing file or a model that fails twice is `needs_human`, never a pass.
 */
export function documentReader(
  llm: Llm,
  readImage: (docId: string) => Promise<Uint8Array>,
  opts: { timeoutMs?: number } = {},
): Helper<ReaderContext, ReaderData> {
  const timeoutMs = opts.timeoutMs ?? READER_DEFAULT_TIMEOUT_MS;
  return {
    name: "spa_document_reader",
    async run(input) {
      const { docId, profile } = input.context;
      const schema = readSchemaFor(profile);
      let image: Uint8Array;
      try {
        image = await readImage(docId);
      } catch {
        return { status: "needs_human", reasons: ["The file could not be opened."], sourceDocIds: [docId] };
      }
      let error = "the reading didn't have the expected fields";
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const parsed = schema.safeParse(await llm.vision([image], readerPrompt(profile), schema, { timeoutMs }));
          if (parsed.success) {
            const fields = parsed.data as ReadFields;
            return {
              status: "ok",
              data: {
                profile,
                fields,
                instructionFound: allStrings(fields).some(documentInstructionLike),
                promptVersion: READER_PROMPT_VERSION,
              },
              reasons: [],
              sourceDocIds: [docId],
              ...(llm.visionModelName ? { model: { name: llm.visionModelName } } : {}),
            };
          }
          error = "the reading didn't have the expected fields";
        } catch (e) {
          error = e instanceof ModelTimeoutError ? "the model timed out" : e instanceof Error ? e.message : String(e);
        }
      }
      return {
        status: "needs_human",
        reasons: [`The document could not be read (${error}). A person needs to enter it.`],
        sourceDocIds: [docId],
      };
    },
  };
}
