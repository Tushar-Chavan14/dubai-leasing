import type { Helper } from "@leasing/core";
import type { Llm } from "@leasing/llm";
import { assessKyc } from "./checks.ts";
import { readPrompt } from "./prompt.ts";
import { type DocRead, KycContext, KycData, readKeyOf, VisionRead } from "./schema.ts";

export { assessKyc, parseDocDate } from "./checks.ts";
export { readPrompt } from "./prompt.ts";
export * from "./schema.ts";

/**
 * KYC helper (architecture §5): the vision model reads each uploaded document (one call per
 * image, retried once if its answer doesn't parse); `assessKyc` decides in pure code. Images come
 * through `readImage`, so the helper never touches disk, and it never writes anything: the
 * Manager stores the result and acts on it.
 */
export function kycHelper(llm: Llm, readImage: (docId: string) => Promise<Uint8Array>): Helper<KycContext, KycData> {
  return {
    name: "kyc",
    async run(input) {
      const ctx = input.context;
      const reads: DocRead[] = [];
      for (const d of ctx.documents) {
        const key = readKeyOf(d.kind, d.side);
        const schema = VisionRead[key];
        let read: Record<string, unknown> | null = null;
        let error: string | undefined;
        let image: Uint8Array;
        try {
          image = await readImage(d.docId);
        } catch {
          reads.push({ ...d, read: null, error: "file missing" });
          continue;
        }
        for (let attempt = 0; attempt < 2 && !read; attempt++) {
          try {
            const parsed = schema.safeParse(await llm.vision([image], readPrompt(key), schema));
            if (parsed.success) read = parsed.data as Record<string, unknown>;
            else error = "the reading didn't have the expected fields";
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
          }
        }
        reads.push({ ...d, read, ...(read || !error ? {} : { error }) });
      }
      const data = assessKyc(ctx, reads);
      return {
        status: "ok",
        data,
        reasons:
          data.verdict === "verified"
            ? ["Every required document was read clearly, all checks passed and the names match."]
            : data.flags.map((f) => f.message),
        sourceDocIds: ctx.documents.map((d) => d.docId),
      };
    },
  };
}

export const KycSchemas = { context: KycContext, data: KycData };
