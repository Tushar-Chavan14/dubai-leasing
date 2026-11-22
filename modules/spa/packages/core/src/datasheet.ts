/**
 * The SPA data sheet (architecture §7, S5): every value a template blank or placeholder can be filled from. A blank is
 * mapped to a key by code (aliases, then the key's own name), then by the decision model from labels only (P5); the
 * value is copied from the records at prepare time. Core keys never print empty: preparation stops instead.
 */
export type SheetGroup = "buyer" | "seller" | "broker" | "unit" | "money" | "plan" | "resale" | "dates" | "other";
export type SheetType = "text" | "money_fils" | "date" | "int" | "bps" | "table";
export interface SheetKeyInfo {
  group: SheetGroup;
  type: SheetType;
  label: string;
  core: boolean;
  /** Printed once per buyer or per seller (repeatable party blocks). */
  repeat?: "buyer" | "seller";
  /** Must not print empty for these deal types only (a ready resale has no payment plan). */
  requiredFor?: readonly ("primary_offplan" | "resale_ready" | "resale_offplan")[];
}

const k = (group: SheetGroup, type: SheetType, label: string, core = false): SheetKeyInfo => ({
  group,
  type,
  label,
  core,
  ...(group === "buyer" || group === "seller" ? { repeat: group } : {}),
});

export const spaDataSheet = Object.freeze({
  purchaser_name: k("buyer", "text", "Purchaser full name", true),
  purchaser_nationality: k("buyer", "text", "Purchaser nationality"),
  purchaser_passport_no: k("buyer", "text", "Purchaser passport number"),
  purchaser_eid_no: k("buyer", "text", "Purchaser Emirates ID number"),
  purchaser_address: k("buyer", "text", "Purchaser address"),
  purchaser_email: k("buyer", "text", "Purchaser email"),
  purchaser_phone: k("buyer", "text", "Purchaser phone"),
  purchaser_share: k("buyer", "bps", "Purchaser share"),
  // A company purchaser prints its licence and signatory like a company seller does (C14, S46).
  purchaser_licence_no: k("buyer", "text", "Purchaser trade licence number"),
  purchaser_signatory_name: k("buyer", "text", "Purchaser signatory name"),
  purchaser_signatory_title: k("buyer", "text", "Purchaser signatory title"),
  seller_name: k("seller", "text", "Seller name", true),
  seller_id_no: k("seller", "text", "Seller ID number"),
  seller_share: k("seller", "bps", "Seller share"),
  seller_licence_no: k("seller", "text", "Seller trade licence number"),
  seller_address: k("seller", "text", "Seller address"),
  seller_signatory_name: k("seller", "text", "Seller signatory name"),
  seller_signatory_title: k("seller", "text", "Seller signatory title"),
  broker_agency: k("broker", "text", "Broker agency"),
  broker_orn: k("broker", "text", "Broker office registration number (ORN)"),
  broker_agent_name: k("broker", "text", "Broker agent name"),
  broker_brn: k("broker", "text", "Broker registration number (BRN)"),
  broker_commission: k("broker", "bps", "Broker commission"),
  project_name: k("unit", "text", "Project name"),
  building: k("unit", "text", "Building", true),
  unit_no: k("unit", "text", "Unit number", true),
  floor: k("unit", "text", "Floor"),
  unit_type: k("unit", "text", "Unit type"),
  area_sqft: k("unit", "int", "Area (sq ft)"),
  parking: k("unit", "text", "Parking"),
  plot_no: k("unit", "text", "Plot number"),
  price: k("money", "money_fils", "Sale price", true),
  price_words: k("money", "text", "Sale price in words", true),
  discount: k("money", "money_fils", "Discount"),
  dld_fee: k("money", "money_fils", "DLD registration fee", true),
  oqood_fee: k("money", "money_fils", "Oqood fee"),
  booking_amount: k("money", "money_fils", "Booking amount"),
  payment_plan: { ...k("plan", "table", "Payment plan"), requiredFor: ["primary_offplan"] },
  instalment_n_amount: k("plan", "money_fils", "Instalment amount (by number)"),
  instalment_n_due: k("plan", "date", "Instalment due date (by number)"),
  title_deed_no: k("resale", "text", "Title deed number"),
  oqood_no: k("resale", "text", "Oqood number"),
  noc_ref: k("resale", "text", "Developer NOC reference"),
  deposit_amount: k("resale", "money_fils", "Security deposit"),
  transfer_date: k("resale", "date", "Transfer date"),
  seller_bank: k("resale", "text", "Seller's bank"),
  buyer_bank: k("resale", "text", "Buyer's bank"),
  loan_amount: k("resale", "money_fils", "Loan amount"),
  settlement_table: k("resale", "table", "Settlement statement"),
  agreement_date: k("dates", "date", "Agreement date"),
  anticipated_completion: k("dates", "date", "Anticipated completion"),
  governing_law: k("dates", "text", "Governing law"),
  dispute_body: k("dates", "text", "Dispute body"),
  additional_terms: k("other", "text", "Additional terms"),
  booking_ref: k("other", "text", "Booking reference"),
} satisfies Record<string, SheetKeyInfo>);
export type SpaSheetKey = keyof typeof spaDataSheet;

const compact = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** Other names a template may use for a key, as the compact lower-case name. */
export const SPA_SHEET_ALIASES: Readonly<Record<string, SpaSheetKey>> = Object.freeze({
  buyername: "purchaser_name",
  buyerfullname: "purchaser_name",
  purchasername: "purchaser_name",
  buyernationality: "purchaser_nationality",
  buyerpassportno: "purchaser_passport_no",
  buyeremail: "purchaser_email",
  buyerphone: "purchaser_phone",
  vendorname: "seller_name",
  ownername: "seller_name",
  developername: "seller_name",
  saleprice: "price",
  purchaseprice: "price",
  totalprice: "price",
  dldfee: "dld_fee",
  registrationfee: "dld_fee",
  titledeedno: "title_deed_no",
  titledeednumber: "title_deed_no",
  unitnumber: "unit_no",
  projectname: "project_name",
  securitydeposit: "deposit_amount",
  depositamount: "deposit_amount",
});

const BY_COMPACT = new Map(Object.keys(spaDataSheet).map((key) => [compact(key), key as SpaSheetKey]));

/** The data-sheet key a template name stands for: an alias, else the key's own name in any case; null if unknown. */
export function spaSheetKeyFor(name: string): SpaSheetKey | null {
  const c = compact(name);
  if (!c) return null;
  return SPA_SHEET_ALIASES[c] ?? BY_COMPACT.get(c) ?? null;
}
