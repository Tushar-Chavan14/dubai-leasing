import { ReadField } from "@platform/readers/kyc/schema";
import { z } from "zod";

/**
 * What the vision model must return per document profile (C20, S52). Every value is text exactly as printed with the
 * model's own confidence; code parses and decides (`interpret.ts`). `notes` is any other text on the page, copied
 * as is, so instruction-like text is found by code.
 */
export const READ_PROFILES = [
  "noc",
  "liability_letter",
  "release_letter",
  "pre_approval",
  "final_offer",
  "sof_evidence",
  "edd",
  "trade_licence",
  "moa",
  "poa",
  "board_resolution",
  "title_deed",
  "oqood",
  "payment_receipt",
] as const;
export type ReadProfile = (typeof READ_PROFILES)[number];
export const AUTHORITY_PROFILES = ["poa", "board_resolution"] as const;
export const BANK_LETTER_PROFILES = ["liability_letter", "release_letter", "pre_approval", "final_offer"] as const;

const F = ReadField;
const notes = z.string().max(4000).default("");
const doc = <P extends string>(p: P) => z.enum([p, "other"]);

const letter = (p: "liability_letter" | "release_letter" | "pre_approval" | "final_offer") =>
  z.object({
    documentType: doc(p),
    bankName: F,
    partyNames: z.array(F).max(10),
    amount: F,
    issuedOn: F,
    validUntil: F,
    notes,
  });
const owner = z.object({ name: F, share: F });
const deed = (p: "title_deed" | "oqood") =>
  z.object({
    documentType: doc(p),
    documentNumber: F,
    propertyNumber: F,
    owners: z.array(owner).max(20),
    notes,
  });
const supporting = (p: "sof_evidence" | "edd") =>
  z.object({ documentType: doc(p), holderName: F, issuedOn: F, amount: F, notes });

export const READ_SCHEMAS = {
  noc: z.object({
    documentType: doc("noc"),
    unitNo: F,
    sellerNames: z.array(F).max(10),
    issuedOn: F,
    expiresOn: F,
    serviceCharges: F,
    amountPaid: F,
    notes,
  }),
  liability_letter: letter("liability_letter"),
  release_letter: letter("release_letter"),
  pre_approval: letter("pre_approval"),
  final_offer: letter("final_offer"),
  sof_evidence: supporting("sof_evidence"),
  edd: supporting("edd"),
  trade_licence: z.object({
    documentType: doc("trade_licence"),
    licenceNo: F,
    tradeName: F,
    issuingAuthority: F,
    expiresOn: F,
    managerName: F,
    notes,
  }),
  moa: z.object({
    documentType: doc("moa"),
    companyName: F,
    shareholders: z.array(z.object({ name: F, percent: F, holderKind: F })).max(30),
    pageOf: F,
    notes,
  }),
  poa: z.object({
    documentType: doc("poa"),
    grantorName: F,
    granteeName: F,
    powers: z.array(F).max(30),
    validUntil: F,
    pageOf: F,
    notes,
  }),
  board_resolution: z.object({
    documentType: doc("board_resolution"),
    companyName: F,
    signerName: F,
    powers: z.array(F).max(30),
    resolutionDate: F,
    pageOf: F,
    notes,
  }),
  title_deed: deed("title_deed"),
  oqood: deed("oqood"),
  payment_receipt: z.object({
    documentType: doc("payment_receipt"),
    amount: F,
    paidOn: F,
    payerName: F,
    receivingAccount: F,
    reference: F,
    notes,
  }),
} as const satisfies Record<ReadProfile, z.ZodType>;

export const readSchemaFor = (p: ReadProfile): z.ZodType => READ_SCHEMAS[p];
export type ReadFields = Record<string, unknown>;
export type ReadFieldValue = z.infer<typeof ReadField>;
