import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import { type KycOptions, kycHelper } from "@platform/readers/kyc/index";
import type { KycContext, KycData } from "@platform/readers/kyc/schema";
import { allStrings, documentInstructionLike } from "../readers/injection.ts";
import { spaKycProfile } from "./profile.ts";

export { SPA_PERSON_READ_KINDS, type SpaKycDocument, spaKycContext } from "./context.ts";
export { ProofOfAddressRead, spaKycProfile } from "./profile.ts";

/** The `check` of the flag that sends a read with instruction-like text to a person (S49 amendment). */
export const INSTRUCTION_FOUND_CHECK = "read.instruction_found";

/**
 * `spa-kyc` (specs step 2): the shared KYC reader with the SPA profile. The vision model reads each document; code
 * decides, under the role's published config. Returns data only: the Manager stores the run.
 *
 * Text on a document that reads like an order to a model (C20's `documentInstructionLike`) can never be part of a
 * pass: the run becomes `review` with one non-blocking `manual_review` flag naming the document. The read values
 * themselves are not changed, and a blocking flag stays blocking.
 */
export function spaKycHelper(
  llm: Llm,
  readImage: (docId: string) => Promise<Uint8Array>,
  opts: KycOptions = {},
): Helper<KycContext, KycData> {
  return {
    name: spaKycProfile.helperName,
    async run(input) {
      const found = new Set<string>();
      let current = "";
      // The wrapper only watches what the model returns (all strings, before Zod strips anything).
      const watched: Llm = Object.create(llm, {
        vision: {
          value: async (...args: Parameters<Llm["vision"]>) => {
            const out = await llm.vision(...args);
            if (allStrings(out).some(documentInstructionLike)) found.add(current);
            return out;
          },
        },
      });
      const result = await kycHelper(
        watched,
        async (docId) => {
          current = docId;
          return readImage(docId);
        },
        spaKycProfile,
        opts,
      ).run(input);
      if (result.status !== "ok" || !result.data || !found.size) return result;
      const flags = [...found].map((docId) => ({
        kind: "manual_review" as const,
        message: "Text on a document reads like an instruction. It was ignored; a person must review the documents.",
        docId,
        blocking: false,
        check: INSTRUCTION_FOUND_CHECK,
      }));
      const data: KycData = {
        ...result.data,
        verdict: "review",
        flags: [...result.data.flags, ...flags],
        checks: [
          ...result.data.checks,
          ...flags.map((f) => ({ check: "instruction_found", status: "flag" as const, docId: f.docId })),
        ],
      };
      return { ...result, data, reasons: data.flags.map((f) => f.message) };
    },
  };
}
