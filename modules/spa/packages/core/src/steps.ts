import type { DealState, DealType } from "./state/index.ts";

/**
 * The steps of a deal, in the words staff see (design §4.3, §6.2, S58). One list per deal type; the record's stepper
 * and `dealSteps` both read it. No step uses a compliance word: a hold sits inside "Checking parties".
 */
export type StepKey =
  | "offer"
  | "parties"
  | "agreement"
  | "legal"
  | "signing"
  | "noc"
  | "finance"
  | "settlement"
  | "registration"
  | "transfer"
  | "instalments";

export interface StepFlags {
  sellerMortgage: boolean;
  buyerMortgage: boolean;
  planTakenOver: boolean;
}
export interface StepDef {
  key: StepKey;
  label: string;
  /** The deal states that belong to this step. The three end states (handed over, completed, cancelled) belong to none. */
  states: readonly DealState[];
}

const STEPS: Readonly<Record<StepKey, StepDef>> = {
  offer: { key: "offer", label: "Offer accepted", states: ["OFFER_AGREED"] },
  parties: { key: "parties", label: "Checking parties", states: ["PARTY_CHECK", "AML_HOLD"] },
  agreement: { key: "agreement", label: "Preparing the agreement", states: ["AGREEMENT_DRAFT"] },
  legal: { key: "legal", label: "Legal approval", states: ["LEGAL_REVIEW"] },
  signing: { key: "signing", label: "Signing", states: ["SIGNING"] },
  noc: { key: "noc", label: "Developer NOC", states: ["NOC"] },
  finance: { key: "finance", label: "Banks", states: ["FINANCE"] },
  settlement: { key: "settlement", label: "Settlement statement", states: ["SETTLEMENT"] },
  registration: { key: "registration", label: "Oqood registration", states: ["REGISTRATION"] },
  transfer: { key: "transfer", label: "Transfer", states: ["TRANSFER"] },
  instalments: { key: "instalments", label: "Instalments", states: ["INSTALMENTS"] },
};

/**
 * The steps of one deal type in order (specs §5): a primary deal has no NOC, banks or settlement; a resale has banks
 * only with a mortgage and instalments only when an off-plan resale took over a plan (the machine's own rule).
 */
export function stepsFor(dealType: DealType, flags: StepFlags): StepDef[] {
  const keys: StepKey[] = ["offer", "parties", "agreement", "legal", "signing"];
  if (dealType === "primary_offplan") keys.push("registration", "instalments");
  else {
    keys.push("noc");
    if (flags.sellerMortgage || flags.buyerMortgage) keys.push("finance");
    keys.push("settlement", "transfer");
    if (dealType === "resale_offplan" && flags.planTakenOver) keys.push("instalments");
  }
  return keys.map((k) => STEPS[k]);
}
