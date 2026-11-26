import { allow, defineMachine, deny, type GuardResult, type Transition } from "@platform/kernel/machine";
import { z } from "zod";
import type { SpaGateId } from "../gates.ts";

/** One sale of one unit (architecture §4, S13). Steps that don't apply to a type are refused by guards. */
export const DealType = z.enum(["primary_offplan", "resale_ready", "resale_offplan"]);
export type DealType = z.infer<typeof DealType>;

export const DEAL_STATES = [
  "OFFER_AGREED",
  "PARTY_CHECK",
  "AML_HOLD",
  "AGREEMENT_DRAFT",
  "LEGAL_REVIEW",
  "SIGNING",
  "REGISTRATION",
  "NOC",
  "FINANCE",
  "SETTLEMENT",
  "TRANSFER",
  "INSTALMENTS",
  "HANDED_OVER",
  "COMPLETED",
  "CANCELLED",
] as const;
export type DealState = (typeof DEAL_STATES)[number];

/** The events callers send (spec names). Three of them branch by type: see `routeDealEvent`. */
export type DealEvent =
  | "CHECKS_STARTED"
  | "CHECKS_PASSED"
  | "AML_FLAGGED"
  | "AML_CLEARED"
  | "AML_STOPPED"
  | "PREPARED"
  | "APPROVED"
  | "RETURNED"
  | "ALL_SIGNED"
  | "NOC_OK"
  | "FINANCE_OK"
  | "SETTLED"
  | "TRANSFERRED"
  | "REGISTERED"
  | "HANDOVER"
  | "CANCEL";

/** The machine's events: the public ones, with the three branching ones split by destination (S35). */
export type DealMachineEvent =
  | Exclude<DealEvent, "ALL_SIGNED" | "NOC_OK" | "TRANSFERRED">
  | "ALL_SIGNED_PRIMARY"
  | "ALL_SIGNED_RESALE"
  | "NOC_OK_FINANCE"
  | "NOC_OK_SETTLEMENT"
  | "TRANSFERRED_COMPLETE"
  | "TRANSFERRED_PLAN";

/**
 * What the manager knows about a deal when it checks a step. Facts for steps not built yet are false, so nothing
 * can be skipped (fail closed, S35).
 */
export interface DealFacts {
  type: DealType;
  sellerMortgage: boolean;
  buyerMortgage: boolean;
  planTakenOver: boolean;
  documentsRequested: boolean;
  /** No price or booking amount outside policy waits for, or was refused by, a sales manager (M6, S81). */
  priceCleared: boolean;
  kycOk: boolean;
  companyChecksOk: boolean;
  /** A buyer or seller is a company: only then do company checks gate `PARTY_CHECK` (C20, S52). */
  hasCompanyParty: boolean;
  /** Resale: the latest ownership check matched, or an approved `seller_verification` covers its document (review 9). */
  ownershipOk: boolean;
  openAmlFlag: boolean;
  amlFlaggedByRule: boolean;
  agreementPrepared: boolean;
  allSigned: boolean;
  depositRecorded: boolean;
  nocOk: boolean;
  bankLettersConfirmed: boolean;
  statementBalanced: boolean;
  transferIssued: boolean;
  oqoodIssued: boolean;
  instalmentsPaid: boolean;
  handoverRecorded: boolean;
}

/**
 * Every fact the machine reads, so a loader can be checked for completeness (S49): a fact added to `DealFacts` and
 * missing here fails to compile, and the fail-closed loader's keys must equal this list.
 */
export const DEAL_FACT_KEYS = [
  "type",
  "sellerMortgage",
  "buyerMortgage",
  "planTakenOver",
  "documentsRequested",
  "priceCleared",
  "kycOk",
  "companyChecksOk",
  "hasCompanyParty",
  "ownershipOk",
  "openAmlFlag",
  "amlFlaggedByRule",
  "agreementPrepared",
  "allSigned",
  "depositRecorded",
  "nocOk",
  "bankLettersConfirmed",
  "statementBalanced",
  "transferIssued",
  "oqoodIssued",
  "instalmentsPaid",
  "handoverRecorded",
] as const satisfies readonly (keyof DealFacts)[];
const _allFactsListed: Exclude<keyof DealFacts, (typeof DEAL_FACT_KEYS)[number]> extends never ? true : never = true;
void _allFactsListed;

const isResale = (f: DealFacts) => f.type !== "primary_offplan";
const hasMortgage = (f: DealFacts) => f.sellerMortgage || f.buyerMortgage;
const takesPlan = (f: DealFacts) => f.type === "resale_offplan" && f.planTakenOver;

/**
 * No compliance case or gate is open. The sentence is neutral on purpose: guard reasons reach staff who may not see
 * compliance matters (no tipping-off, S50).
 */
const noOpenFlag: [ok: (f: DealFacts) => boolean, reason: string] = [
  (f) => !f.openAmlFlag,
  "A compliance review is open.",
];

/** Builds a guard from named checks: each failing check adds its sentence. */
const needs =
  (...checks: [ok: (f: DealFacts) => boolean, reason: string][]) =>
  (f: DealFacts): GuardResult => {
    const r = checks.filter(([ok]) => !ok(f)).map(([, reason]) => reason);
    return r.length ? deny(...r) : allow;
  };

type T = Transition<DealState, DealMachineEvent, DealFacts, SpaGateId>;
const CANCELLABLE_WITH_GATE: DealState[] = [
  "PARTY_CHECK",
  "AML_HOLD",
  "AGREEMENT_DRAFT",
  "LEGAL_REVIEW",
  "SIGNING",
  "REGISTRATION",
  "NOC",
  "FINANCE",
  "SETTLEMENT",
  "TRANSFER",
];

const transitions: T[] = [
  {
    from: "OFFER_AGREED",
    event: "CHECKS_STARTED",
    to: "PARTY_CHECK",
    guard: needs(
      [(f) => f.priceCleared, "The price or booking amount is outside policy and waits for a sales manager."],
      [(f) => f.documentsRequested, "Documents haven't been requested from every party."],
    ),
    description: "Documents requested from every party",
  },
  {
    from: "PARTY_CHECK",
    event: "CHECKS_PASSED",
    to: "AGREEMENT_DRAFT",
    guard: needs(
      [(f) => f.kycOk, "KYC isn't passed for every party."],
      // Fail closed: an unknown `hasCompanyParty` blocks like an unchecked company.
      [(f) => f.hasCompanyParty === false || f.companyChecksOk, "Company checks aren't passed."],
      [(f) => f.type === "primary_offplan" || f.ownershipOk, "Ownership isn't confirmed."],
      noOpenFlag,
    ),
    description: "KYC and company checks passed, no open AML flag",
  },
  // C18 (S50): the re-screen before the agreement can also put a deal on hold; same guard from every state.
  ...(["PARTY_CHECK", "AGREEMENT_DRAFT", "LEGAL_REVIEW"] as const).map((from): T => ({
    from,
    event: "AML_FLAGGED",
    to: "AML_HOLD",
    guard: needs([(f) => f.amlFlaggedByRule, "No AML rule raised a flag."]),
    description: "A code rule in aml-screening raised a flag",
  })),
  { from: "AML_HOLD", event: "AML_CLEARED", to: "PARTY_CHECK", gate: "aml_flag", description: "Compliance cleared it" },
  { from: "AML_HOLD", event: "AML_STOPPED", to: "CANCELLED", gate: "aml_flag", description: "Compliance stopped it" },
  {
    from: "AGREEMENT_DRAFT",
    event: "PREPARED",
    to: "LEGAL_REVIEW",
    guard: needs([(f) => f.agreementPrepared, "The agreement isn't prepared from an approved template."]),
    description: "Every core field filled from the approved template",
  },
  {
    from: "LEGAL_REVIEW",
    event: "APPROVED",
    to: "SIGNING",
    gate: "agreement_approval",
    guard: needs(noOpenFlag),
    description: "Legal approved",
  },
  {
    from: "LEGAL_REVIEW",
    event: "RETURNED",
    to: "AGREEMENT_DRAFT",
    gate: "agreement_approval",
    description: "Legal returned it",
  },
  {
    from: "SIGNING",
    event: "ALL_SIGNED_PRIMARY",
    to: "REGISTRATION",
    guard: needs(
      [(f) => f.type === "primary_offplan", "Only a primary off-plan deal goes to Oqood registration."],
      [(f) => f.allSigned, "Not every party has signed."],
      noOpenFlag,
    ),
    description: "Every signer signed (primary)",
  },
  {
    from: "SIGNING",
    event: "ALL_SIGNED_RESALE",
    to: "NOC",
    guard: needs(
      [isResale, "Only a resale goes to the developer NOC."],
      [(f) => f.allSigned, "Not every party has signed."],
      [(f) => f.depositRecorded, "The security deposit isn't recorded."],
      noOpenFlag,
    ),
    description: "Every signer signed and the deposit is recorded (resale)",
  },
  {
    from: "NOC",
    event: "NOC_OK_FINANCE",
    to: "FINANCE",
    guard: needs(
      [isResale, "Only a resale has a NOC step."],
      [hasMortgage, "No mortgage on either side: there is no finance step."],
      [(f) => f.nocOk, "The NOC isn't matched."],
      noOpenFlag,
    ),
    description: "NOC matched; a mortgage needs bank letters",
  },
  {
    from: "NOC",
    event: "NOC_OK_SETTLEMENT",
    to: "SETTLEMENT",
    guard: needs(
      [isResale, "Only a resale has a NOC step."],
      [(f) => !hasMortgage(f), "A mortgage needs the finance step first."],
      [(f) => f.nocOk, "The NOC isn't matched."],
      noOpenFlag,
    ),
    description: "NOC matched; no mortgage",
  },
  {
    from: "FINANCE",
    event: "FINANCE_OK",
    to: "SETTLEMENT",
    guard: needs(
      [(f) => f.bankLettersConfirmed, "Bank letters aren't uploaded and confirmed by a person."],
      noOpenFlag,
    ),
    description: "Bank letters uploaded, amounts confirmed by a person",
  },
  {
    from: "SETTLEMENT",
    event: "SETTLED",
    to: "TRANSFER",
    gate: "settlement_approval",
    guard: needs(
      [(f) => f.statementBalanced, "The settlement statement doesn't balance."],
      // Review 8: a mortgage's letters must still be confirmed when the statement is approved.
      [(f) => !hasMortgage(f) || f.bankLettersConfirmed, "Bank letters aren't uploaded and confirmed by a person."],
      // S48: a NOC that expired (or no longer matches) after the step it gates still blocks the deal.
      [(f) => f.nocOk, "The NOC isn't valid today."],
      noOpenFlag,
    ),
    description: "Finance approved a balanced statement",
  },
  {
    from: "TRANSFER",
    event: "TRANSFERRED_COMPLETE",
    to: "COMPLETED",
    gate: "transfer_submission",
    guard: needs(
      [isResale, "Only a resale is transferred."],
      [(f) => !takesPlan(f), "The buyer takes over a payment plan: instalments follow."],
      [(f) => f.transferIssued, "The transfer isn't issued."],
      [(f) => f.nocOk, "The NOC isn't valid today."],
      noOpenFlag,
    ),
    description: "Title deed or Oqood transfer issued",
  },
  {
    from: "TRANSFER",
    event: "TRANSFERRED_PLAN",
    to: "INSTALMENTS",
    gate: "transfer_submission",
    guard: needs(
      [takesPlan, "Only an off-plan resale taking over a plan has instalments after transfer."],
      [(f) => f.transferIssued, "The transfer isn't issued."],
      [(f) => f.nocOk, "The NOC isn't valid today."],
      noOpenFlag,
    ),
    description: "Oqood transfer issued; the buyer pays the remaining instalments",
  },
  {
    from: "REGISTRATION",
    event: "REGISTERED",
    to: "INSTALMENTS",
    gate: "oqood_submission",
    guard: needs(
      [(f) => f.type === "primary_offplan", "Only a primary off-plan deal is registered in Oqood."],
      [(f) => f.oqoodIssued, "No Oqood number is issued."],
      noOpenFlag,
    ),
    description: "Oqood number issued",
  },
  {
    from: "INSTALMENTS",
    event: "HANDOVER",
    to: "HANDED_OVER",
    guard: needs(
      [(f) => f.instalmentsPaid, "Not every instalment is paid."],
      [(f) => f.handoverRecorded, "The handover isn't recorded."],
      noOpenFlag,
    ),
    description: "All instalments paid and the handover recorded",
  },
  { from: "OFFER_AGREED", event: "CANCEL", to: "CANCELLED", description: "Cancelled before any check started" },
  ...CANCELLABLE_WITH_GATE.map((from): T => ({
    from,
    event: "CANCEL",
    to: "CANCELLED",
    gate: "cancellation",
    description: "Cancelled",
  })),
];

export const dealMachine = defineMachine<DealState, DealMachineEvent, DealFacts, SpaGateId>({
  entity: "deal",
  states: DEAL_STATES,
  events: [
    "CHECKS_STARTED",
    "CHECKS_PASSED",
    "AML_FLAGGED",
    "AML_CLEARED",
    "AML_STOPPED",
    "PREPARED",
    "APPROVED",
    "RETURNED",
    "ALL_SIGNED_PRIMARY",
    "ALL_SIGNED_RESALE",
    "NOC_OK_FINANCE",
    "NOC_OK_SETTLEMENT",
    "FINANCE_OK",
    "SETTLED",
    "TRANSFERRED_COMPLETE",
    "TRANSFERRED_PLAN",
    "REGISTERED",
    "HANDOVER",
    "CANCEL",
  ],
  initial: "OFFER_AGREED",
  terminal: ["HANDED_OVER", "COMPLETED", "CANCELLED"],
  transitions,
});

/** The approval results a gated transition accepts (`agreement_approval` rejected returns the draft). */
export type GateOutcome = "approved" | "rejected" | "clear" | "stop" | "stop_and_report";
export const DEAL_GATE_OUTCOMES: Readonly<Partial<Record<DealMachineEvent, readonly GateOutcome[]>>> = Object.freeze({
  APPROVED: ["approved"],
  RETURNED: ["rejected"],
  AML_CLEARED: ["clear"],
  AML_STOPPED: ["stop", "stop_and_report"],
  SETTLED: ["approved"],
  TRANSFERRED_COMPLETE: ["approved"],
  TRANSFERRED_PLAN: ["approved"],
  REGISTERED: ["approved"],
  CANCEL: ["approved"],
});
