import type { Helper } from "@platform/kernel/helper";
import type { Llm } from "@platform/llm";
import { contractStructureHelper } from "@platform/readers/structure/helper";
import type { ContractStructureContext, ContractStructureData } from "@platform/readers/structure/schema";
import { spaTemplateProfile } from "./profile.ts";

export {
  MAX_INSTALMENT,
  MAX_PARTY_SLOT,
  matchAfter,
  matchLabel,
  partyBlocks,
  partyNamedIn,
  signatureSlots,
  slotMarks,
  splitSlotKey,
  signatureRoles,
  type SpaTemplateRole,
  spaTemplateProfile,
} from "./profile.ts";

/** `spa-template` (specs §6.3): the shared agreement reader with the SPA profile. Returns data only. */
export function spaTemplateHelper(
  llm: Llm,
  deps: { readFile: (docId: string) => Promise<Uint8Array> },
): Helper<ContractStructureContext, ContractStructureData> {
  return contractStructureHelper(llm, { readFile: deps.readFile, profile: spaTemplateProfile });
}
