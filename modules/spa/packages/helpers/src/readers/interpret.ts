import { maskIban, parseBps, parseClearance, parseDate, parseIban, parseMoneyFils, parsePageOf } from "./parse.ts";
import type { ReadFields, ReadFieldValue } from "./schema.ts";

/** A reading below this confidence is unreadable and goes to a person (specs 6.1 rule 5). */
export const READ_MIN_CONFIDENCE = 0.8;

type Field = ReadFieldValue | undefined | null;
type Pages = "complete" | "missing" | "unknown";

/** The text of a field if it was read with enough confidence, else null. */
const clear = (f: Field, min: number): string | null => {
  const v = f?.value?.trim();
  return v && f && f.confidence >= min ? v : null;
};
const list = (fs: Field[] | undefined, min: number): { names: string[]; allClear: boolean } => {
  const all = fs ?? [];
  const names = all.map((f) => clear(f, min)).filter((n): n is string => n !== null);
  return { names, allClear: all.length > 0 && names.length === all.length };
};
const dateOf = (f: Field, min: number): string | null => parseDate(clear(f, min));
const as = <T>(fields: ReadFields): T => fields as T;

interface NocRead {
  unitNo: Field;
  sellerNames: Field[];
  issuedOn: Field;
  expiresOn: Field;
  serviceCharges: Field;
  amountPaid: Field;
}
/** A NOC as code reads it. The paid amount is only ever `paidReadFils`: it counts after a person confirms it (S47). */
export function interpretNoc(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<NocRead>(fields);
  const sellers = list(r.sellerNames, min);
  const out = {
    unitNo: clear(r.unitNo, min),
    sellerNames: sellers.allClear ? sellers.names : [],
    issuedOn: dateOf(r.issuedOn, min),
    expiresOn: dateOf(r.expiresOn, min),
    serviceChargesCleared: parseClearance(clear(r.serviceCharges, min)),
    paidReadFils: parseMoneyFils(clear(r.amountPaid, min)),
  };
  const unreadable: string[] = [];
  if (!out.unitNo) unreadable.push("unitNo");
  if (!sellers.allClear) unreadable.push("sellerNames");
  if (!out.issuedOn) unreadable.push("issuedOn");
  if (!out.expiresOn) unreadable.push("expiresOn");
  if (out.serviceChargesCleared === null) unreadable.push("serviceChargesCleared");
  return { ...out, amountUnread: out.paidReadFils === null, unreadable };
}

interface LetterRead {
  bankName: Field;
  partyNames: Field[];
  amount: Field;
  issuedOn: Field;
  validUntil: Field;
}
/** A bank letter as code reads it. `amountReadFils` is shown beside the letter and never used until confirmed (S47). */
export function interpretLetter(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<LetterRead>(fields);
  const issuedOn = dateOf(r.issuedOn, min);
  const validUntil = dateOf(r.validUntil, min);
  const amountReadFils = parseMoneyFils(clear(r.amount, min));
  return {
    bankName: clear(r.bankName, min),
    partyNames: list(r.partyNames, min).names,
    amountReadFils,
    amountUnread: amountReadFils === null,
    issuedOn,
    // A validity date before the issue date can't be right: treated as unread.
    validUntil: validUntil && issuedOn && validUntil < issuedOn ? null : validUntil,
    unreadable: issuedOn ? [] : ["issuedOn"],
  };
}

interface LicenceRead {
  licenceNo: Field;
  tradeName: Field;
  expiresOn: Field;
  managerName: Field;
}
export function interpretLicence(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<LicenceRead>(fields);
  const out = {
    licenceNo: clear(r.licenceNo, min),
    tradeName: clear(r.tradeName, min),
    expiresOn: dateOf(r.expiresOn, min),
    managerName: clear(r.managerName, min),
  };
  const unreadable: string[] = (["licenceNo", "tradeName", "expiresOn"] as const).filter((k) => !out[k]);
  return { ...out, unreadable };
}

/** Words that make a shareholder a company even when the model called it a person. */
const CORPORATE =
  /\b(llc|l\.l\.c|ltd|limited|fze|fzco|fz-llc|holding|holdings|inc|corp|corporation|company|co|establishment|est|pjsc|psc|group|trust|foundation|partnership|bank)\b/i;
const CORPORATE_KIND = /\b(company|corporate|entity|legal|organi[sz]ation)\b/i;

interface MoaRead {
  companyName: Field;
  shareholders: { name: Field; percent: Field; holderKind: Field }[];
  pageOf: Field;
}
export interface Shareholder {
  name: string;
  bps: number | null;
  corporate: boolean;
}
/** A memorandum as code reads it: each shareholder's percentage in bps (null if unread) and whether it is a company. */
export function interpretMoa(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<MoaRead>(fields);
  const shareholders: Shareholder[] = [];
  let unreadName = false;
  for (const s of r.shareholders ?? []) {
    const name = clear(s.name, min);
    if (!name) {
      unreadName = true;
      continue;
    }
    shareholders.push({
      name,
      bps: parseBps(clear(s.percent, min)),
      corporate: CORPORATE.test(name) || CORPORATE_KIND.test(s.holderKind?.value ?? ""),
    });
  }
  return {
    companyName: clear(r.companyName, min),
    shareholders,
    // A name that couldn't be read is a holder whose share can't be known too.
    percentUnread: unreadName || shareholders.some((s) => s.bps === null),
    pages: parsePageOf(clear(r.pageOf, min)) as Pages,
  };
}

/** A listed power that covers the sale, purchase or transfer of property. */
const PROPERTY_POWER =
  /\b(sell|sale|purchase|buy|transfer|convey|dispose|real[\s-]estate|immovable|propert(?:y|ies)|spa|mou|memorandum of understanding|assignment|unit)\b/i;
const NEGATED = /\b(not|except|excluding|excluded|without|no power|shall not|may not)\b/i;

interface AuthorityRead {
  granteeName?: Field;
  signerName?: Field;
  powers: Field[];
  validUntil?: Field;
  pageOf: Field;
}
/** A POA or board resolution as code reads it: who signs, whether a power covers property, and until when. */
export function interpretAuthority(profile: "poa" | "board_resolution", fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<AuthorityRead & { resolutionDate?: Field }>(fields);
  const signerName = clear(profile === "poa" ? r.granteeName : r.signerName, min);
  const powers = (r.powers ?? []).map((p) => clear(p, min)).filter((p): p is string => p !== null);
  const endField = profile === "poa" ? r.validUntil : undefined;
  const endText = clear(endField, min);
  const validUntil: string | null = parseDate(endText);
  // A date the model saw but code can't parse, or one read below the bar, is unread. Not printed at all is "no end".
  const validUntilUnread =
    !!endField &&
    !validUntil &&
    (endField.value !== null || endField.confidence < min) &&
    !!(endField.value ?? "").trim();
  const unreadable: string[] = [];
  if (!signerName) unreadable.push("signerName");
  return {
    kind: profile,
    signerName,
    coversProperty: powers.some((p) => PROPERTY_POWER.test(p) && !NEGATED.test(p)),
    validUntil,
    validUntilUnread,
    unreadable,
  };
}

interface DeedRead {
  documentNumber: Field;
  propertyNumber: Field;
  owners: { name: Field; share: Field }[];
}
export interface DeedOwner {
  name: string;
  bps: number | null;
}
/** A title deed or Oqood as code reads it: owners with shares in bps (null if unread). */
export function interpretDeed(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<DeedRead>(fields);
  const owners: DeedOwner[] = [];
  let unreadName = false;
  for (const o of r.owners ?? []) {
    const name = clear(o.name, min);
    if (!name) unreadName = true;
    else owners.push({ name, bps: parseBps(clear(o.share, min)) });
  }
  const propertyNumber = clear(r.propertyNumber, min);
  const documentNumber = clear(r.documentNumber, min);
  const unreadable: string[] = [];
  if (!propertyNumber) unreadable.push("propertyNumber");
  if (!documentNumber) unreadable.push("documentNumber");
  return {
    documentNumber,
    propertyNumber,
    owners,
    ownersUnread: unreadName,
    sharesUnread: owners.some((o) => o.bps === null),
    unreadable,
  };
}

interface ReceiptRead {
  amount: Field;
  paidOn: Field;
  payerName: Field;
  receivingAccount: Field;
  reference: Field;
}
/**
 * A transfer receipt as code reads it (S55). `amountReadFils` is shown beside the receipt and never counts until a
 * finance person confirms it. `accountIban` is set only for a clearly read, well-formed AE IBAN; code compares it with
 * the project's escrow account. `accountMasked` is all that is stored.
 */
export function interpretReceipt(fields: ReadFields, min = READ_MIN_CONFIDENCE) {
  const r = as<ReceiptRead>(fields);
  const amountReadFils = parseMoneyFils(clear(r.amount, min));
  const accountIban = parseIban(clear(r.receivingAccount, min));
  const payerName = clear(r.payerName, min);
  const unreadable: string[] = [];
  if (amountReadFils === null) unreadable.push("amount");
  if (!payerName) unreadable.push("payerName");
  if (!accountIban) unreadable.push("receivingAccount");
  return {
    amountReadFils,
    paidOn: dateOf(r.paidOn, min),
    payerName,
    accountIban,
    accountMasked: accountIban ? maskIban(accountIban) : null,
    reference: clear(r.reference, min),
    amountUnread: amountReadFils === null,
    unreadable,
  };
}
