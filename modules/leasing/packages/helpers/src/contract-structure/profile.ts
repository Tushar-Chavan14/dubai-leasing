import { isSheetKey, SHEET_KEY_NAMES, sheetForPrompt, sheetKeyInfo } from "./datasheet.ts";
import type { FieldInfo } from "./fields.ts";
import { matchAfter, matchLabel } from "./mapping.ts";

/**
 * The words and keys the shared contract-structure reader uses (S4, S5): the helper name, how the prompts name the
 * document, the parties a blank can belong to, the data sheet blanks map to, placeholder aliases and the label rules.
 * Leasing passes nothing and gets `leasingTemplateProfile`, so its prompts and mappings stay the same; SPA (P5) passes
 * its own (Seller / Purchaser / Broker). Every value is still copied by code at prepare time, never by a model.
 */
export interface TemplateParty {
  /** The party key prefix and the `party` the model sees ("landlord"). */
  role: string;
  /** Lower-case words that name the party in a contract ("landlord", "owner", "lessor"); a plural `s` also counts. */
  words: readonly string[];
}

export interface TemplateSheet {
  isKey(key: string): boolean;
  keyNames: readonly string[];
  keyInfo(key: string): FieldInfo | null;
  /** The key list the model sees: key | type | description, never a value. */
  forPrompt(): string;
}

export interface TemplateProfile {
  helperName: string;
  /** First line of the structure prompt. */
  structureIntro: string;
  /** Example labels in the structure prompt, e.g. `"Annual rent", "Landlord nationality"`. */
  labelExamples: string;
  /** First line of the mapping prompt. */
  mappingIntro: string;
  /** The mapping prompt's rule about parties' keys. */
  partyKeyRule: string;
  /** Parties in order; a text naming exactly one of them belongs to it. */
  parties: readonly TemplateParty[];
  sheet: TemplateSheet;
  /** Compact placeholder name (lower case, no spaces or punctuation) to data-sheet key (D74). */
  placeholderAliases: Readonly<Record<string, string>>;
  /** Code label rules: a data-sheet key, "leave_empty", or null when the label says nothing certain. */
  matchLabel(label: string, party: string | null): string | null;
  /** Code rule on the words right after a blank ("____ cheques"): a data-sheet key, or null. */
  matchAfter?(after: string): string | null;
}

/**
 * D74: names a template may give a placeholder, as the lower-case name without spaces or punctuation: the names the
 * generic UAE template uses, and common synonyms. The name of a data-sheet key itself is read as well (`community`,
 * `tenantNameEn`, `leaseRef` ...), then the label rules. Only code reads names; no model is asked.
 */
const LEASING_PLACEHOLDER_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  companyname: "companyName",
  companytradelicenceno: "companyTradeLicenceNo",
  contractno: "leaseRef",
  contractnumber: "leaseRef",
  tenancycontractno: "leaseRef",
  leaseno: "leaseRef",
  leasenumber: "leaseRef",
  leasereference: "leaseRef",
  referenceno: "leaseRef",
  emirate: "emirateName",
  emiratename: "emirateName",
  contractdate: "contractOn",
  dateofcontract: "contractOn",
  agreementdate: "contractOn",
  landlordname: "landlordNameEn",
  landlordfullname: "landlordNameEn",
  lessorname: "landlordNameEn",
  ownername: "landlordNameEn",
  landlordtradelicenceno: "landlordTradeLicenceNo",
  landlordtradelicencenumber: "landlordTradeLicenceNo",
  landlordlicenceno: "landlordTradeLicenceNo",
  landlordlicenseno: "landlordTradeLicenceNo",
  landlordaddress: "landlordAddress",
  landlordemail: "landlordEmail",
  landlordphone: "landlordPhone",
  landlordmobile: "landlordPhone",
  signatoryname: "signatoryName",
  signatorytitle: "signatoryTitle",
  signatoryemail: "signatoryEmail",
  tenantname: "tenantNameEn",
  tenantfullname: "tenantNameEn",
  lesseename: "tenantNameEn",
  tenantemiratesid: "tenantEmiratesIdNo",
  tenantemiratesidno: "tenantEmiratesIdNo",
  tenanteid: "tenantEmiratesIdNo",
  tenantpassportno: "tenantPassportNo",
  tenantpassportnumber: "tenantPassportNo",
  tenantnationality: "tenantNationality",
  tenantemail: "tenantEmail",
  tenantphone: "tenantPhone",
  tenantmobile: "tenantPhone",
  unitno: "unitNo",
  unitnumber: "unitNo",
  flatno: "unitNo",
  building: "building",
  buildingname: "building",
  community: "community",
  propertycommunity: "community",
  communityarea: "community",
  area: "community",
  propertytype: "propertySubtype",
  propertysubtype: "propertySubtype",
  propertyusage: "propertyUsage",
  usage: "propertyUsage",
  propertyno: "dldPropertyNo",
  propertynumber: "dldPropertyNo",
  registrypropertyno: "dldPropertyNo",
  makanino: "makaniNo",
  makaninumber: "makaniNo",
  plotno: "plotNo",
  plotnumber: "plotNo",
  utilityprovider: "utilityProvider",
  utilityaccountno: "dewaPremiseNo",
  utilityaccountnumber: "dewaPremiseNo",
  utilitypremiseno: "dewaPremiseNo",
  areasqft: "areaSqft",
  bedrooms: "bedrooms",
  bathrooms: "bathrooms",
  parkingspaces: "parkingSpaces",
  furnishing: "furnishing",
  unitdescription: "unitDescription",
  startdate: "startOn",
  termstart: "startOn",
  enddate: "endOn",
  termend: "endOn",
  moveindate: "moveInOn",
  annualrent: "annualRentFils",
  rent: "annualRentFils",
  noofcheques: "cheques",
  numberofcheques: "cheques",
  chequecount: "cheques",
  chequeamount: "chequeAmountFils",
  chequedates: "chequeDates",
  chequepayee: "chequePayeeName",
  chequespayableto: "chequePayeeName",
  securitydeposit: "depositFils",
  deposit: "depositFils",
  registrationfee: "registrationFeeFils",
  registrationfeepayer: "registrationFeePayer",
  otherfees: "feesSummary",
  rentfreedays: "rentFreeDays",
  renewalnoticedays: "renewalNoticeDays",
  repossessionnoticemonths: "repossessionNoticeMonths",
  laterentdays: "lateRentDays",
  registrationsystem: "registrationSystem",
  registeringauthority: "registeringAuthority",
  governinglaw: "governingLaw",
  disputebody: "disputeBody",
  additionalterms: "additionalTerms",
});

export const leasingTemplateProfile: TemplateProfile = Object.freeze({
  helperName: "contract_structure",
  structureIntro:
    "You read a company's sample residential tenancy contract and describe its structure so it can be reused as a template.",
  labelExamples: '"Annual rent", "Landlord nationality"',
  mappingIntro: "You match blanks of a company's tenancy contract template to the data the system holds.",
  partyKeyRule: "A landlord blank never takes a tenant key and the other way round.",
  parties: Object.freeze([
    Object.freeze({ role: "landlord", words: Object.freeze(["landlord", "owner", "lessor"]) }),
    Object.freeze({ role: "tenant", words: Object.freeze(["tenant", "lessee"]) }),
  ]),
  sheet: Object.freeze({
    isKey: isSheetKey,
    keyNames: SHEET_KEY_NAMES,
    keyInfo: sheetKeyInfo,
    forPrompt: sheetForPrompt,
  }),
  placeholderAliases: LEASING_PLACEHOLDER_ALIASES,
  matchLabel: (label: string, party: string | null) => matchLabel(label, party as "landlord" | "tenant" | null),
  matchAfter,
});
