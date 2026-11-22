import { describe, expect, test } from "bun:test";
import { SPA_SHEET_ALIASES, spaDataSheet, spaSheetKeyFor } from "../src/index.ts";

// architecture §7, "SPA data-sheet keys".
const SPEC = {
  buyer: [
    "purchaser_name",
    "purchaser_nationality",
    "purchaser_passport_no",
    "purchaser_eid_no",
    "purchaser_address",
    "purchaser_email",
    "purchaser_phone",
    "purchaser_share",
    "purchaser_licence_no",
    "purchaser_signatory_name",
    "purchaser_signatory_title",
  ],
  seller: [
    "seller_name",
    "seller_id_no",
    "seller_share",
    "seller_licence_no",
    "seller_address",
    "seller_signatory_name",
    "seller_signatory_title",
  ],
  broker: ["broker_agency", "broker_orn", "broker_agent_name", "broker_brn", "broker_commission"],
  unit: ["project_name", "building", "unit_no", "floor", "unit_type", "area_sqft", "parking", "plot_no"],
  money: ["price", "price_words", "discount", "dld_fee", "oqood_fee", "booking_amount"],
  plan: ["payment_plan", "instalment_n_amount", "instalment_n_due"],
  resale: [
    "title_deed_no",
    "oqood_no",
    "noc_ref",
    "deposit_amount",
    "transfer_date",
    "seller_bank",
    "buyer_bank",
    "loan_amount",
    "settlement_table",
  ],
  dates: ["agreement_date", "anticipated_completion", "governing_law", "dispute_body"],
  other: ["additional_terms", "booking_ref"],
} as const;

describe("SPA data sheet (architecture §7)", () => {
  test("every key in the spec is present, in its group, nothing extra", () => {
    const want = Object.entries(SPEC)
      .flatMap(([g, ks]) => ks.map((k) => `${g}:${k}`))
      .toSorted();
    const have = Object.entries(spaDataSheet)
      .map(([k, v]) => `${v.group}:${k}`)
      .toSorted();
    expect(have).toEqual(want);
  });
  test("buyer and seller keys repeat per party", () => {
    for (const k of SPEC.buyer) expect(spaDataSheet[k].repeat).toBe("buyer");
    for (const k of SPEC.seller) expect(spaDataSheet[k].repeat).toBe("seller");
    expect(spaDataSheet.price.repeat).toBeUndefined();
  });
  test("a company purchaser prints licence and signatory; none of the three is core (C14, S46)", () => {
    for (const k of ["purchaser_licence_no", "purchaser_signatory_name", "purchaser_signatory_title"] as const)
      expect([k, spaDataSheet[k].core]).toEqual([k, false]);
  });
  test("money keys are fils", () => {
    for (const k of [
      "price",
      "discount",
      "dld_fee",
      "oqood_fee",
      "booking_amount",
      "deposit_amount",
      "loan_amount",
    ] as const)
      expect(spaDataSheet[k].type).toBe("money_fils");
  });
  test("core keys never print empty: names, unit, price, plan, fees", () => {
    for (const k of ["purchaser_name", "seller_name", "unit_no", "price", "dld_fee"] as const)
      expect(spaDataSheet[k].core).toBe(true);
    expect(spaDataSheet.parking.core).toBe(false);
    // final review #7: a ready resale has no payment plan, so the plan is required for primary deals only.
    expect(spaDataSheet.payment_plan.core).toBe(false);
    expect(spaDataSheet.payment_plan.requiredFor).toEqual(["primary_offplan"]);
  });
  test("aliases and names in any case or separator", () => {
    for (const [alias, key] of [
      ["buyername", "purchaser_name"],
      ["purchasername", "purchaser_name"],
      ["vendorname", "seller_name"],
      ["ownername", "seller_name"],
      ["saleprice", "price"],
      ["purchaseprice", "price"],
      ["dldfee", "dld_fee"],
      ["registrationfee", "dld_fee"],
      ["titledeedno", "title_deed_no"],
    ] as const)
      expect(SPA_SHEET_ALIASES[alias]).toBe(key);
    expect(spaSheetKeyFor("Purchaser Name")).toBe("purchaser_name");
    expect(spaSheetKeyFor("Buyer-Name")).toBe("purchaser_name");
    expect(spaSheetKeyFor("UNIT_NO")).toBe("unit_no");
    expect(spaSheetKeyFor("tenant name")).toBeNull();
    expect(spaSheetKeyFor("")).toBeNull();
  });
});
