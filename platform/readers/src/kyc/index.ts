import type { Helper } from "@platform/kernel/helper";
import { type Llm, ModelTimeoutError } from "@platform/llm";
import { assessKyc } from "./checks.ts";
import { type KycProfile, leasingKycProfile } from "./profile.ts";
import { readPrompt } from "./prompt.ts";
import { applyKycRules, kycAiChecks } from "./rules.ts";
import { customOf, type DocRead, KycContext, KycData, readKeyOf, VisionRead } from "./schema.ts";

export { assessKyc, parseDocDate } from "./checks.ts";
export { applyKycRules, kycAiChecks } from "./rules.ts";
export { readPrompt } from "./prompt.ts";
export { type KycProfile, leasingKycProfile } from "./profile.ts";
export * from "./schema.ts";

/** One thing the check did, for the record's activity log. No document content, no ID numbers. */
export type KycStep =
  | { kind: "start"; documents: number; model: string | undefined; timeoutMs: number }
  | {
      kind: "doc";
      index: number;
      total: number;
      doc: string;
      ok: boolean;
      ms: number;
      /** Why a document was not read. */
      why?: "timeout" | "model_error" | "unreadable" | "file_missing";
      error?: string;
    }
  | { kind: "assess" }
  | { kind: "result"; status: "ok" | "needs_human"; verdict?: string; flags?: number; reason?: string };

export interface KycOptions {
  /** Cancel one reading after this long (default 120 s). Each document gets one retry. */
  timeoutMs?: number;
  onStep?: (step: KycStep) => void | Promise<void>;
  /** Names, document wording and prompt nouns (S4). Default: leasing's. */
  profile?: KycProfile;
}

export const KYC_DEFAULT_TIMEOUT_MS = 120_000;

const docLabel = (profile: KycProfile, d: { kind: string; side: string }) =>
  `${profile.documentLabels[d.kind] ?? d.kind}${d.side === "page" ? "" : ` (${d.side})`}`;

/**
 * KYC helper (architecture §5): the vision model reads each uploaded document (one call per
 * image, each with its own time limit; a failed or unparsable answer is retried once);
 * `assessKyc` decides in pure code. Images come through `readImage`, so the helper never touches
 * disk, and it never writes anything: the Manager stores the result and acts on it.
 *
 * A model that times out or can't be reached twice on one document stops the check at once with
 * `needs_human` (rule 6): nothing is decided on a missing reading and the rest isn't queued
 * behind a stuck model.
 */
export function kycHelper(
  llm: Llm,
  readImage: (docId: string) => Promise<Uint8Array>,
  opts: KycOptions = {},
): Helper<KycContext, KycData> {
  const timeoutMs = opts.timeoutMs ?? KYC_DEFAULT_TIMEOUT_MS;
  const profile = opts.profile ?? leasingKycProfile;
  const step = async (s: KycStep) => {
    try {
      await opts.onStep?.(s);
    } catch {
      // A log that can't be written never stops the check.
    }
  };
  return {
    name: profile.helperName,
    async run(input) {
      const ctx = input.context;
      const reads: DocRead[] = [];
      await step({ kind: "start", documents: ctx.documents.length, model: llm.visionModelName, timeoutMs });
      let index = 0;
      for (const d of ctx.documents) {
        index++;
        const key = readKeyOf(d.kind, d.side);
        const schema = VisionRead[key];
        const custom = d.kind === "custom" ? customOf(ctx.form, d.fieldKey) : undefined;
        const label = custom?.name ?? docLabel(profile, d);
        const began = performance.now();
        const at = { index, total: ctx.documents.length, doc: label };
        let read: Record<string, unknown> | null = null;
        let error: string | undefined;
        let why: "timeout" | "model_error" | "unreadable" | undefined;
        let image: Uint8Array;
        try {
          image = await readImage(d.docId);
        } catch {
          reads.push({ ...d, read: null, error: "file missing" });
          await step({ kind: "doc", ...at, ok: false, ms: 0, why: "file_missing" });
          continue;
        }
        for (let attempt = 0; attempt < 2 && !read; attempt++) {
          try {
            const parsed = schema.safeParse(
              await llm.vision([image], readPrompt(key, custom, profile), schema, { timeoutMs }),
            );
            if (parsed.success) read = parsed.data as Record<string, unknown>;
            else {
              error = "the reading didn't have the expected fields";
              why = "unreadable";
            }
          } catch (e) {
            error = e instanceof Error ? e.message : String(e);
            why =
              e instanceof ModelTimeoutError
                ? "timeout"
                : /did not return JSON/.test(error)
                  ? "unreadable"
                  : "model_error";
          }
        }
        const ms = Math.round(performance.now() - began);
        if (read) {
          await step({ kind: "doc", ...at, ok: true, ms });
        } else {
          await step({ kind: "doc", ...at, ok: false, ms, why: why ?? "unreadable", ...(error ? { error } : {}) });
          if (why === "timeout" || why === "model_error") {
            const reason = `Reading the ${label} ${why === "timeout" ? "timed out" : "failed"} twice (${error}).`;
            await step({ kind: "result", status: "needs_human", reason });
            return {
              status: "needs_human",
              reasons: [reason, "A person needs to retry the document check or review the documents."],
              sourceDocIds: ctx.documents.map((x) => x.docId),
            };
          }
        }
        reads.push({ ...d, read, ...(read || !error ? {} : { error }) });
      }
      await step({ kind: "assess" });
      let data = applyKycRules(ctx, reads, assessKyc(ctx, reads), profile.partyNoun);
      const ai = ctx.rules ? await kycAiChecks(llm, ctx.rules.company, data.identity, ctx.answers ?? {}) : [];
      if (ai.length) {
        data = {
          ...data,
          verdict: "review",
          flags: [...data.flags, ...ai],
          checks: [...data.checks, ...ai.map(() => ({ check: "company_rule", status: "flag" as const, docId: null }))],
        };
      }
      await step({ kind: "result", status: "ok", verdict: data.verdict, flags: data.flags.length });
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
