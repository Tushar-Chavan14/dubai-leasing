/**
 * Leasing's KYC helper (S49, C17): the reader lives in `@platform/readers/kyc`; leasing passes `leasingKycProfile`
 * unless a caller gives another, so its prompts, results and activity log stay as they were.
 */
import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import { type KycOptions as PlatformKycOptions, kycHelper as platformKycHelper } from "@platform/readers/kyc/index";
import { kycAiChecks as platformKycAiChecks } from "@platform/readers/kyc/rules";
import { readPrompt as platformReadPrompt } from "@platform/readers/kyc/prompt";
import type { CustomCategory } from "@platform/kernel/kyc-form";
import { type KycProfile, leasingKycProfile } from "./profile.ts";
import type { KycContext, KycData, ReadKey } from "@platform/readers/kyc/schema";

export { assessKyc, KYC_DEFAULT_TIMEOUT_MS, type KycStep, KycSchemas, parseDocDate } from "@platform/readers/kyc/index";
export { applyKycRules } from "@platform/readers/kyc/rules";
export * from "@platform/readers/kyc/schema";
export { type KycProfile, leasingKycProfile } from "./profile.ts";

export interface KycOptions extends PlatformKycOptions {
  /** Names, document wording and prompt nouns (S4). Default: leasing's. */
  profile?: KycProfile;
}

export const readPrompt = (
  key: ReadKey | (string & {}),
  custom?: CustomCategory,
  profile: KycProfile = leasingKycProfile,
): string => platformReadPrompt(key, custom, profile);

export const kycAiChecks = (
  llm: Llm,
  rules: Parameters<typeof platformKycAiChecks>[1],
  identity: Parameters<typeof platformKycAiChecks>[2],
  answers: Record<string, string>,
  subject: string = leasingKycProfile.aiCheckSubject,
) => platformKycAiChecks(llm, rules, identity, answers, subject);

export function kycHelper(
  llm: Llm,
  readImage: (docId: string) => Promise<Uint8Array>,
  opts: KycOptions = {},
): Helper<KycContext, KycData> {
  const { profile, ...rest } = opts;
  return platformKycHelper(llm, readImage, profile ?? leasingKycProfile, rest);
}
