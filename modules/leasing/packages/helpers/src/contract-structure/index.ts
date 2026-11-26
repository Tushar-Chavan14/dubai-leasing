/**
 * Leasing's contract-structure reader (S43): the generic reader lives in `@platform/readers`; leasing passes
 * `leasingTemplateProfile` (two parties, its data sheet, label words, filled-sample detection and cheque-date runs).
 */
import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import {
  detectBlanks as detectBlanksWith,
  type Mapping,
  type RawBlank,
  validateMapping as validateMappingWith,
} from "@platform/readers/structure/blanks";
import {
  type ContractStructureDeps as PlatformDeps,
  contractStructureHelper as platformHelper,
} from "@platform/readers/structure/helper";
import { structureMessages as structureMessagesWith } from "@platform/readers/structure/prompt";
import type { ContractStructureContext, ContractStructureData } from "@platform/readers/structure/schema";
import { LEASING_LABEL_WORDS, leasingTemplateProfile, type TemplateProfile } from "./profile.ts";

export {
  catalogueForPrompt,
  FIELD_CATALOGUE,
  FIELD_NAMES,
  type FieldInfo,
  type FieldType,
  fieldType,
  isFieldName,
} from "./fields.ts";
export {
  ADDITIONAL_TERMS_KEY,
  isSheetKey,
  SHEET_KEY_NAMES,
  SHEET_KEYS,
  type SheetRecords,
  sheetExtras,
  sheetForPrompt,
  sheetKeyInfo,
} from "./datasheet.ts";
export { detectFilledValues, fixedValueKinds, isSampleOnlyText } from "./filled.ts";
export {
  askModel,
  contextParty,
  mappingMessages,
  matchAfter,
  matchBlank,
  matchLabel,
  matchPlaceholder,
  partyIn,
  type Party,
  type Proposal,
  numberChequeDateRuns,
  proposeMappings,
  redactValues,
  resuggestBlanks,
} from "./mapping.ts";
export {
  compatible,
  guessLabel,
  inferBlankType,
  placeholderLabel,
  placeholderName,
  type RawBlank,
} from "@platform/readers/structure/blanks";
export {
  DEFAULT_STYLE,
  extractLook,
  hasAuthorityMarks,
  type Look,
  LOOK_MAX_PAGES,
} from "@platform/readers/structure/look";
export { encodePng } from "@platform/readers/structure/png";
export {
  LEASING_LABEL_WORDS,
  leasingTemplateProfile,
  type TemplateParty,
  type TemplateProfile,
  type TemplateSheet,
} from "./profile.ts";
export * from "./render.ts";
export { remapForData, type Remapped } from "./remap.ts";
export * from "@platform/readers/structure/schema";
export {
  buildSections,
  detectNumbering,
  splitNumber,
  toParagraphs,
  withBlankHeadings,
} from "@platform/readers/structure/structure";

/** Leasing default: the leasing label words. */
export const detectBlanks = (text: string, max = 400, labelWords: ReadonlySet<string> = LEASING_LABEL_WORDS) =>
  detectBlanksWith(text, max, labelWords);

/** Leasing default: the leasing prompt wording. */
export const structureMessages = (
  lines: string[],
  blanks: RawBlank[],
  nonce?: string,
  profile: TemplateProfile = leasingTemplateProfile,
) => structureMessagesWith(lines, blanks, nonce, profile);

/** Leasing default: the leasing data sheet. */
export const validateMapping = (
  proposed: string | undefined,
  label: string,
  b: RawBlank,
  sheet = leasingTemplateProfile.sheet,
): Mapping => validateMappingWith(proposed, label, b, sheet);

export interface ContractStructureDeps extends Omit<PlatformDeps, "profile"> {
  /** Party roles, data sheet, aliases and prompt wording (S4). Default: leasing's. */
  profile?: TemplateProfile;
}

/** The platform reader with leasing's profile unless another is given. */
export function contractStructureHelper(
  llm: Llm,
  deps: ContractStructureDeps,
): Helper<ContractStructureContext, ContractStructureData> {
  return platformHelper(llm, { ...deps, profile: deps.profile ?? leasingTemplateProfile });
}
