import type { Llm } from "@platform/llm";
import type { RawBlank } from "@platform/readers/structure/blanks";
import * as reader from "@platform/readers/structure/mapping";
import type { TemplateProfile } from "@platform/readers/structure/profile";
import type { TemplateBlank } from "@platform/readers/structure/schema";
import { leasingTemplateProfile } from "./profile.ts";

/**
 * Leasing's own mapping rules for the shared contract-structure reader (S43): the tenancy label rules (party details,
 * cheques, property and contract words), the words after a blank, and cheque-date numbering. The generic matching
 * lives in `@platform/readers`; the wrappers below keep leasing's call signatures, with the leasing profile.
 */
export {
  type AskItem,
  type ProposeItem,
  type Proposal,
  redactValues,
  templateLines,
  unknownPlaceholderNote,
} from "@platform/readers/structure/mapping";

export type Party = "landlord" | "tenant";

const LANDLORD = /\b(landlord|owner|lessor)s?\b/;
const TENANT = /\b(tenant|lessee)s?\b/;

/** "landlord", "tenant", or null when the text names none or both. With a profile: the one party it names (S4). */
export function partyIn(text: string): Party | null;
export function partyIn(text: string, profile: TemplateProfile): string | null;
export function partyIn(text: string, profile?: TemplateProfile): string | null {
  if (profile) return reader.partyIn(text, profile);
  const t = text.toLowerCase();
  const l = LANDLORD.test(t);
  const te = TENANT.test(t);
  return l === te ? null : l ? "landlord" : "tenant";
}

/** The party named last in the lines up to and including `line` (looking back a few lines), or null. */
export function contextParty(lines: string[], line: number, lookBack?: number): Party | null;
export function contextParty(lines: string[], line: number, lookBack: number, profile: TemplateProfile): string | null;
export function contextParty(lines: string[], line: number, lookBack = 6, profile?: TemplateProfile): string | null {
  return reader.contextParty(lines, line, lookBack, profile ?? leasingTemplateProfile);
}

export const matchBlank = (
  label: string,
  b: Pick<RawBlank, "before" | "after">,
  party: string | null,
  profile: TemplateProfile = leasingTemplateProfile,
) => reader.matchBlank(label, b, party, profile);
export const fitsBlank = (
  field: string,
  label: string,
  b: Pick<RawBlank, "before" | "after">,
  profile: TemplateProfile = leasingTemplateProfile,
) => reader.fitsBlank(field, label, b, profile);
export const matchPlaceholder = (name: string, profile: TemplateProfile = leasingTemplateProfile) =>
  reader.matchPlaceholder(name, profile);
export const mappingMessages = (
  items: reader.AskItem[],
  nonce?: string,
  profile: TemplateProfile = leasingTemplateProfile,
) => reader.mappingMessages(items, nonce, profile);
export const askModel = (llm: Llm, items: reader.AskItem[], profile: TemplateProfile = leasingTemplateProfile) =>
  reader.askModel(llm, items, profile);
export const proposeMappings = (
  llm: Llm,
  items: reader.ProposeItem[],
  profile: TemplateProfile = leasingTemplateProfile,
) => reader.proposeMappings(llm, items, profile);
export const resuggestBlanks = (
  llm: Llm,
  sections: Parameters<typeof reader.templateLines>[0],
  blanks: TemplateBlank[],
) => reader.resuggestBlanks(llm, sections, blanks, leasingTemplateProfile);

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/\{\{b\d+\}\}/g, " ")
    .replace(/[_.:()[\]{}<>"'*#]+/g, " ")
    .replace(/e-mail/g, "email")
    .replace(/\s+/g, " ")
    .trim();

type Hit = string | null;

const ORDINALS = [
  "first",
  "second",
  "third",
  "fourth",
  "fifth",
  "sixth",
  "seventh",
  "eighth",
  "ninth",
  "tenth",
  "eleventh",
  "twelfth",
];
const CHEQUE = "(?:cheques?|checks?)";

/**
 * Cheque blanks: a dated one ("First cheque date", "Cheque date 3") maps to that instalment's date key, a bare
 * "cheque dates" to the whole list, an amount to the equal-instalment amount. Null when the label is neither.
 */
function chequeField(text: string): Hit {
  const dated = new RegExp(`\\b${CHEQUE}\\s*(?:no\\s*|num\\s*|number\\s*)?(?:dates?|due)\\b`).test(text);
  if (dated) {
    const ord = ORDINALS.findIndex((w) => new RegExp(`\\b${w}\\b`).test(text));
    const num = /\b(\d{1,2})(?:st|nd|rd|th)?\b/.exec(text)?.[1];
    const n = ord >= 0 ? ord + 1 : num ? Number(num) : 0;
    if (n > 12) return "leave_empty";
    return n ? `chequeDate${n}` : "chequeDates";
  }
  const nth = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*${CHEQUE}\\s*(?:no\\s*)?date\\b`).exec(text)?.[1];
  if (nth) return Number(nth) > 12 ? "leave_empty" : `chequeDate${Number(nth)}`;
  if (
    new RegExp(
      `\\b${CHEQUE}\\s*amounts?\\b|\\bamounts?\\s*(?:per|of each|of every)\\s*${CHEQUE}\\b|\\b(?:each|per)\\s*${CHEQUE}\\b|\\b(?:\\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\\s*${CHEQUE}\\s*of\\b`,
    ).test(text)
  )
    return "chequeAmountFils";
  return null;
}

/** One property or contract-level rule: the field (no party needed), or "leave_empty" for things we don't store. */
const GENERAL: [RegExp, Hit][] = [
  // Things the system does not store: leave empty, don't guess.
  [/\b(representative|representing|attorney|power of attorney|poa|signatory|authori[sz]ed person)\b/, "leave_empty"],
  [/\b(fax|po box|p o box|post box|po\.? ?box|zip|postal|pobox)\b/, "leave_empty"],
  [/\b(ejari|tawtheeq|registration)\b.*\b(paid by|payable by|borne by|payer)\b/, "registrationFeePayer"],
  [/\b(ejari|tawtheeq)\b.*\bfees?\b|\bfees?\b.*\b(ejari|tawtheeq)\b|\bregistration fees?\b/, "registrationFeeFils"],
  [/\b(other|additional|extra) fees?\b|\bfees? (summary|list)\b/, "feesSummary"],
  [/\bejari\b/, "leave_empty"],
  [/\bdewa\b|\bpremises?\s*(no|num|number|id)\b/, "dewaPremiseNo"],
  [/\b(occupants?|residents?)\b|\b(number|no|nr) of (persons|people)\b/, "leave_empty"],
  [
    /\b(monthly|per month|instal+ment amount|cheque amount|payment (method|mode)|mode of payment|bank|iban|account)\b/,
    "leave_empty",
  ],
  [/\b(cheque|check)\s*(no|num|number|date)\b(?!.*\bof\b)/, "leave_empty"],
  [/\b(sq ?ft|sqft|square feet|square foot)\b/, "areaSqft"],
  [
    /\b(area|size|space)\b.*\b(sqm|sq|m2|ft|square|meters?|metres?)\b|\b(sqm|sq ?m|m2|square (meters?|metres?))\b/,
    "leave_empty",
  ],
  [/\bfurnish\w*\b/, "furnishing"],
  [/\bparking\b/, "parkingSpaces"],
  [/\bbathrooms?\b/, "bathrooms"],
  [/\bfloor\b/, "floor"],
  [
    /\b(tenancy|lease|contract|rental)\s*(period|term|duration)\b|\bperiod of (the )?(tenancy|lease|contract)\b/,
    "tenancyPeriod",
  ],
  // A bare "type" names nothing ("Payment type", "ID type"): only a property's type or subtype is the subtype.
  [/\b(property|unit|premises)\s*(type|subtype)\b|\bsubtype\b/, "propertySubtype"],
  // Contract.
  [
    /\b(date of (the )?(contract|agreement|signing|execution|tenancy contract)|contract date|agreement date|signing date|date signed|made on|dated)\b/,
    "contractOn",
  ],
  [/\b(ref|reference)\b|\b(contract|lease|tenancy|agreement)\s*(contract\s*)?(no|num|number|id)\b/, "leaseRef"],
  [/\bmove[- ]?in\b/, "moveInOn"],
  [/\b(rent[- ]?free|free (days|period)|grace)\b/, "rentFreeDays"],
  [/\b(security )?deposit\b|\binsurance\b/, "depositFils"],
  [
    /\b(number of|no of|nr of|count of)\s*(cheques?|checks?|instal+ments?|payments?)\b|\b(cheques?|checks?|instal+ments?)\b/,
    "cheques",
  ],
  [
    /\b(annual|yearly|total|contract|lease|tenancy)\s*(rent|rental|value|amount)\b|\brent(al)?\s*(value|amount|per (year|annum))\b|\bannum\b|^rent(al)?$/,
    "annualRentFils",
  ],
  [/\b(starts?|starting|commenc\w*|beginning|begins?)\b/, "startOn"],
  [/\b(ends?|ending|expiry|expir\w*|expires|termination date|until)\b/, "endOn"],
  // Property.
  [/\bmakani\b/, "makaniNo"],
  [/\bplot\b/, "plotNo"],
  [/\b(property|dld|registry|title deed|land)\s*(no|num|number|id)\b/, "dldPropertyNo"],
  // D70: before "unit": "Unit description" and "Unit code" are not the unit number.
  [/\bdescription\b/, "unitDescription"],
  [/\b(unit|property) code\b/, "unitCode"],
  [/\bcategory\b/, "propertySubtype"],
  [/\b(unit|flat|apartment|villa|office|shop)\s*(no|num|number)?\b/, "unitNo"],
  [/\bbuilding\b|\btower\b|\bproject\b/, "building"],
  [/\b(community|area|location|district|locality|zone)\b/, "community"],
  [/\b(bedrooms?|beds|br)\b/, "bedrooms"],
  [/\b(property )?(usage|use|purpose)\b/, "propertyUsage"],
];

/** Rules for a party's own details; the party comes from the label or the context. */
function partyField(text: string, party: Party | null): Hit {
  if (!party) return null;
  const key = (suffix: string) => `${party}${suffix}`;
  const expiry = /\b(expir\w*|valid\w*)\b/.test(text);
  if (/\baddress\b/.test(text)) return "leave_empty";
  if (/\bpassport\b/.test(text)) return key(expiry ? "PassportExpiresOn" : "PassportNo");
  if (/\bvisa\b/.test(text)) return key(expiry ? "VisaExpiresOn" : "VisaNo");
  if (/\b(birth|dob)\b/.test(text)) return key("BirthDate");
  const eid = /\b(emirates|eid|national)\b.*\bid\b|\bemirates id\b|\beid\b|\bid (no|num|number|card)\b/.test(text);
  const licence = /\b(trade )?licen[cs]e\b/.test(text);
  if (eid || licence) {
    if (expiry) return key(eid ? "IdExpiresOn" : "TradeLicenceExpiresOn");
    if (party === "landlord") return "landlordIdNo";
    return licence && !eid ? "tenantTradeLicenceNo" : "tenantEmiratesIdNo";
  }
  if (/\bnationalit/.test(text)) return key("Nationality");
  if (/\b(phone|mobile|tel|telephone|cell|contact (no|num|number)|gsm)\b/.test(text)) return key("Phone");
  if (/\bemail\b/.test(text)) return key("Email");
  if (/\bname\b|^(landlord|owner|lessor|tenant|lessee)s?$/.test(text)) return key("NameEn");
  return null;
}

/**
 * Deterministic matcher: the label (and the words just before the blank) against synonym rules.
 * `party` is the nearest "Landlord/Owner" or "Tenant/Lessee" context. Returns a catalogue field, "leave_empty"
 * for something the system doesn't store, or null when the label says nothing certain.
 */
export function matchLabel(label: string, party: Party | null): Hit {
  const text = norm(label);
  if (!text) return null;
  const own = partyIn(text);
  const p = own ?? party;
  // Party details first when the label itself names a party ("Landlord Nationality", "Tenant phone").
  if (own) {
    const hit = partyField(text, own);
    if (hit) return hit;
  }
  const cheque = chequeField(text);
  if (cheque) return cheque;
  for (const [re, hit] of GENERAL) if (re.test(text)) return hit;
  // Context party only for bare detail labels ("Nationality:", "Phone").
  if (!own && p) return partyField(text, p);
  return null;
}

/**
 * The words right after a blank that say what it counts ("payable in ____ cheques"): a field, or null. They are the
 * sample's own text, so they outweigh a model's label that names nothing we store ("Payment method type").
 */
export function matchAfter(after: string): Hit {
  const next = after.toLowerCase().replace(/^[\s_.]*/, "");
  return /^(post[- ]?dated\s+)?(cheques?|checks?|pdcs?)\b/.test(next) ? "cheques" : null;
}

const CHEQUE_DATE_KEY = /^chequeDate(?:s|\d{1,2})$/;
const RUN = /\{\{b\d+\}\}(?:\s*(?:\||,|\/|;|and|&)?\s*\{\{b\d+\}\})+/g;

/**
 * D70: a row of cheque-date blanks ("Cheque Dates {{b1}} | {{b2}} | {{b3}} | {{b4}}") is numbered by position: the
 * nth blank prints the nth instalment's date, whatever each one was labelled ("Cheque dates" on the first is common).
 * Only a run of two or more cheque-date blanks (at least two already mapped to cheque-date keys) is changed.
 */
export function numberChequeDateRuns<
  B extends { id: string; field: string; label: string; fieldType: string | null; role: string },
>(texts: readonly (string | null | undefined)[], blanks: B[]): B[] {
  const byId = new Map(blanks.map((b) => [b.id, b]));
  const renumber = new Map<string, number>();
  for (const text of texts) {
    for (const m of (text ?? "").matchAll(RUN)) {
      const ids = [...m[0].matchAll(/\{\{(b\d+)\}\}/g)].map((x) => x[1]!);
      const run = ids.map((id) => byId.get(id));
      // A blank left empty whose label says it is a cheque date belongs to the row too (the mapping is not always sure).
      const dated = (x: B) =>
        CHEQUE_DATE_KEY.test(x.field) || (/\b(?:cheques?|checks?)\b/i.test(x.label) && /\bdates?\b/i.test(x.label));
      if (ids.length > 12 || !run.every((x) => x && x.role === "field" && dated(x))) continue;
      if (run.filter((x) => CHEQUE_DATE_KEY.test(x!.field)).length < 2) continue;
      ids.forEach((id, i) => renumber.set(id, i + 1));
    }
  }
  return blanks.map((b) => {
    const n = renumber.get(b.id);
    return n ? { ...b, field: `chequeDate${n}`, fieldType: "date", label: `Cheque ${n} date` } : b;
  });
}
